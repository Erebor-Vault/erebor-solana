# Strategy Configuration Presets — Design

**Date:** 2026-05-03
**Status:** Approved, ready for implementation plan
**Scope:** Frontend admin UX + on-chain `PythPriceFeed` `ValueSource` + `mock_pyth` program + price keeper

## Goal

Replace the current piecewise admin flow (manual `set_allowed_action` / `set_auto_action_config` / `add_value_source` calls per strategy) with a small set of curated **strategy presets** that bundle the right on-chain config for the four protocols we target: Kamino, Lulo, Jupiter, Raydium.

A preset = a name + a function that emits the bundle of ixs needed to fully configure a strategy for a given protocol intent.

## Decisions

1. **Frontend-only bundles, with one on-chain extension.** Presets compile to existing ixs (`set_allowed_action`, `set_auto_action_config`, `add_value_source`, etc.) — no new strategy-config ixs. The one on-chain change is a new `ValueSource` variant `PythPriceFeed` so swapper NAV can be computed by `settle_strategy_value` instead of agent-reported.
2. **Per-cluster `PROTOCOL_REGISTRY`.** Devnet entries point at the in-workspace `mock_kamino` / `mock_lulo` / `mock_pyth` programs; mainnet entries point at real Kamino / Lulo / Jupiter v6 / Raydium / Pyth IDs. Same preset code drives both clusters.
3. **Preset picker at create-time + change-preset action on existing strategy cards** with explicit revoke/add diff confirmation.
4. **Four presets:** Kamino Liquidity, Kamino Looper, Lulo Lending, Raydium Swapper. Jupiter is folded into the Raydium Swapper's allowed-program set rather than its own preset.
5. **Token allow-list stays curator-managed at the vault level.** The Raydium Swapper preset references the vault's existing `AllowedToken` set via `output_mint_index`; it does not write `add_allowed_token` calls.
6. **Mock Pyth on devnet, real Pyth on mainnet** — same on-chain reader, just different price account addresses in the registry.

## Architecture

### Frontend

New module: `app/src/lib/strategy-presets/`

- **`registry.ts`** — per-cluster `PROTOCOL_REGISTRY` keyed by cluster (`devnet` | `mainnet-beta`). Each protocol entry exposes `programId`, `discriminators` (`{ deposit, withdraw, borrow, repay, swap, ... }`), and a `valueSource` descriptor (`accountResolver` function, offset, `scaleNum`/`scaleDen`). The registry also holds `priceFeeds: Record<mint, Pubkey>` mapping every allow-listable mint to a price account (mock on devnet, real on mainnet).
- **`presets.ts`** — four `StrategyPreset` objects. Each is a pure function `buildPresetIxs(ctx) → TransactionInstruction[]` returning the bundle for a given `(vault, strategyId, cluster, overrides)`.
- **`diff.ts`** — given a strategy's *current* on-chain state and a *target* preset, returns `{ toRevoke: AllowedAction[], toAdd: AllowedAction[], valueSourcesToReplace: ValueSource[] }`. Drives the "change preset" modal.

UI surfaces (admin-only, gated by existing `AdminGuard`):

- **Create-strategy form** in [app/src/app/admin/page.tsx](../../../app/src/app/admin/page.tsx) gets a "Preset" dropdown at the top: `Custom` (today's blank flow) | the four presets. Picking a preset disables redundant manual fields and shows a read-only summary of the bundle. The "Create" button submits a sequenced bundle: tx1 = `create_strategy`, tx2..txK = preset ixs in chunks (1232-byte tx limit).
- **Each strategy card** gets a `Preset: <name or Custom>` line and a `Change preset…` button. The detected label runs `diff()` in reverse: for each known preset, compute empty-target diff vs current state; first preset with empty diff wins, otherwise `Custom`.

### On-chain extension

- New `ValueSource` variant `PythPriceFeed { mint_balance_source_index: u8, price_account: Pubkey, max_staleness_secs: u32 }`.
  - Reads the canonical Pyth `PriceAccount` wire format: `price: i64`, `expo: i32`, `conf: u64`, `publish_time: i64` at their canonical offsets.
  - Reverts on `now - publish_time > max_staleness_secs`.
  - Reads balance from the value source at `mint_balance_source_index` (must resolve to an `SplAtaBalance` entry).
  - Applies expo, multiplies balance × price, contributes to `computed_value` (always non-negative — strategy delta sign comes from net change vs `allocated_amount`, same as today).
- New `mock_pyth` program at `programs/mock_pyth/` mirrors Pyth's `PriceAccount` layout exactly so the same reader works against real Pyth on mainnet. Exposes a single `set_price(price: i64, expo: i32)` ix gated by an admin keypair.

### Keeper

- New script `scripts/crank-mock-prices.ts`: loops over the cluster's allow-list mints, fetches CoinGecko spot, writes `mock_pyth` price accounts. Mirrors the shape of [scripts/crank-yield.ts](../../../scripts/crank-yield.ts) (`--loop INTERVAL_SECONDS`).

## Per-preset bundles

### Kamino Liquidity
- `set_allowed_action × 2` → Kamino Lend `deposit`, `withdraw`. `expected_recipient_index` pinned to strategy ATA, `output_mint_index` = none, `cooldown_secs` = 0, `loss_per_call_bps_cap` = 100 (1%).
- `set_auto_action_config(kind=Deposit)` → Kamino `deposit` ix template.
- `set_auto_action_config(kind=Withdraw)` → Kamino `withdraw` ix template.
- `add_value_source × 1` → `AccountU64` reading the strategy's Kamino reserve-collateral account, `scale_num`/`scale_den` set from the reserve's current collateral exchange rate (recomputed off-chain at config time; `settle_strategy_value` re-reads on demand).

### Kamino Looper
Kamino Liquidity, plus:
- `set_allowed_action × 2` more → `borrow`, `repay`.
- `add_value_source × 1` more → `AccountU64` for the borrowed-debt account (signed-negative path booked via the existing `settle_strategy_value` delta).

### Lulo Lending
- `set_allowed_action × 2` → Lulo `lend`, `redeem` (matches the discriminators [agent/lulo/](../../../agent/lulo/) already issues against `mock_lulo`).
- `set_auto_action_config(kind=Deposit)` → Lulo `lend`.
- `set_auto_action_config(kind=Withdraw)` → Lulo `redeem`.
- `add_value_source × 1` → `AccountU64` reading Lulo's position account.

### Raydium Swapper
- `set_allowed_action × N` → swap discriminators on Raydium CLMM, Raydium AMM v4, and Jupiter v6. `output_mint_index` = set (enforces vault-level `AllowedToken`); `expected_recipient_index` pinned to strategy ATA; `cooldown_secs` = 0; `loss_per_call_bps_cap` = 50 (0.5%, tighter — slippage is the main risk).
- No `set_auto_action_config` (no canonical deposit/withdraw action for a swapper).
- `add_value_source × 2N`: for each mint in the vault's `AllowedToken` set,
  1. `SplAtaBalance { mint }` (let its index be `i`).
  2. `PythPriceFeed { mint_balance_source_index: i, price_account: registry.priceFeeds[mint], max_staleness_secs: 60 }`.
  - Net effect: `settle_strategy_value` walks the registry, sums `balance × price` across every allow-listed mint, books the delta. Trust-minimized NAV end-to-end.

All numeric defaults (cooldowns, loss caps, max staleness) are exposed as overridable fields in the create-strategy form.

## Data flow

### Create-strategy with preset
1. User picks preset + fills weight, delegate, and any overrides.
2. UI calls `buildPresetIxs({ vault, strategyId: vault.strategy_count, cluster, overrides })`.
3. Submit a sequenced bundle: tx1 = `create_strategy`, tx2..txK = preset ixs in chunks. Stepper shows progress; aborts on first failure (no auto-rollback — partial state is recoverable via the diff path).
4. On success, refresh strategy list; new card displays `Preset: <name>`.

### Change preset on existing card
1. User clicks "Change preset…", picks a target.
2. UI fetches current `AllowedAction[]`, `AutoActionConfig` for kinds 0/1, `ValueSource[]`.
3. `diff(current, target)` → `{ toRevoke, toAdd, valueSourcesToReplace }`. Modal renders a checklist; user confirms.
4. Submit sequenced bundle: revokes first (`clear_allowed_action`, `clear_auto_action_config`, value-source removals), then adds. Same chunking rules.

### Error handling
- Tx simulation runs before send; sim failures show the Anchor error name + offending ix index.
- Mid-bundle failure leaves state partially configured. UI re-runs `diff` on next render so the user can resume by re-applying.
- Cluster mismatch (no registry entry for active cluster) disables the preset dropdown with an explanatory tooltip.

## Testing

- Unit tests for `buildPresetIxs` per preset (snapshot the ix bytes against the devnet registry).
- Unit tests for `diff` (each preset → itself = empty diff; A → B = expected revoke/add lists).
- Unit tests for the on-chain `PythPriceFeed` reader (synthetic price accounts at known offsets, including stale-revert and expo edge cases).
- E2e test in [tests/my_project.ts](../../../tests/my_project.ts) per preset:
  - Build the preset bundle, send against `mock_*` programs.
  - Run a deposit → `execute_action` → withdraw cycle and assert action gating.
  - For Raydium Swapper: deploy `mock_pyth`, set a price via the keeper script, swap into an allow-list mint (mock swap target — extend `mock_kamino` with a tiny swap stub), call `settle_strategy_value`, assert NAV reflects new mint × price.

## Out of scope (explicit YAGNI)

- **No new strategy-config ixs.** Everything but `PythPriceFeed` ships through existing ixs.
- **No real mainnet program-ID wiring in this spec.** Mainnet entries in `PROTOCOL_REGISTRY` land as a separate task (needs IDL fetch + offset verification per protocol).
- **No new vault-level allow-list management UI.** The Raydium Swapper preset only references the curator's `AllowedToken` set; managing that set stays with whichever surface owns it today.
- **No retroactive labelling for hand-rolled "almost-matching" strategies.** Diff has to be empty; otherwise `Custom`.
- **No automatic resume engine.** The diff path lets users re-apply manually.
- **No automatic price-feed registration on `AllowedToken` changes.** If the curator adds a mint to the vault allow-list later, the user re-applies the preset (the change-preset flow handles the diff).
- **No mainnet Pyth wiring inside this spec.** The on-chain `PythPriceFeed` reader works against real Pyth by construction (same wire format), but flipping `priceFeeds` to real Pyth addresses is a follow-up wiring task.
