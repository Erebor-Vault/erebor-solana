# AI Agent Plan — Solana Agent Kit + Lulo Lending Strategy

## Context

We have a vault program with an **action whitelisting model**: the admin creates strategies, assigns delegates, and whitelists specific (program, instruction) pairs. The delegate calls `execute_strategy_action` to request the vault to CPI into an external protocol — the vault validates against the whitelist and signs via `invoke_signed`.

**Key change from v1**: The delegate no longer has SPL token spending authority. All token movement goes through the vault program's CPI routing. The two-step transfer workaround (strategy → agent ATA → Lulo) is eliminated — the vault CPIs directly into the target protocol.

**LLM**: Anthropic Claude — the agent uses Claude to reason about when/how much to lend, evaluate yields, and decide on rebalancing.

**Decision mode**: LLM-driven — Claude analyzes on-chain data (yields, balances, protocol health) and decides actions autonomously, not just following static rules.

---

## Project Structure

```
agent/
  src/
    index.ts           — Entry point, starts monitoring loop
    config.ts          — Env loading, constants
    strategy.ts        — Lending/withdrawal logic (Lulo + delegate transfers)
    monitor.ts         — Polling loop watching strategy_token_account balance
    vault-client.ts    — PDA derivation, on-chain state reads
    llm-advisor.ts     — Claude-powered decision engine (lend/hold/withdraw/rebalance)
    types.ts           — Shared interfaces
  .env.example         — Environment variable template
  package.json         — Agent dependencies (separate from root)
  tsconfig.json        — Agent-specific TypeScript config
```

---

## Step-by-Step Implementation

### Step 1: Scaffold agent directory + dependencies

```bash
cd agent && bun install
```

### Step 2: Environment configuration

`agent/.env.example`:
```
SOLANA_PRIVATE_KEY=        # Agent wallet (delegate keypair, base58)
RPC_URL=https://api.devnet.solana.com
ANTHROPIC_API_KEY=         # Claude API key
VAULT_TOKEN_MINT=          # underlying token mint (USDC)
STRATEGY_ID=0              # which strategy this agent manages
POLL_INTERVAL_MS=30000     # check every 30s
MIN_LEND_AMOUNT=1000000    # min 1 USDC (6 decimals)
USE_MOCK_LULO=true         # true for devnet/localnet testing
```

### Step 3: Vault client — PDA derivation + on-chain reads

PDA seeds (matching lib.rs):
- Vault: `["vault", tokenMint]`
- Strategy: `["strategy", vaultPda, strategyId (le u64)]`
- Strategy Token Account: `["strategy_token", vaultPda, strategyId (le u64)]`

### Step 4: Claude LLM advisor

Claude decides: `LEND` / `WITHDRAW` / `REBALANCE` / `HOLD` with reasoning.
Cost-optimized: only called on state changes, Haiku for routine, Sonnet for complex.

### Step 5: Core lending strategy

Direct CPI pattern via `execute_strategy_action`:
- Lend: agent calls `execute_strategy_action` → vault CPIs into Lulo deposit
- Withdraw: agent (or authority) calls `execute_strategy_action` → vault CPIs into Lulo withdraw
- No tokens flow through the agent's wallet

### Step 6: Monitoring loop

Polls every 30s. Hard rules (no LLM): deactivation → withdraw all, withdrawal signal → withdraw amount.
LLM decisions: new tokens, yield changes, rebalancing.

### Step 7-8: Entry point + Withdrawal coordination

Signal file `agent/withdraw-signal.json` for vault authority coordination.

### Step 9-10: Testing

- Localnet: mock Lulo mode
- Mainnet: 1 USDC round-trip

---

## Costs

| Component | Monthly |
|-----------|---------|
| Claude Haiku (routine) | ~$5-15 |
| Claude Sonnet (complex) | ~$30-100 |
| Solana tx fees | <$1 |
| **Total** | **~$30-80** |
