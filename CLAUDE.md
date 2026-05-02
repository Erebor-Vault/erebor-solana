# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

One Anchor program + a Next.js frontend + a (scaffolded) AI agent, all
co-located:

- **Anchor program** at [programs/my_project/](programs/my_project/) — `src/lib.rs`, `Cargo.toml`. Single program crate.
- **Tests** at [tests/my_project.ts](tests/my_project.ts) — TypeScript integration tests with ts-mocha + chai, using the Anchor IDL types regenerated from `target/types/` after every `anchor build`.
- **Frontend** at [app/](app/) — Next.js 16.2.1 (App Router), React 19, TypeScript, Tailwind 4, `@solana/wallet-adapter-react`, `@coral-xyz/anchor`. Separate `package.json`.
- **AI agents** at [agent/](agent/) — two runnable agents: [agent/lulo/](agent/lulo/) (lending against `mock_lulo`) and [agent/kamino_looper/](agent/kamino_looper/) (leveraged loop against `mock_kamino`). Shared chain-layer helpers in [agent/shared/](agent/shared/). Both route through `execute_action` with per-strategy authority signing. See [docs/AI_PLAN.md](docs/AI_PLAN.md).
- **Scripts** at [scripts/](scripts/) — TS scripts that drive deploy / vault init / strategy creation / yield simulation against devnet (or local validator).
- **Migrations** at [migrations/deploy.ts](migrations/deploy.ts) — Anchor deploy stub (empty body — real deploys go through [scripts/deploy.sh](scripts/deploy.sh) and the `init-vault.ts` family).
- **Anchor config** at [Anchor.toml](Anchor.toml), workspace at [Cargo.toml](Cargo.toml). Program id pinned to `FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo` on devnet, localnet, and mainnet. Two mock targets (`mock_kamino`, `mock_lulo`) ship in the same workspace.

Spec, deployment, and design context worth reading before changing
behavior (in roughly this order):

- [docs/OVERVIEW.md](docs/OVERVIEW.md) — high-level pitch + architecture explainer (start here if you're new).
- [docs/SOLANA_VAULT_SPEC.md](docs/SOLANA_VAULT_SPEC.md) — original build spec; aspirational. Cross-check with…
- [docs/MISMATCHES.md](docs/MISMATCHES.md) — every place the spec diverges from what's actually shipped today.
- [docs/FRONTEND.md](docs/FRONTEND.md) — current snapshot of the dashboard.
- [docs/FRONTEND_PLAN.md](docs/FRONTEND_PLAN.md) — forward-looking frontend roadmap + open questions.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — live devnet program + per-vault PDA derivations.
- [docs/AI_PLAN.md](docs/AI_PLAN.md) — the AI agent's intended design.
- [docs/PLAN.md](docs/PLAN.md) — historical implementation checklist (some items remain open; see docs/MISMATCHES.md for current state).

## Common commands

### Anchor / Rust (run from repo root)

```bash
anchor build                          # builds the program → target/deploy + target/idl + target/types
anchor test                           # spins up a local validator and runs tests/my_project.ts
bunx ts-mocha -p ./tsconfig.json -t 1000000 "tests/my_project.ts"
                                      # run the test file directly against an already-running validator
bun run lint                          # prettier check
bun run lint:fix                      # prettier write
```

`Cargo.toml` workspace pins `constant_time_eq = "=0.3.1"` and
`toml_datetime = "=0.6.11"` to keep edition2024 transitive deps off
the Solana toolchain (cargo-build-sbf is on Cargo 1.75). `release`
profile uses `lto = "fat"`, `codegen-units = 1`, and
`overflow-checks = true`. Warm `target/` cache matters; cold builds
take a while.

### Devnet ops (run from repo root with `.env` loaded)

[scripts/](scripts/) wraps every multi-step devnet flow:

```bash
bun scripts/setup-devnet.ts           # full path: mint test token → init vault → create strategies → simulate yield
bun scripts/setup-full.ts             # convenience wrapper around the same flow
bun scripts/init-vault.ts             # idempotent vault init for an existing token mint
bun scripts/create-vault.ts           # init + transfer admin/authority to a target wallet
bun scripts/create-strategies.ts      # create N mock strategies, set weights, rebalance
bun scripts/mint-to-wallet.ts         # mint test token + init vault + transfer admin
bun scripts/simulate-yield.ts         # mint underlying directly to a strategy ATA + report_yield (one-shot)
bun scripts/crank-yield.ts            # same but in a loop — keeper for fake yield (--loop)
bash scripts/deploy.sh                # `anchor deploy` with balance checks + post-deploy init
```

`scripts/crank-yield.ts` is the keeper analogue: production deploys
should swap it for a real keeper (Clockwork / Triton / a server
cronjob) once a real yield source is wired in.

### Frontend (run from [app/](app/))

```bash
bun install
bun run dev              # next dev — http://localhost:3000
bun run build            # next build (statically exports per netlify.toml)
bun run start
```

The frontend reads `NEXT_PUBLIC_CLUSTER` (`devnet` | `mainnet-beta`,
defaults to `devnet`) and `NEXT_PUBLIC_RPC_URL` (overrides the
cluster default). `NEXT_PUBLIC_TOKEN_MINT` overrides the default
asset mint; without it the app falls back to the first entry in
`VAULT_REGISTRY` ([app/src/lib/constants.ts](app/src/lib/constants.ts)).

### Agents (run from [agent/lulo/](agent/lulo/) or [agent/kamino_looper/](agent/kamino_looper/))

```bash
cp .env.example .env     # fill in ANTHROPIC_API_KEY + agent keypair + RPC
bun install
bun run start            # boots polling loop, signs execute_action ixs
```

Both agents read vault + strategy state, pick `lend` / `redeem` (Lulo)
or deposit / borrow / repay / withdraw (Kamino looper), and dispatch
through `execute_action` against the corresponding mock program. The
`execute_action` whitelist gateway is in place, so neither uses
mock-stub fallbacks. See [docs/AI_PLAN.md](docs/AI_PLAN.md) for the
broader design.

## Architecture

### Per-strategy authority PDAs (the load-bearing decision)

Phase-3 (post-audit) refactor. After this change, **`vault_state` is
a pure config account that never signs CPIs**. Every fund movement
signs as one of two kinds of authority PDA:

- **`vault_authority`** — one per vault, seeds
  `["vault_authority", vault_state]`. Owns the reserve ATA and the
  share mint. Signs `mint_to`, reserve-side transfers (deposit /
  withdraw / allocate / rebalance-in-leg).
- **`strategy_authority[i]`** — one per strategy, seeds
  `["strategy_authority", vault_state, strategy_id (u64 LE)]`. Owns
  strategy *i*'s ATA. Signs `approve` / `revoke` for delegate
  management, deallocate, rebalance-out-leg, and (most importantly)
  the `invoke_signed` inner CPI inside `execute_action`.

The split is what gives the spec's per-strategy isolation: a
compromised `strategy_authority[i]` can only move strategy *i*'s
funds. There is no PDA whose compromise lets you move funds across
strategies.

Two top-level account types:

1. **`VaultState`** — one PDA per `(token_mint, vault_id: u64)`,
   seeded by `[b"vault", token_mint, &vault_id.to_le_bytes()]`. Pure
   config: `admin`, `authority`, `token_mint`, `share_mint`,
   `vault_id`, `total_deposited`, `strategy_count`, `bump`,
   `share_mint_bump`, `vault_authority_bump`, `paused`,
   `performance_fee_bps`, `total_active_weight_bps`, `pending_admin`,
   `pending_authority`. **Never signs.**
2. **`StrategyAllocation`** — one PDA per `(vault, strategy_id: u64)`,
   seeded by `[b"strategy", vault_state, &strategy_id.to_le_bytes()]`.
   Holds `vault`, `strategy_id`, `delegate`, `allocated_amount`,
   `token_account`, `is_active`, `target_weight_bps`, `bump`,
   `authority_bump`. The strategy ATA at
   `[b"strategy_token", vault_state, &strategy_id.to_le_bytes()]` is
   owned by `strategy_authority[i]`, which approves the agent's
   `delegate` (`spl-token approve` with `u64::MAX`).

Critical consequences for any change:

1. **`vault_state` never signs.** If you find yourself building signer
   seeds that start with `b"vault"` and end with `vault_state.bump`,
   that's wrong — translate to `b"vault_authority"` +
   `vault_authority_bump`, or `b"strategy_authority"` +
   `strategy.authority_bump`, depending on which ATA the CPI moves.
2. **Cross-strategy drains are structurally impossible.** Strategy
   *i*'s ATA is owned by `strategy_authority[i]`; even if the agent
   on strategy *i* is malicious and you accidentally let them call
   `execute_action` with strategy *j*'s accounts in
   `remaining_accounts`, the inner CPI's authority signer is wrong
   and the call reverts.
3. **`execute_action` is fully built** (Phase-2/4/5). Allowed-action
   whitelist via `AllowedAction` PDAs; required `expected_recipient_index`;
   optional `output_mint_index` against the protocol-level
   `AllowedToken` allow-list; pre/post snapshot of caller's ATA,
   `strategy.delegate`'s ATA, and the strategy ATA itself (with a
   `loss_per_call_bps_cap` ceiling); per-action `cooldown_secs` rate
   limit; sibling-instruction introspection that rejects any other tx
   instruction touching `strategy.token_account`. See
   [docs/MISMATCHES.md §2.3](docs/MISMATCHES.md) for the full chain.
4. **Two-step admin / authority transfer.** `propose_admin` +
   `accept_admin` (and `_authority` analogues). Until the recipient
   accepts from their own keypair, the live admin/authority field is
   unchanged. The legacy `transfer_admin` / `set_authority`
   single-step instructions were removed.
5. **Deactivation is permanent and requires draining first.**
   `deactivate_strategy` reverts unless
   `allocated_amount == 0 && strategy_token_account.amount == 0`.
   It also decrements `vault_state.total_active_weight_bps` by the
   strategy's prior weight.

### Deposit / withdraw flow

`deposit(amount)` ([programs/my_project/src/lib.rs](programs/my_project/src/lib.rs)):

1. Compute `shares_to_mint` with the OpenZeppelin virtual-shares
   offset (audit #4): `shares = amount × (supply + VIRTUAL_SHARES) / (assets + 1)`.
   `VIRTUAL_SHARES = 1_000_000`. The first depositor gets `amount × 10^6`
   shares; share-token decimals effectively run 6 dp ahead of the
   underlying. This blocks the donate-to-vault inflation grief.
2. CPI `token::transfer` from `user_token_ata` → reserve ATA.
3. CPI `token::mint_to` (signed by **`vault_authority`**) → user share ATA.
4. `vault_state.total_deposited = checked_add(amount)`.
5. **Optional fan-out (Phase-5).** If the caller passes
   `[strategy_pda, strategy_token_ata]` pairs in `remaining_accounts`,
   the program pushes `amount × strategy.target_weight_bps / 10_000`
   from reserve into each strategy's ATA, signed by `vault_authority`.
   Inactive / zero-weight strategies are skipped. The cumulative
   pushed total is capped at `amount` (revert: `FanOutExceedsDeposit`)
   so duplicate `(strategy, ata)` chunks can't drain pre-existing
   reserve liquidity. Empty `remaining_accounts` = back-compat
   reserve-only path.

`withdraw(shares_to_burn)`:

1. Compute `underlying = shares × (assets + 1) / (supply + VIRTUAL_SHARES)`
   in u128, then downcast to u64 with overflow guard.
2. **Auto-pull (Phase-4b).** If `reserve_ata.amount < underlying`,
   walk `[strategy, strategy_authority, strategy_token]` triples in
   `remaining_accounts` and pull underlying back to reserve in caller
   order, signed by `strategy_authority[i]`. If the shortfall can't
   be covered after the loop, revert with `InsufficientLiquidity`.
3. CPI `token::burn` user shares.
4. **Fee split (Phase-4a).** `total_fee_bps = vault_state.performance_fee_bps`;
   `protocol_fee_bps` from `ProtocolConfig`. CPI transfers
   (signed by `vault_authority`): user gets `underlying − total_fee`,
   treasury gets `protocol_fee_bps × underlying / 10_000`, admin gets
   the remainder.
5. `total_deposited = checked_sub(underlying)`.

### Strategy lifecycle

- `create_strategy()` — admin-only. Allocates the next
  `strategy_id = vault_state.strategy_count`, derives the strategy
  PDA, the per-strategy `strategy_authority[i]` PDA, and the
  strategy-token PDA. The strategy ATA is owned by
  `strategy_authority[i]`; that PDA approves the delegate with
  `spl-token approve(amount = u64::MAX)`. Caller passes existing
  active strategy PDAs in `remaining_accounts` — the program rejects
  if any already uses the same delegate (audit #10 mitigation).
- `set_strategy_weight(weight_bps: u16)` — admin-only. Per-strategy
  cap 10 000 bps; the sum across active strategies is also enforced
  (audit #18) via `vault_state.total_active_weight_bps`. Trying to
  push the sum above 10 000 bps reverts with `WeightSumExceedsMax`.
- `update_strategy_delegate()` — admin-only. Revokes the old
  delegate, approves the new one (signed by `strategy_authority[i]`).
  Same dedupe loop as `create_strategy`.
- `deactivate_strategy()` — admin-only, permanent. Requires
  `allocated_amount == 0 && strategy_token_account.amount == 0` —
  call `deallocate_from_strategy` for the full balance first.
  Revokes delegate (signed by `strategy_authority[i]`), decrements
  `total_active_weight_bps` by the strategy's prior weight, marks
  `is_active = false`, sets weight to 0.

### Rebalancing + accounting

Authority-only entrypoints:

- `allocate_to_strategy(amount)` / `deallocate_from_strategy(amount)`
  — direct moves between reserve and strategy ATAs. Mostly
  emergency / cleanup; the user-facing flows now do this implicitly
  via deposit fan-out and withdraw auto-pull.
- `rebalance_strategy()` — weight-driven. Recomputes
  `target = total_deposited × weight_bps / 10_000`, then signs the
  appropriate leg: in-leg with `vault_authority`, out-leg with
  `strategy_authority[i]`.
- `rebalance_with_delta(delta: i64)` — explicit signed-delta version
  (Phase-5). Pushes if positive (reserve → strategy, signed by
  `vault_authority`), pulls if negative (strategy → reserve, signed
  by `strategy_authority[i]`). Reverts on overflow / underflow.

Accounting:

- `report_yield()` — reads strategy ATA balance, treats surplus over
  `allocated_amount` as yield, increments `total_deposited`.
  Pause-gated. Strategy ATA mint constrained to `vault_state.token_mint`.
- `report_loss(amount)` — counterpart for booking realised losses
  (slashing, position write-down). Subtracts from both
  `strategy.allocated_amount` and `vault_state.total_deposited` with
  underflow guards.
- `settle_strategy_value()` (Phase-5) — value-source-driven.
  Iterates the strategy's `ValueSource` registry, sums into a live
  `computed_value`, books the signed delta into both
  `strategy.allocated_amount` and `vault_state.total_deposited`.
  Replaces `report_yield` / `report_loss` for protocols where NAV
  can be derived from on-chain reads.

### Mock yield (testnet)

Real lending protocols aren't wired up yet. To exercise the
share-price math on devnet, [scripts/simulate-yield.ts](scripts/simulate-yield.ts)
mints underlying directly to a strategy ATA, then calls
`report_yield`. [scripts/crank-yield.ts](scripts/crank-yield.ts) is
the loop variant (a `--loop INTERVAL_SECONDS` flag drives a keeper
loop). Production should replace this with a real protocol integration
+ a real keeper (Clockwork / Triton / Gelato Solana / a server
cronjob).

### Action whitelisting + anti-theft

`execute_action` ([programs/my_project/src/instructions/execute_action.rs](programs/my_project/src/instructions/execute_action.rs)).
Validation chain:

1. **Sibling-instruction introspection.** Walk the `instructions`
   sysvar; reject the tx (`SiblingInstructionForbidden`) if any
   *other* instruction in the same tx has `strategy.token_account`
   at any meta slot. Covers both delegate-signed Token::transfer
   smuggles and side-channel siphons via third programs.
2. Caller must be `strategy.delegate` OR `vault_state.authority`.
3. The `target_program` AccountInfo must match the requested key.
4. An `AllowedAction` PDA must exist at
   `["allowed_action", strategy, target_program, discriminator]`;
   `vault` field cross-checked. Cooldown
   (`cooldown_secs`/`last_executed_at`) and per-action loss cap
   (`loss_per_call_bps_cap`) enforced.
5. Required `expected_recipient_index`:
   `remaining_accounts[index]` must equal `strategy.token_account`.
6. Optional `output_mint_index`: if set, the mint at that meta slot
   must be in the protocol-level `AllowedToken` allow-list.
7. Pre-snapshot caller ATA, delegate ATA, **and** strategy ATA.
8. `invoke_signed` with `strategy_authority[i]` seeds.
9. Post-reload all three ATAs. Revert `AntiTheft` if caller or
   delegate grew; revert `ActionLossExceedsCap` if strategy ATA fell
   beyond the per-action loss cap. Update `last_executed_at`. Emit
   `ActionExecuted`.

### Auto-action config + value sources (Phase-5)

Two declarative registries the agent reads off-chain:

- **`AutoActionConfig`** — one PDA per `(strategy, kind)` where
  `kind ∈ {0=Deposit, 1=Withdraw}`. Records the curator's intended
  `(target_program, discriminator, ix_data)` for what the strategy
  should do when funds enter or leave. Read off-chain by the agent;
  on-chain auto-CPI is a future phase. Set via
  `set_auto_action_config`; cleared (rent reclaim) via
  `clear_auto_action_config`.
- **`ValueSource`** — per-strategy registry, up to
  `MAX_VALUE_SOURCES_PER_STRATEGY` slots per strategy. Two kinds:
  `SplAtaBalance` reads the SPL token amount at offset 64..72;
  `AccountU64` reads a u64 at a configurable offset. Each entry
  carries `scale_num`/`scale_den` for cToken-style exchange-rate
  conversions. `settle_strategy_value` walks the registry, sums
  into `computed_value`, books the signed delta into both
  `strategy.allocated_amount` and `vault_state.total_deposited`.

### Frontend architecture

[app/src/](app/src/) is a flat-routed Next.js app:

- **All RPC traffic is direct** via `@solana/web3.js`. There is no
  server-side proxy (the EVM playbook called for one; the Solana port
  doesn't have it). RPC URL comes from `NEXT_PUBLIC_RPC_URL` or the
  cluster default in [app/src/lib/constants.ts](app/src/lib/constants.ts).
- **Vault registry is build-time.** `VAULT_REGISTRY` in
  [app/src/lib/constants.ts](app/src/lib/constants.ts) is a
  hard-coded array of 5 USDC vaults indexed by `vaultId: 0..4`. PDAs
  are derived in [app/src/lib/pda.ts](app/src/lib/pda.ts) via
  `deriveVaultPda(tokenMint, vaultId)`. There is no runtime "Add
  custom vault" dialog; adding a vault requires editing the registry.
- **Role gating is all-or-nothing.**
  [app/src/components/admin/AdminGuard.tsx](app/src/components/admin/AdminGuard.tsx)
  wraps the entire `/admin` route; if `publicKey` is not the vault's
  admin or authority, the whole page renders a "Not authorized"
  banner instead. The spec's "disable-not-hide" pattern is a roadmap
  item — see [docs/FRONTEND.md](docs/FRONTEND.md) and
  [docs/MISMATCHES.md §3](docs/MISMATCHES.md).
- **Two routes today.** `/`
  ([app/src/app/page.tsx](app/src/app/page.tsx)) is the user
  dashboard (vault list + stats + deposit/withdraw + allocation pie +
  user position). `/admin`
  ([app/src/app/admin/page.tsx](app/src/app/admin/page.tsx)) is
  the admin/authority surface (create strategy + strategy list +
  rebalance-all). The spec's per-vault `/vault/[chainId]/[address]`
  routes are not yet implemented; the active vault is held in the
  `VaultProvider` context.
- **Activity feed shipped.** [app/src/components/vault/ActivityFeed.tsx](app/src/components/vault/ActivityFeed.tsx)
  bootstraps from `getSignaturesForAddress` + `getTransaction`, then
  subscribes to `connection.onLogs`. Decodes events via Anchor's
  `BorshEventCoder`, filtered to the active vault.

## Test conventions

- [tests/my_project.ts](tests/my_project.ts) is one large file
  driven by ts-mocha + chai. The Anchor harness (`anchor test`) spins
  up a local validator and runs it.
- Test fixtures import the IDL types from `target/types/my_project.ts`
  (regenerated by `anchor build`). The frontend has its own copy of
  the IDL at [app/src/idl/my_project.ts](app/src/idl/my_project.ts) —
  keep them in sync after any program change.
- The suite covers happy paths (init, deposit, withdraw,
  create/allocate/deallocate/rebalance/deactivate strategy) and an
  extensive block of negative-path coverage in
  [tests/security.ts](tests/security.ts) for `execute_action`
  (anti-theft, recipient pin, sibling-ix introspection, cooldown,
  loss cap, output-mint allow-list, etc.).

## What's still open after Phase-5

[docs/SOLANA_VAULT_SPEC.md](docs/SOLANA_VAULT_SPEC.md) is the original
spec. The authoritative gap list is
[docs/MISMATCHES.md](docs/MISMATCHES.md); the followup queue is
[docs/FOLLOWUPS.md](docs/FOLLOWUPS.md). Open program-side items:

- **No read-only `compute_total_assets` view.** Write path is
  `settle_strategy_value` — sufficient for indexer-side aggregation.
  Add only if a consumer needs strict on-chain NAV without booking
  a delta.
- **`AutoActionConfig` is read off-chain only.** On-chain auto-CPI
  inside `deposit` / `withdraw` is deferred (see
  [docs/FOLLOWUPS.md C8](docs/FOLLOWUPS.md)).
- **Real protocol adapters not yet shipped.** `mock_kamino` /
  `mock_lulo` cover the agent flow end-to-end on devnet; mainnet
  adapters for real Kamino / Lulo / Marginfi / Drift / Jupiter
  remain.

What got built between the original Phase-3 docs and now (consolidated
view — see [docs/MISMATCHES.md §2](docs/MISMATCHES.md) for the full
table):

- ✅ Per-strategy authority PDAs; cross-strategy drains structurally
  impossible.
- ✅ Virtual-shares offset (`VIRTUAL_SHARES = 1_000_000`); u128 share
  math + checked arithmetic.
- ✅ Token-2022 `TransferHook` / `PermanentDelegate` rejection at vault init.
- ✅ Two-step admin/authority transfer.
- ✅ Phase-4a treasury fee split via `ProtocolConfig`.
- ✅ Phase-4b auto-pull on withdraw (strategy ATAs cover the shortfall).
- ✅ Phase-4d protocol-level `AllowedToken` allow-list.
- ✅ Phase-5 `ValueSource` + `settle_strategy_value` (NAV from positions).
- ✅ Phase-5 `AutoActionConfig` (off-chain-read declarative deploy intent).
- ✅ Phase-5 `rebalance_with_delta` (signed-delta authority rebalance).
- ✅ Phase-5 fan-out on deposit (weight-driven push from reserve).
- ✅ Phase-5 sibling-instruction introspection on `execute_action`.
- ✅ Phase-5 `loss_per_call_bps_cap` + `cooldown_secs` on `AllowedAction`.
- ✅ Phase-5 `_reserved` cushions on all account types.
