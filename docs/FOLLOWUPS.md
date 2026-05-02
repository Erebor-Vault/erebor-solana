# Followups — picking up after Phase 4

> **Read this first if you're a fresh Claude session.** This is the
> queue of work that wasn't built in the Phase-4a/4b/4c/4d sweep but
> is implied or scheduled by it. Each item names the goal, the scope,
> the dependencies, and where to start. Treat the order as
> recommended-not-strict — pick whichever item the user prioritises.

## Snapshot of where we are

| Phase | Shipped |
|-------|---------|
| 3 | per-strategy authority PDAs + 30 audit fixes |
| 4a | Treasury fee split via ProtocolConfig PDA |
| 4b | Auto-pull on withdraw from strategy ATAs |
| 4c | TS adapter framework + mockKamino + Redeem button |
| 4d | Protocol-level token allow-list |
| 5 | Value sources + NAV settle, AutoActionConfig, signed-delta rebalance, allowed-action loss caps + cooldown, sibling-instruction introspection, fan-out on deposit, `_reserved` cushions |

Live program id: `FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo`.

---

## A. Live operational items (do these regardless)

### A1. DeFi Alpha admin/authority transfer is **pending**

`scripts/transfer-vault-admin.ts` has already proposed admin +
authority on vault 4 (`EAZxaw…`) to `8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv`.
Until `8qKt…` calls `accept_admin` + `accept_authority` from their own
keypair, the live admin/authority remains the deployer (`4wrBiaN…`).

The frontend's [PendingRoleBanner](app/src/components/vault/PendingRoleBanner.tsx)
shows "Accept admin" / "Accept authority" buttons when the connected
wallet matches `vault.pending_admin` / `vault.pending_authority`. So:
hand the `8qKt…` wallet the URL `/vault/EAZxaw…/admin` or
`/vault/EAZxaw…`, they click, transfer finalises.

### A2. End-to-end smoke test on devnet

Open the frontend (`bun run dev` in `app/`), connect a devnet wallet
funded via `solana airdrop 2 --url devnet`, exercise:

- Deposit on each vault → user receives shares.
- Withdraw — both the small-amount-fits-in-reserve case and the
  large-amount-needs-auto-pull case (Phase 4b).
- Verify the treasury wallet (`4wrBiaN…`'s underlying ATA) accumulates
  2 % of every withdrawal.
- Admin: pause/unpause, change performance fee, create a strategy,
  rotate delegate.
- Governance: open the AllowedTokensPanel, add then remove a
  throwaway mint to make sure the gate works.

Catch any UX papercuts now while context is fresh.

### A3. Mainnet deployment checklist (deferred until ready)

Not started. When user signals go-time:

1. Lock IDL / bytecode hash. Tag the repo.
2. Build with `--release`, deterministic if `verifiable: true` makes
   sense.
3. Get an independent third-party audit pass on the program (Halborn,
   OtterSec, Neodyme).
4. Pre-fund a multisig for `ProtocolConfig.governance` and the program
   upgrade authority. Squads is the standard.
5. Deploy program to mainnet under the multisig as upgrade authority.
6. `initialize_protocol_config` with the multisig PDA as `governance`
   and a separate cold treasury wallet as `treasury`.
7. Whitelist the mainnet token mints you'll actually accept (USDC,
   USDT, …) via `add_allowed_token`.
8. Initialise vaults under the same multisig as admin (or hand off
   immediately via `propose_admin`).
9. Update `app/src/lib/constants.ts` to point at mainnet program +
   mints. Build + deploy frontend.

---

## B. Adapter ecosystem (Phase 4c follow-on, TS only — no program upgrades)

The adapter framework at [app/src/lib/adapters/](app/src/lib/adapters/)
is the single seam. Each new protocol is one file implementing
`RedeemAdapter` from `types.ts`, registered in `index.ts`. The redeem
ix MUST be a whitelisted `AllowedAction` first — admin sets that up
through the per-strategy `AllowedActionsEditor`.

### B1. Real Kamino Lend mainnet adapter

**Where**: new file `app/src/lib/adapters/kamino.ts`. Mirror the shape
of `mockKamino.ts` but against Kamino's real account hierarchy:

- Program ID: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`.
- Account model: `LendingMarket` → `Reserve` (per asset) → `Obligation`
  (per user). Users supply liquidity → receive cTokens (collateral).
- Read path: derive the strategy's obligation; read its
  `deposits[reserve_index].deposited_amount` (cTokens); pull reserve's
  `liquidity_to_collateral_ratio`; compute available underlying.
- Withdraw discriminator: `withdraw_obligation_collateral_and_redeem_reserve_collateral`,
  Anchor disc `[0xb1, 0x40, 0x2d, 0x2c, 0x05, 0x99, 0x8d, 0x05]`
  (matches the existing preset in `actionPresets.ts`).
- Account list per Kamino docs / IDL — ~14 accounts; verify against
  https://github.com/Kamino-Finance/klend before shipping.

**Effort**: 1–2 days including verifying account derivations against a
live Kamino position.

**Dependency**: nothing — the program supports it today.

### B2. Jupiter v6 swap adapter

**Where**: replace the stub at `app/src/lib/adapters/jupiter.ts`.

- Add `@jup-ag/api` (v6) dep to `app/package.json`.
- `readPosition`: scan `strategy_authority`'s ATAs for non-USDC mints
  with non-zero balance. Quote each via Jupiter's `/quote?inputMint=X&outputMint=USDC`.
  Return the best quote's `outAmount` as `underlyingAvailable`.
- `buildRedeemAction`: call `/swap-instructions` with the quote; the
  response gives `swapInstruction` (program ID + accounts + data).
  Repackage as `execute_action(JUPITER_V6, ROUTE_DISC, swapInstruction.data)`
  with `remaining_accounts = swapInstruction.keys`. Set
  `output_mint_index` on the `AllowedAction` to wherever USDC sits in
  the swap accounts (Jupiter route layout: position 4 typically, but
  varies; verify per-route).
- Lookup tables: Jupiter routes ship address-lookup tables. The
  `Transaction` we build needs to include them or be a v0
  `VersionedTransaction`.

**Effort**: 2–3 days including the LUT-handling polish.

**Dependency**: token allow-list (✅ Phase 4d) — already required.
Mainnet token mints whitelisted is the operational gate.

### B3. Marginfi v2 / Drift v2 adapters

Same shape as Kamino. Marginfi: `lending_account_withdraw`. Drift:
`withdraw`. Discriminators are already in
[app/src/lib/actionPresets.ts](app/src/lib/actionPresets.ts) but
without `expectedRecipientIndex` for the withdraw side — admins must
verify and fill that when whitelisting.

**Effort**: 1 day each, after Kamino/Jupiter are in.

---

## C. Program followups

### C1–C6. Closed by Phase-5

- ✅ **C1 — Sibling-instruction introspection** ([execute_action.rs](../programs/my_project/src/instructions/execute_action.rs)). Walks the `instructions` sysvar; rejects any sibling ix that touches `strategy.token_account` at any meta slot via `SiblingInstructionForbidden`. Broader than the original C1 proposal — covers delegate-signed Token::transfer *and* third-program siphons without special-casing the SPL Token program.
- ✅ **C2 — AutoActionConfig** ([set_auto_action_config.rs](../programs/my_project/src/instructions/set_auto_action_config.rs), [clear_auto_action_config.rs](../programs/my_project/src/instructions/clear_auto_action_config.rs)). One PDA per `(strategy, kind)` recording `(target, disc, ix_data)`. Read off-chain by the agent; on-chain auto-invoke deferred (see C3 below).
- ✅ **C3 — Fan-out on deposit + auto-pull on withdraw** ([deposit.rs](../programs/my_project/src/instructions/deposit.rs), [withdraw.rs](../programs/my_project/src/instructions/withdraw.rs)). Caller passes strategy account triples in `remaining_accounts`; deposit pushes by weight, withdraw pulls in caller order. The `withdraw_config`-driven auto-CPI is still off-chain (TS adapter orchestrator at [app/src/lib/adapters/](../app/src/lib/adapters/)); on-chain auto-invoke remains deferred.
- ✅ **C4 — ValueSource + settle** ([add_value_source.rs](../programs/my_project/src/instructions/add_value_source.rs), [remove_value_source.rs](../programs/my_project/src/instructions/remove_value_source.rs), [settle_strategy_value.rs](../programs/my_project/src/instructions/settle_strategy_value.rs)). Per-strategy registry of `(kind, target, offset, scale)` entries. `settle_strategy_value` reads them, sums into a live `computed_value`, books the signed delta into both `strategy.allocated_amount` and `vault.total_deposited`. The read-only `compute_total_assets` view is **still missing** (write path is sufficient for indexer-side aggregation; add only if needed).
- ✅ **C5 — `rebalance_with_delta`** ([rebalance_with_delta.rs](../programs/my_project/src/instructions/rebalance_with_delta.rs)). Authority-only, signed `delta: i64`.
- ✅ **C6 — `_reserved` cushions** on `VaultState` (64 B), `StrategyAllocation` (32 B), `AllowedAction` (32 B), `ValueSource` (32 B).

### C7. Read-only `compute_total_assets` view (spec §8)

The write path (`settle_strategy_value`) is shipped, so an indexer
can compute NAV by replaying `StrategyValueSettled` events. A pure
read-only view ix would let the frontend / agent compute live NAV
without booking a delta.

**Recommendation**: defer. The Phase-4c TS adapter framework already
covers the "live NAV in the dashboard" UX, and `settle_strategy_value`
covers the "book the delta into accounting" need. Add only if a
consumer needs strict on-chain NAV without a state mutation.

### C8. On-chain auto-invoke of `AutoActionConfig` on deposit / withdraw

`AutoActionConfig` is read off-chain today. The spec-purist version
would have `deposit` / `withdraw` auto-CPI into the recorded
`(target, disc, ix_data)` per strategy.

**Tradeoff**: same as the original C3 — protocol-specific
account-derivation logic ends up in Rust, and compute / account-meta
budgets get tight with N strategies. Defer until two consumer types
need the same logic, or until users hit the "agent down → withdraw
stuck" failure mode in practice.

---

## D. Frontend followups

### D1. "Disable-not-hide" admin gating (MISMATCHES.md §3)

Today's `AdminGuard` is all-or-nothing — non-admin wallets see "Not
authorized" and zero controls. Spec wants individual controls disabled
with hover tooltips explaining the role. Better discoverability.

**Where**: refactor `AdminGuard` into a `useRoles()`-driven set of
`disabled` props on each child. Already partially done on the
strategy detail page (`useRoles` exists); extend to the vault admin
page.

**Effort**: 1 day. Cosmetic but improves "what does an authority do?"
discoverability.

### D2. Activity feed

✅ Shipped — [ActivityFeed.tsx](../app/src/components/vault/ActivityFeed.tsx)
bootstraps from `getSignaturesForAddress` + `getTransaction`, then
subscribes via `connection.onLogs`, decodes with Anchor's
`BorshEventCoder`. May want an indexer-backed version later for
deep history; the in-browser path is sufficient for live operations.

### D3. Per-strategy NAV display

Surface live NAV per strategy in the admin dashboard by reading each
strategy's `ValueSource` registry and computing the same sum
`settle_strategy_value` would book. The frontend can then show a
"drift since last settle" indicator and offer a button that calls
`settle_strategy_value` on demand.

---

## E. Testing & integration

### E1. Property / fuzz tests for invariants

Currently `tests/my_project.ts` is integration-style. Invariant checks
are inline. Move to a dedicated suite (Anchor's `bankrun` is faster
than spinning local validator each time):

- `total_deposited == reserve.amount + Σ strategy.allocated_amount` after every
  state-mutating ix.
- `Σ strategy.target_weight_bps for active ≤ 10_000`.
- `share_price` (= `total_deposited / share_supply`) is monotonic
  through deposit + withdraw (modulo virtual-shares offset).
- Performance fee's protocol cut ≤ `protocol_config.protocol_fee_bps`,
  curator cut ≥ 0.

**Effort**: 3–5 days for a meaningful coverage.

### E2. Fuzz-test the auto-pull edge cases

Generate random orderings of (deposit, withdraw, allocate, deallocate,
report_yield, report_loss, rebalance, set_paused, withdraw_with_pull)
and check that none lead to stuck funds, negative `allocated_amount`,
or unsoundness in the share-price calc.

### E3. Real Kamino integration test

Once B1 lands, write a scripted test that:
- Initialises a vault on a forked mainnet (Bankrun supports forks).
- Allocates to a strategy.
- Has the agent CPI into Kamino deposit via `execute_action`.
- Triggers a withdraw on the frontend; verifies the full
  redeem→auto-pull→fee-split chain works.

---

## F. Agents

✅ Two agents shipped: [agent/lulo/](../agent/lulo/) and
[agent/kamino_looper/](../agent/kamino_looper/), both routing through
`execute_action` against `mock_lulo` / `mock_kamino`. See
[OVERVIEW.md](OVERVIEW.md) and the agent-specific READMEs.

Open agent followups:
- Real Kamino mainnet adapter (B1 above) — would replace `mock_kamino`
  as the loop target.
- Real Lulo mainnet adapter — same shape as B1.
- `@erebor/adapters` shared workspace package — both agents currently
  duplicate parts of the chain layer that belong in
  [app/src/lib/adapters/](../app/src/lib/adapters/).

---

## G. Documentation

- [OVERVIEW.md](OVERVIEW.md) — verify NAV section reflects
  `settle_strategy_value` / `ValueSource` flow.
- [DEPLOYMENT.md](DEPLOYMENT.md) — keep refreshing the "current"
  section after every devnet upgrade.
- [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — historical, leave alone.

---

## How to resume

If you're a fresh Claude session: read this file, then
[CLAUDE.md](../CLAUDE.md), then ask the user which item to start with.

**Recommended next move**: B1 (real Kamino mainnet adapter) since the
mockKamino path proved the framework, and D1/D2/D3 (allowed-action
editor + value-source UI + auto-action config UI) since the
program-side is fully shipped and the frontend lags.
