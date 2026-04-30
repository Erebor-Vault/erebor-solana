# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

One Anchor program + a Next.js frontend + a (scaffolded) AI agent, all
co-located:

- **Anchor program** at [programs/my_project/](programs/my_project/) — `src/lib.rs`, `Cargo.toml`. Single program crate.
- **Tests** at [tests/my_project.ts](tests/my_project.ts) — TypeScript integration tests with ts-mocha + chai, using the Anchor IDL types regenerated from `target/types/` after every `anchor build`.
- **Frontend** at [app/](app/) — Next.js 16.2.1 (App Router), React 19, TypeScript, Tailwind 4, `@solana/wallet-adapter-react`, `@coral-xyz/anchor`. Separate `package.json`.
- **Agent scaffold** at [agent/](agent/) — `solana-agent-kit` + `@anthropic-ai/sdk`. `src/` is **not yet implemented**; only `package.json` + `tsconfig.json`. See [AI_PLAN.md](AI_PLAN.md).
- **Scripts** at [scripts/](scripts/) — TS scripts that drive deploy / vault init / strategy creation / yield simulation against devnet (or local validator).
- **Migrations** at [migrations/deploy.ts](migrations/deploy.ts) — Anchor deploy stub (empty body — real deploys go through [scripts/deploy.sh](scripts/deploy.sh) and the `init-vault.ts` family).
- **Anchor config** at [Anchor.toml](Anchor.toml), workspace at [Cargo.toml](Cargo.toml). Program id pinned to `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B` on devnet, localnet, and mainnet.

Spec, deployment, and design context worth reading before changing
behavior (in roughly this order):

- [OVERVIEW.md](OVERVIEW.md) — high-level pitch + architecture explainer (start here if you're new).
- [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) — original build spec; aspirational. Cross-check with…
- [MISMATCHES.md](MISMATCHES.md) — every place the spec diverges from what's actually shipped today.
- [FRONTEND.md](FRONTEND.md) — current snapshot of the dashboard.
- [FRONTEND_PLAN.md](FRONTEND_PLAN.md) — forward-looking frontend roadmap + open questions.
- [DEPLOYMENT.md](DEPLOYMENT.md) — live devnet program + per-vault PDA derivations.
- [AI_PLAN.md](AI_PLAN.md) — the AI agent's intended design.
- [PLAN.md](PLAN.md) — historical implementation checklist (some items remain open; see MISMATCHES.md for current state).

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

### Agent (run from [agent/](agent/))

```bash
cp .env.example .env     # fill in ANTHROPIC_API_KEY + agent keypair + RPC
bun install
bun run start            # tsx src/index.ts — currently fails: src/ is empty
```

The agent is a scaffold. See [AI_PLAN.md](AI_PLAN.md) for the
intended design.

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
3. **`execute_action` is fully built** (Phase-2). Allowed-action
   whitelist via `AllowedAction` PDAs; required `expected_recipient_index`;
   pre/post snapshot of *both* caller's ATA and `strategy.delegate`'s
   ATA — anti-theft fires if either grows. Sibling-instruction
   introspection (instruction sysvar walking) is still deferred — see
   [MISMATCHES.md §2.3](MISMATCHES.md).
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

`withdraw(shares_to_burn)`:

1. Compute `underlying = shares × (assets + 1) / (supply + VIRTUAL_SHARES)`
   in u128, then downcast to u64 with overflow guard.
2. Require `reserve_ata.amount >= underlying` (audit #25 — checked
   first, before any work). Reverts with `InsufficientReserve` if
   short; an authority must call `deallocate_from_strategy` or
   `rebalance_strategy` to free up reserve.
3. CPI `token::burn` user shares.
4. CPI `token::transfer` (signed by **`vault_authority`**) reserve →
   `user_token_ata`. Then a second transfer of the performance fee
   to the admin's ATA (created on demand via `init_if_needed` —
   audit #11).
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

### Rebalancing + yield/loss (manual today)

Four rebalancing/accounting entrypoints:

- `allocate_to_strategy(amount)` — authority-only. CPI transfer
  reserve → strategy ATA, signed by **`vault_authority`** (the
  reserve's owner). Increments `strategy.allocated_amount`.
- `deallocate_from_strategy(amount)` — authority-only. CPI transfer
  strategy ATA → reserve, signed by **`strategy_authority[i]`** (the
  strategy ATA's owner). Decrements `allocated_amount`. Pause-gated
  (audit #19).
- `rebalance_strategy()` — **authority-only** (audit #5). Recomputes
  `target = total_deposited * weight_bps / 10_000`, then signs the
  appropriate leg: in-leg with `vault_authority`, out-leg with
  `strategy_authority[i]`.
- `report_yield()` — authority-only. Reads strategy ATA balance,
  treats surplus over `allocated_amount` as yield, increments
  `total_deposited`. Pause-gated (audit #20). Mint of the strategy
  ATA is constrained to `vault_state.token_mint` (audit #14).
- `report_loss(amount)` — authority-only, NEW (audit #6). Subtracts
  `amount` from both `strategy.allocated_amount` and
  `vault_state.total_deposited`; reverts if it'd underflow either.
  This is the counterpart to `report_yield` for booking realised
  losses (e.g. a slashing event or an external position write-down).

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

`execute_action` is built. The validation chain at
[lib.rs](programs/my_project/src/lib.rs):

1. Caller must be `strategy.delegate` OR `vault_state.authority`.
2. The `target_program` AccountInfo must match the requested key.
3. An `AllowedAction` PDA must exist at
   `["allowed_action", strategy, target_program, discriminator]` —
   that PDA's `vault` and `strategy` fields are cross-checked
   (audit #24 closes the cross-vault-PDA hole).
4. `expected_recipient_index` is required (audit #8, no longer
   `Option`). `remaining_accounts[expected_recipient_index]` must
   equal `strategy.token_account` — pins the strategy ATA into the
   relayed instruction at a known slot.
5. Pre-snapshot **both** `caller_token_ata.amount` and
   `delegate_token_ata.amount` (audit #30 — covers the case where
   the authority is caller but the relayed ix routes funds to the
   agent's wallet).
6. `invoke_signed` the relayed instruction with **`strategy_authority[i]`**
   seeds. Inside the metas, mark `strategy_authority` as a signer.
7. Reload both ATAs; revert with `AntiTheft` if either grew.

What's still **deferred** (see [MISMATCHES.md §2.3](MISMATCHES.md)):
sibling-instruction introspection via the instructions sysvar. The
balance snapshot catches direct siphons but not multi-instruction
attacks where the agent stages a Token::transfer in a sibling ix.

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
  item — see [FRONTEND.md](FRONTEND.md) and
  [MISMATCHES.md §3](MISMATCHES.md).
- **Two routes today.** `/`
  ([app/src/app/page.tsx](app/src/app/page.tsx)) is the user
  dashboard (vault list + stats + deposit/withdraw + allocation pie +
  user position). `/admin`
  ([app/src/app/admin/page.tsx](app/src/app/admin/page.tsx)) is
  the admin/authority surface (create strategy + strategy list +
  rebalance-all). The spec's per-vault `/vault/[chainId]/[address]`
  routes are not yet implemented; the active vault is held in the
  `VaultProvider` context.
- **No activity feed.** Blocked on the program adding `#[event]`
  emissions — see [MISMATCHES.md §2.5](MISMATCHES.md).

## Test conventions

- [tests/my_project.ts](tests/my_project.ts) is one large file
  driven by ts-mocha + chai. The Anchor harness (`anchor test`) spins
  up a local validator and runs it.
- Test fixtures import the IDL types from `target/types/my_project.ts`
  (regenerated by `anchor build`). The frontend has its own copy of
  the IDL at [app/src/idl/my_project.ts](app/src/idl/my_project.ts) —
  keep them in sync after any program change.
- The suite covers the happy paths (init, deposit, withdraw,
  create/allocate/deallocate/rebalance/deactivate strategy) and a
  block of error cases (unauthorized, zero amounts, insufficient
  reserve, inactive strategy). Coverage of the spec's anti-theft /
  introspection paths is **0%**, because those instructions don't
  exist yet.

## Things the spec says but the code does NOT do

[SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) is the original build
spec; it is partly aspirational. Verify before relying on it. The
authoritative gap list is [MISMATCHES.md](MISMATCHES.md). Highlights
that remain *open* after the Phase-3 refactor:

- **No instruction-sysvar introspection in `execute_action`** (audit
  #7, deferred). Sibling-instruction attacks aren't caught — the
  balance-snapshot anti-theft only sees the inner CPI.
  [MISMATCHES.md §2.3](MISMATCHES.md).
- **No auto-rebalance on deposit/withdraw.** Deposits sit in the
  reserve; withdrawals revert when the reserve can't cover. Authority
  must manually rebalance first. [MISMATCHES.md §2.8](MISMATCHES.md).
- **`report_yield` is extra**, not in spec — the spec wants NAV
  computed live from value-source CPIs. [MISMATCHES.md §2.2](MISMATCHES.md).
- **Agent `src/` is empty.** [MISMATCHES.md §4](MISMATCHES.md).
- **No `ValueSource` / `AutoActionConfig` accounts yet.** The
  `AllowedAction` PDA is built; its sister registries are not.

Closed by the Phase-3 refactor (see [REFACTOR_PLAN.md](REFACTOR_PLAN.md)):

- ✅ **Per-strategy authority PDAs.** `vault_authority` and
  `strategy_authority[i]` replace `vault_state` as CPI signers.
  Cross-strategy drains structurally impossible.
- ✅ **Virtual-shares offset.** `VIRTUAL_SHARES = 1_000_000` baked
  into deposit/withdraw share math.
- ✅ **Token-2022 hook rejection.** `initialize_vault` rejects mints
  carrying `TransferHook` or `PermanentDelegate` extensions.
- ✅ **Authority-only rebalance.** `rebalance_strategy` now requires
  the authority signer.
- ✅ **Weight-sum cap.** Sum of `target_weight_bps` across active
  strategies is enforced ≤ 10 000 bps.
- ✅ **Two-step admin/authority transfer.** `propose_admin` +
  `accept_admin`; `propose_authority` + `accept_authority`. The
  one-step `transfer_admin` / `set_authority` are removed.
- ✅ **Pause coverage on deallocate + report_yield.**
- ✅ **u128 share math + checked arithmetic everywhere.**
- ✅ **`init_if_needed` admin ATA on withdraw** (no more "fee-flow
  blocked because admin never opened an ATA").
- ✅ **`report_loss` instruction** for booking realised losses.
- ✅ **Required `expected_recipient_index` on `AllowedAction`.**
- ✅ **`allowed_action.vault == vault_state.key()` constraint on
  `execute_action`.**
