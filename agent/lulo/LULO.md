# Lulo Lending Agent

A Claude-powered autonomous agent that manages a single Erebor strategy, lending idle USDC to Lulo (or the `mock_lulo` devnet program) via the vault's action-whitelisting CPI router.

---

## Architecture

The agent never holds SPL spending authority. All token movement goes through the vault program:

```
┌─────────────┐   execute_strategy_action(instr)    ┌──────────────┐
│ Lulo Agent  │ ──────────────────────────────────► │  Erebor      │
│ (delegate)  │                                      │  Vault       │
└─────────────┘                                      └──────┬───────┘
       ▲                                                    │ invoke_signed
       │                                                    │ (vault PDA signs)
       │  poll: read state, decide, act                     ▼
       │                                            ┌──────────────┐
       │                                            │ Lulo program │
       │                                            │ (or mock)    │
       └────────────────────────────────────────────└──────────────┘
              read on-chain state every 2 minutes
```

The vault validates each request against per-strategy `AllowedAction` PDAs (target program + 8-byte discriminator) before relaying the CPI. The delegate cannot route funds anywhere except the whitelisted protocol.

---

## Project Structure

```
agent/lulo/
├── src/
│   ├── index.ts          # Entry point — startup, validation, monitor loop
│   ├── config.ts         # Env loading, PROGRAM_ID constant
│   ├── strategy.ts       # OnChainLuloProtocol — lend/withdraw via execute_strategy_action
│   ├── monitor.ts        # Polling loop, state-change detection, hard rules
│   └── llm-advisor.ts    # Claude advisor (Haiku/Sonnet selection, rate limiting)
├── package.json          # Standalone deps (no Solana Agent Kit)
├── tsconfig.json
└── .env.example

agent/shared/
├── types.ts              # AgentConfig, AgentDecision, snapshots, account mirrors
└── vault-client.ts       # PDA derivation, on-chain reads, allowed-action discovery
```

---

## Environment Configuration

`agent/lulo/.env.example`:

```bash
# Required
SOLANA_PRIVATE_KEY=        # Agent delegate keypair (base58)
ANTHROPIC_API_KEY=         # Claude API key
VAULT_TOKEN_MINT=          # Underlying token mint (USDC)
LULO_PROGRAM_ID=           # Target program (devnet: mock_lulo, mainnet: real Lulo)
LULO_TREASURY=             # Protocol treasury token account

# Optional (with defaults)
RPC_URL=https://api.devnet.solana.com
VAULT_ID=0
STRATEGY_ID=0
POLL_INTERVAL_MS=120000        # 2 minutes
MIN_LEND_AMOUNT=1000000        # 1 USDC (6 decimals)
WITHDRAW_SIGNAL_PATH=./withdraw-signal.json
MAX_RETRIES=3
RETRY_DELAY_MS=2000
```

There is **no `USE_MOCK_LULO` flag** — devnet vs. mainnet is determined entirely by which program ID is in `LULO_PROGRAM_ID`. The same `OnChainLuloProtocol` adapter works for both.

---

## Startup (`index.ts`)

1. Load and freeze config from `.env` (throws on missing required vars)
2. Open RPC connection at `confirmed` commitment
3. Derive PDAs from shared client:
   - Vault: `["vault", tokenMint, vaultId (u64 LE)]`
   - Strategy: `["strategy", vaultPda, strategyId (u64 LE)]`
   - Strategy token account: `["strategy_token", vaultPda, strategyId (u64 LE)]`
4. Validate on-chain state:
   - Vault must exist
   - Strategy must be active
   - `strategy.delegate` must equal the loaded agent keypair (fail-fast on misconfiguration)
5. Initialize `OnChainLuloProtocol` and `LLMAdvisor`
6. Register SIGINT/SIGTERM handlers for graceful shutdown
7. Enter the monitor loop (never returns under normal operation)

---

## Decision Flow (`monitor.ts`)

Each cycle:

1. **Read state** — fetch strategy account + token balance + protocol position (lent amount)
2. **Hard rules** (no LLM consulted):
   - **Strategy deactivated** → withdraw everything from Lulo, exit process
   - **Withdrawal signal file present** → withdraw the requested amount, delete the file
3. **Detect external state change** — compare `total_assets = idle + lent` against the previous cycle. The agent's own actions are bookkept and don't count as "external" changes. Threshold: delta > 0.1% of total OR > 10,000 micro-USDC.
4. **Consult LLM** if:
   - State changed (authority allocated/deallocated, yield accrued), OR
   - Every 10th routine cycle (periodic re-evaluation)
5. **Execute decision** via `OnChainLuloProtocol`:
   - **LEND** → `execute_strategy_action(deposit_discriminator + amount)` — vault CPIs into Lulo deposit
   - **WITHDRAW** → `execute_strategy_action(withdraw_discriminator + amount)` — vault CPIs into Lulo withdraw
   - **HOLD** → no-op
6. **Error handling** — track consecutive failures. After `MAX_RETRIES` failures, cool down 60s and reset.

---

## LLM Advisor (`llm-advisor.ts`)

Claude is consulted with current state (idle balance, lent amount, yield surplus, strategy metadata) and returns:

```json
{
  "action": "LEND" | "WITHDRAW" | "HOLD",
  "amount": <micro_usdc>,
  "reason": "<short explanation>"
}
```

### Model selection

| Trigger                                  | Model            | Why                              |
| ---------------------------------------- | ---------------- | -------------------------------- |
| State change with delta ≥ 250 USDC       | `claude-sonnet`  | Larger allocations need reasoning |
| State change < 250 USDC, or routine poll | `claude-haiku`   | Cheap, simple lend/hold logic    |
| Any LLM failure (network, parse, etc.)  | (fallback: HOLD) | Safest default                   |

**Rate limit:** max 1 LLM call per 10 seconds, regardless of trigger.

### System prompt rules (paraphrased)

- If idle ≥ `MIN_LEND_AMOUNT`, lend the excess but keep a 5% buffer
- "Awaiting" yield status is normal right after a deposit — don't panic
- Hold or lend more if yield is accruing
- Consider withdrawing if yield never accrues over many cycles
- Avoid lend/withdraw flapping
- Round amounts to whole USDC

---

## Withdraw Signal File

`agent/lulo/withdraw-signal.json` (path configurable):

```json
{
  "amount": 5000000,
  "requestedAt": "2026-04-09T12:00:00Z",
  "requestedBy": "admin"
}
```

The vault authority writes this file when it needs the agent to free up funds before calling `deallocate_from_strategy`. The agent reads it on the next poll, withdraws the exact amount from Lulo back into the strategy account, then deletes the file. Malformed files are silently skipped.

---

## Action Whitelisting (one-time admin setup)

Before the agent can act, the admin must whitelist Lulo's deposit and withdraw instructions on the strategy:

```typescript
// Compute Anchor discriminators (sha256("global:<instruction_name>")[..8])
const depositDiscriminator  = computeDiscriminator("deposit");
const withdrawDiscriminator = computeDiscriminator("withdraw");

await program.methods
  .addAllowedAction(LULO_PROGRAM_ID, Array.from(depositDiscriminator))
  .accountsStrict({ admin, vaultState, strategy, allowedAction, systemProgram })
  .signers([admin])
  .rpc();

await program.methods
  .addAllowedAction(LULO_PROGRAM_ID, Array.from(withdrawDiscriminator))
  .accountsStrict({ /* allowedAction at next action_id */ })
  .signers([admin])
  .rpc();
```

The agent discovers these PDAs at runtime via `findAllowedActionByDiscriminator` (in `agent/shared/vault-client.ts`).

---

## Running

```bash
cd agent/lulo
cp .env.example .env
# Edit .env with your keypair, API key, mints, and Lulo program ID
bun install
bun run start            # tsx src/index.ts
# or:
bun run dev              # tsx watch mode
```

---

## Costs (rough monthly estimate)

| Component               | Notes                              | Monthly |
| ----------------------- | ---------------------------------- | ------- |
| Claude Haiku (routine)  | ~1 call per cycle, 2-min interval  | ~$5–15  |
| Claude Sonnet (large Δ) | Only on >250 USDC state changes    | ~$10–40 |
| Solana tx fees          | A few lend/withdraw per day        | <$1     |
| **Total**               |                                    | **~$15–55** |

Costs scale with how often the authority allocates/deallocates and how often the vault sees yield events.
