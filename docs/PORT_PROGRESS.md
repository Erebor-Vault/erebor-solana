# Port Progress — OLD_Erebor → this repo (path B)

Tracks the port from `OLD_Erebor/Erebor` (HEAD `cfe1a06`) onto this repo's
`main`, per the design analysis the user signed off on. Branch:
**`port-old-erebor`** (local-only — not pushed).

## Decision recap

Two parallel evolutions of the project diverged from `840c0a4` on 2026-03-29:

- **OLD_Erebor** (`xrave110/Erebor`): Phase 3/4 — security audit work, fee
  model, pause flag, two-step admin transfer, per-strategy authority PDAs,
  RedeemAdapter framework, mock_kamino with cToken model. Last commit
  2026-04-30.
- **This repo** (`Erebor-Vault/erebor-solana`, branch `newArch`): action
  whitelisting + Lulo agent + Kamino looper agent + mock_lulo / mock_kamino
  with obligation tracking + ProtocolPosition adapter. Last commit 2026-04-09.

Per the [analysis](#design-decisions), OLD_Erebor wins on almost every
architectural decision (security model, fee model, withdrawal flow, mock
fidelity, frontend extensibility). Only **5 things from this repo are worth
keeping**:

1. Modular `instructions/` layout (cosmetic, deferred to step 2)
2. Working Lulo AI agent (`agent/lulo/`)
3. Working Kamino looper agent (`agent/kamino_looper/`)
4. `mock_lulo` program (so the Lulo agent has a target)
5. Borrow/repay extension to `mock_kamino` (so the looper agent has a target)

Path B = adopt OLD_Erebor as the baseline, port the 5 keepers onto it.

## Branch layout

```
9fbe5f9  mock_kamino: add init_obligation + borrow/repay for leveraged loops
da82835  port: bring mock_lulo program from main
8b699bc  port: import OLD_Erebor tree as baseline for path-B integration
840c0a4  Readme update                                  ← branch point from main
```

`anchor build` passes for all 3 programs (`my_project`, `mock_kamino`,
`mock_lulo`). Tests under `tests/` are still OLD_Erebor's and **will fail
once we touch them** — they don't know about `mock_lulo` or the new
`mock_kamino` borrow/repay. Tests get fixed in step 7.

## Completed

### Step 1 — Import OLD_Erebor tree (commit `8b699bc`)

- `git read-tree --reset -u old-erebor/main^{tree}` overlaid 138 files.
- Restored this repo's stricter `.gitignore` (adds `*_keypair.json`,
  `credentials*.json` globs).
- Removed leaked `programs/mock_kamino/program-keypair.json` from index
  (program ID will regen at deploy time).
- Untracked `Cargo.lock`, `bun.lock` (now match `.gitignore`).

### Step 3 — Port mock_lulo (commit `da82835`)

- Imported `programs/mock_lulo/` from `newArch` as-is.
- Added `mock_lulo = "3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm"` to
  Anchor.toml's `programs.devnet`, `programs.localnet`, `programs.mainnet`.
- Self-contained — no dependency on `my_project` changes.

### Step 4 — mock_kamino borrow/repay (commit `9fbe5f9`)

Added 3 new instructions to OLD_Erebor's mock_kamino so the leveraged-loop
agent has a target:

- `init_obligation` — creates per-(reserve, owner) PDA at
  seeds `["obligation", reserve, owner]`.
- `borrow_obligation_liquidity(amount)` — debt against existing cToken
  collateral. HF check uses on-chain cToken balance × redemption rate.
  Constraint pins `collateral_token_account.owner == obligation.owner`.
- `repay_obligation_liquidity(amount)` — pays down debt, capped at outstanding.

Constants:
- `HF_MIN_BPS: u128 = 10_500` (1.05). Agent's TS-side
  `INTERMEDIATE_HF_FLOOR = 1.10` sits above this for safety margin.

State changes:
- `Reserve` gained `total_borrowed: u64` field. Breaking layout change but
  branch isn't deployed.
- New `Obligation` account: `{ reserve, owner, borrowed_liquidity, bump }`.

Errors added: `HealthFactorTooLow`, `InsufficientLiquidity`, `WrongObligation`.

Instruction names match real Kamino's `klend` (`borrow_obligation_liquidity`,
`repay_obligation_liquidity`) so anchor discriminators are
mainnet-compatible.

## Remaining

### Step 5 — Port agents (rewrite chain calls for `execute_action`)

Largest remaining piece. The agent's chain layer needs total rewrite because
OLD_Erebor's `execute_action` differs from this repo's
`execute_strategy_action`:

| | This repo's `execute_strategy_action` | OLD_Erebor's `execute_action` |
|---|---|---|
| Args | `instruction_data: Vec<u8>` (single blob) | `(strategy_id, target_program, discriminator, ix_data)` separate args |
| CPI signer | Vault PDA | Per-strategy `["strategy_authority", vault, strategy_id]` PDA |
| Recipient check | Walks remaining_accounts, blocks caller-as-authority | **Mandatory** `expected_recipient_index` pin to strategy_token |
| Output mint check | None | Optional `output_mint_index` against `AllowedToken` PDA |
| Anti-theft | None | Re-reads caller + delegate ATAs, requires no balance increase |

Files to rewrite:
- `agent/kamino_looper/src/chain/vault.ts` — replace `executeKaminoAction`
  to use `execute_action` with `(strategy_id, target_program, disc, ix_data)`
  args; derive strategy_authority PDA; pass mandatory recipient pin.
- `agent/kamino_looper/src/chain/kamino.ts` — replace obligation reader
  with cToken balance reader (`get_associated_token_address(collateral_mint,
  strategy_authority)` then read amount from token account data). Drop the
  oracle reader (mock_kamino has no oracle in OLD_Erebor's design — single
  asset only).
- `agent/kamino_looper/src/strategy/leverageManager.ts` — keep
  `INTERMEDIATE_HF_FLOOR = 1.10`, but the borrow now needs a different
  account list (cToken ATA, obligation, etc.).
- `agent/kamino_looper/src/strategy/allocator.ts` — keep the orphan-
  detection logic; portfolio shape changes (no separate supplied/borrowed
  by asset, just cToken balance + obligation.borrowed_liquidity).
- `agent/kamino_looper/src/loop/mainLoop.ts` — adjust portfolio reads.
- `agent/kamino_looper/src/index.ts` — adjust on-chain validation.
- `agent/kamino_looper/tests/*.test.ts` — update PortfolioState shape in
  allocator tests, leverageManager tests.
- `agent/lulo/src/strategy.ts` — replace `pullFromStrategy` (SPL-delegate
  pattern) with `execute_action` calls for mock_lulo's `lend` / `withdraw`
  discriminators. Also replace this repo's stub `lend` / `withdraw` mock
  branches with real CPIs.
- `agent/lulo/src/monitor.ts`, `agent/lulo/src/llm-advisor.ts` — keep most
  logic, just replace the chain calls.
- `agent/lulo/src/vault-client.ts` (new — copy from `agent/shared/`) — PDA
  derivation including the new `strategy_authority` PDA seed.

Setup scripts that need rewrites because of the changed instruction layout:
- `scripts/setup-kamino-strategy.ts` — call `init_reserve` (OLD_Erebor's
  cToken model), `init_obligation`, `add_allowed_action` with mandatory
  `expected_recipient_index` and per-discriminator entries for
  `deposit_reserve_liquidity_and_obligation_collateral`,
  `withdraw_obligation_collateral_and_redeem_reserve_collateral`,
  `borrow_obligation_liquidity`, `repay_obligation_liquidity`.
- `scripts/create-strategies.ts` — update for `execute_action` whitelist
  format; add mock_lulo's `lend` / `withdraw` discriminators.
- `scripts/init-kamino-position.ts` — replace ProtocolPosition init with
  init_obligation + cToken ATA creation.
- `scripts/unwind-kamino-position.ts` — rewrite for new instruction names
  and per-strategy authority signer.
- `scripts/read-kamino-position.ts` — read cToken balance + obligation
  borrowed_liquidity instead of the old supplied/borrowed pair.
- `scripts/crank-yield.ts` — call `simulate_yield` (OLD_Erebor's name) for
  both mock_lulo and mock_kamino.

### Step 6 — Add mockLulo RedeemAdapter + update frontend

`app/src/lib/adapters/` already has the framework from OLD_Erebor:
- `types.ts` — `RedeemAdapter` interface, `ProtocolPosition` shape
- `index.ts` — adapter registry
- `orchestrator.ts` — `buildRedeemPlan()` stacks redeem ixs ahead of withdraw
- `mockKamino.ts` — concrete adapter (will need updates for our new borrow/
  repay support)
- `jupiter.ts` — stub

Need:
- `app/src/lib/adapters/mockLulo.ts` (new) — implement `RedeemAdapter` for
  the imported `mock_lulo` program. `readPosition` reads the
  ProtocolPosition PDA at `["position", strategy_token_account]`.
  `buildRedeemAction` builds an `execute_action` instruction calling
  mock_lulo's `withdraw` discriminator.
- Register in `app/src/lib/adapters/index.ts`.
- `app/src/hooks/useStrategies.ts` — replace the per-PDA probe (this repo's
  approach) with `RedeemAdapter.readPosition` calls. Sum across all
  registered adapters for `externalPosition`. The `positionPdas` array
  becomes the union of adapter raw fields used during `report_yield`.
- `app/src/hooks/useAuthorityActions.ts` — `reportYield` already accepts an
  array of position PDAs, just verify it's correct.
- Verify `app/src/lib/adapters/mockKamino.ts` works with our new
  borrow/repay — it currently only redeems via cToken withdraw, doesn't
  understand obligations. May need an "unwind loop" version that repays
  borrows first.

### Step 2 (deferred) — Split monolith

`programs/my_project/src/lib.rs` is 2607 lines. Split into:

- `lib.rs` — thin dispatcher (~110 lines)
- `state.rs` — `VaultState`, `StrategyAllocation`, `AllowedAction`,
  `AllowedToken`, `ProtocolConfig` + events + constants
  (`VIRTUAL_SHARES`, `DEFAULT_PERFORMANCE_FEE_BPS`, etc.)
- `errors.rs` — `VaultError` enum
- `instructions/mod.rs`
- ~26 instruction files: `initialize_vault`, `deposit`, `withdraw`,
  `create_strategy`, `allocate_to_strategy`, `deallocate_from_strategy`,
  `update_strategy_delegate`, `report_yield`, `report_loss`,
  `deactivate_strategy`, `initialize_protocol_config`, `set_treasury`,
  `set_protocol_fee_bps`, `set_governance`, `add_allowed_token`,
  `remove_allowed_token`, `propose_admin`, `accept_admin`,
  `propose_authority`, `accept_authority`, `set_paused`,
  `set_performance_fee_bps`, `set_strategy_weight`, `rebalance_strategy`,
  `add_allowed_action`, `remove_allowed_action`, `execute_action`

Mechanical work, no behavior change. Run `anchor build` + the original
tests after to confirm no regression.

### Step 7 — Redeploy + setup

After 5/6/2:

1. `anchor keys sync` to regen keypairs (OLD_Erebor's `declare_id!()` values
   are stale — corresponding keypairs are not in `target/deploy/`).
2. `anchor build` to bake new IDs.
3. `solana balance` — need ~10 SOL for deploy of all 3 programs. May need
   to close existing deployed programs (`my_project` `B7EUo8…`, `mock_lulo`
   `3YSjEZC…`, `mock_kamino` `S4taBh…`) on devnet to reclaim ~8 SOL of rent.
   ⚠ closing burns those IDs forever — confirm with user first.
4. `anchor deploy --provider.cluster devnet --program-name <each>`.
5. Update `.env` files (user must do this — secret-file hook blocks me).
6. Run setup scripts: `create-strategies.ts`, `setup-kamino-strategy.ts`.
7. Update `DEPLOYMENT.md`, `Anchor.toml`, `app/src/lib/constants.ts`,
   `app/src/idl/my_project.json`, `app/src/idl/my_project.ts`.
8. Smoke-test the agents end-to-end (the smoke test plan from the previous
   session: open loop → verify ProtocolPosition synced → close → frontend
   shows correct values).

## Known issues / gotchas

- **Tests are stale.** `tests/my_project.ts` and `tests/security.ts` are
  OLD_Erebor's. They still pass on this branch (they don't reference
  mock_lulo or mock_kamino borrow/repay), but they need to be extended in
  step 7.
- **Setup scripts are OLD_Erebor's.** `scripts/setup-multi-vaults.ts` uses
  the OLD_Erebor `execute_action` whitelist format. The newer scripts from
  newArch (`init-kamino-position.ts`, etc.) aren't on this branch and
  shouldn't be ported as-is — they target this repo's old account layouts.
  Step 5 will rewrite them on top of the new layout.
- **`agent_keypair.json`** isn't on this branch (it's gitignored). User
  must keep using their existing one when running setup scripts.
- **Devnet state is decoupled.** The currently-deployed programs (`B7EUo8…`,
  `3YSjEZC…`, `S4taBh…`) are still live and being driven by `newArch`. They
  won't stop working until step 7 redeploy.
- **mock_kamino discriminator change.** OLD_Erebor's `init_reserve` /
  `deposit_reserve_liquidity_and_obligation_collateral` etc. have
  different anchor discriminators than this repo's `initialize_oracle` /
  `deposit`. Anything calling the old names will break — agents, scripts,
  frontend adapters all need updates.

## Resuming

```bash
git checkout port-old-erebor
git log --oneline main..HEAD     # see the 3 port commits
anchor build                      # confirm baseline still builds
# then start step 5, agent rewrite
```

Suggested prompt for the next session:

> Continue path B port from commit 9fbe5f9 on branch `port-old-erebor`.
> Steps remaining: (5) rewrite agent/kamino_looper/src/chain/vault.ts to
> use OLD_Erebor's `execute_action` per-strategy authority + mandatory
> recipient pin, refit allocator/leverageManager for cToken model, do the
> same for agent/lulo; (6) add mockLulo RedeemAdapter + rewrite
> useStrategies.ts; (2 deferred) split programs/my_project/src/lib.rs into
> instructions/ modules; (7) redeploy all programs and rerun setup scripts.
> See PORT_PROGRESS.md for full context.

## Design decisions

The full conflict-by-conflict comparison that drove path B is in this
session's transcript. Summary table:

| Decision | Winner | Reason |
|---|---|---|
| Modular vs monolithic program | This repo's modular | Maintainability of 2607-line `lib.rs` is a real problem |
| Action-whitelist enforcement | OLD_Erebor | Mandatory recipient pin + anti-theft re-read; this repo only has caller-as-authority block |
| CPI signer (per-strategy authority PDA vs vault PDA) | OLD_Erebor | Blast-radius isolation if a delegate is compromised |
| Withdraw flow (auto-pull + u128 share math) | OLD_Erebor | This repo's `u64 * u64 / u64` is share-inflation vulnerable |
| Performance fee + ProtocolConfig | OLD_Erebor | This repo has no revenue model |
| Pause flag / circuit breakers | OLD_Erebor | Operational safety this repo lacks |
| Two-step admin/authority transfer | OLD_Erebor | Standard mistake-prevention pattern |
| Token allow-list (`AllowedToken` PDA) | OLD_Erebor | Defense-in-depth for swap CPIs |
| mock_kamino model (cToken vs raw obligation) | OLD_Erebor | cTokens match real Kamino; mainnet-compatible discriminators |
| Protocol position adapter | OLD_Erebor's RedeemAdapter | Pure-TS extensibility; enables auto-pull on withdraw |
| Per-vault frontend routes | OLD_Erebor | URL-shareable, deep-linkable |
| AI agents (Lulo + Kamino looper) | This repo | OLD_Erebor's agent is a stub harness, this repo has working code |
| `mock_lulo` program | This repo | OLD_Erebor lacks any Lulo target |
