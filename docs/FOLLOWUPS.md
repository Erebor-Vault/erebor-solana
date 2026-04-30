# Followups — picking up after Phase 4

> **Read this first if you're a fresh Claude session.** This is the
> queue of work that wasn't built in the Phase-4a/4b/4c/4d sweep but
> is implied or scheduled by it. Each item names the goal, the scope,
> the dependencies, and where to start. Treat the order as
> recommended-not-strict — pick whichever item the user prioritises.

## Snapshot of where we are

| Phase | Shipped | Commit | Devnet tx |
|-------|---------|--------|-----------|
| 3 | per-strategy authority PDAs + 30 audit fixes | `0b2c31d` | `47gjnkMW…` |
| 4a | Treasury fee split via ProtocolConfig PDA | `85a493d` | `3J1watnX…` |
| 4b | Auto-pull on withdraw from strategy ATAs | `dc91199` | `VUi8EAwX…` |
| 4c | TS adapter framework + mockKamino + Redeem button | `6495738` | n/a (no program change) |
| 4d | Protocol-level token allow-list | `5769d83` | `5yrwS6rn…` |

State on devnet: Program at `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B`,
ProtocolConfig at `FBLN6W67RHM84iHJLgGGBmwCmNaFhGjaz24yM6Ni1pPT`, USDC
mint `5BTPntEh…` whitelisted, 5 vaults / 17 strategies seeded by
`scripts/setup-multi-vaults.ts`.

Tests: `anchor test` is 28/28 green locally. Frontend `tsc --noEmit` is
clean.

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

### C1. Sibling-instruction introspection on `execute_action` (audit #7)

The current anti-theft snapshot only sees the inner CPI dispatched by
`execute_action`. A compromised agent (delegate) can bundle a sibling
`Token::transfer` ix in the same transaction draining the strategy's
ATA via their delegate authority — the snapshot won't fire.

**Fix**: walk `instructions` sysvar inside `execute_action` and reject
the tx if any *other* instruction in the same tx:
- Targets the SPL Token program AND signs the strategy ATA's delegate
  authority. (Indicates direct drain.)
- Targets a program other than `target_program_account` AND has the
  strategy ATA as a writable account. (Indicates side-channel siphon.)

**Where**: `programs/my_project/src/lib.rs::execute_action`. Add a new
account `instructions_sysvar: AccountInfo<'info>` with `address =
sysvar::instructions::id()`. Use `solana_program::sysvar::instructions::load_*`
helpers.

**Effort**: 1 day program + tests. Important for production.

### C2. AutoActionConfig storage on Strategy (spec §6/§7.5)

Per-strategy `deposit_config` / `withdraw_config: Option<AutoActionConfig>`.
Lets the program pick which `AllowedAction` to auto-invoke during
auto-rebalance (when that lands — see C3) without the frontend
pre-flighting.

**Storage**: extend `StrategyAllocation` with two `Option<AutoActionConfig>`
fields. Each `AutoActionConfig = (allowed_action_pda, ix_data_template)`.
Layout-breaking — devnet vaults need re-init.

**Setters**: `set_deposit_config`, `set_withdraw_config`, both admin-
only.

**Effort**: 1 day storage + setters. The auto-invoke side waits for C3.

### C3. Auto-rebalance on deposit / `withdraw_config` invocation

The spec wants `deposit` to fan out into strategies by weight, and
`withdraw` to auto-invoke each strategy's `withdraw_config` to redeem
external positions before pulling. C3 = the program-side auto-invoke.
Today's Phase-4c does this from the frontend (TS orchestrator); C3
moves it on-chain.

**Tradeoffs vs current TS path**:
- Pro: works without an active frontend / agent. Simpler client-side.
- Con: protocol-specific account-derivation logic ends up in Rust;
  every new protocol is a program upgrade. Compute and account-meta
  budgets get tight with N strategies × M accounts each.

**Recommendation**: defer until at least one of:
- Two consumer types (frontend + bot + indexer) need the same logic.
- Real users hit the "agent down → withdraw stuck" failure mode.
- Compute / account costs in the TS path become problematic.

The Phase-4c TS path already covers the "vault redeems from external
protocol on withdraw" UX the user originally asked for; C3 is the
spec-purist version, not a UX win on top.

### C4. ValueSource + `compute_total_assets` (spec §6 / §8)

Replaces the current `report_yield` / `report_loss` accounting with
NAV-from-positions. Each strategy stores a list of `ValueSource`
entries (target program + reader discriminator + account-list
template). `compute_total_assets` walks them, CPIs into each, parses
the returned underlying value, sums.

**Hard part**: each protocol returns a different shape. Spec assumes
uniform `u64` return; reality has Kamino's `ObligationCollateral`
(cToken × ratio), Marginfi's `BalanceData`, Drift's `SpotPosition`
unrealised PnL, etc. Each needs a Rust adapter inside the program.

**Recommendation**: don't ship this until you have a concrete reason
to drop `report_yield` (e.g. auditor flags it). The current
admin-reported model is functional and simpler.

**Effort**: 5–7 days for the framework + 2–3 days per protocol
adapter.

### C5. `rebalance(strategy_id, delta: i64)` with explicit signed delta

Today's `rebalance_strategy` is weight-driven: it computes
`target = total_deposited × weight / 10_000`. Spec §7.6 wants the
authority to pass a signed `delta: i64` directly. Useful when the
authority wants to override the weight-driven target without changing
weights.

**Effort**: ½ day. Add an alternative entrypoint, leave the existing
one in place for back-compat.

### C6. `_reserved` slack bytes on `VaultState` / `Strategy`

Realloc cushion so future fields can land without a fresh-mint
migration. Spec §5. Add `pub _reserved: [u8; 64]` to each. Tests
will need re-init on a fresh mint.

**Effort**: 1 hour. Bundle with whichever next layout-breaking change
ships.

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

Real component reading event logs from the program (`program.addEventListener`
or polling `getSignaturesForAddress` + decoding via IDL). Today the
frontend has the [ActivityFeed](app/src/components/vault/ActivityFeed.tsx)
component but it's empty / mock.

**Effort**: 2 days. Decide between in-browser (simple, lossy) vs. an
indexer (Helius / Triton / your own). The events all exist already
post-Phase-3.

### D3. Per-strategy NAV display

Once C4 lands, surface `compute_total_assets` per strategy in the
admin dashboard. Until then, the dashboard's "allocated_amount" is
point-in-time accounting only.

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

## F. Agent (separate workstream)

[agent/src/](agent/src/) is empty. [AI_PLAN.md](AI_PLAN.md) describes
the intended design. This is its own multi-week project — out of scope
for "follow up Phase 4" but unblocks a lot of what C3 was about.

Minimum viable agent:
1. Reads vault + strategy state on a polling loop.
2. Decides per strategy whether to deposit-into-protocol or
   redeem-back-from-protocol based on a yield rule.
3. Builds and submits `execute_action` ixs using the adapters from
   `app/src/lib/adapters/` (publish them as a shared `@erebor/adapters`
   workspace package — easier than copy-paste).
4. Logs every decision + tx. Persists state to disk.
5. CLI: `bun agent --vault <pda> --interval 60s`.

Skeleton work is in [AI_PLAN.md](AI_PLAN.md). The Anthropic SDK
scaffold in `agent/package.json` exists.

---

## G. Documentation

- [OVERVIEW.md](OVERVIEW.md) — section 8 ("NAV") still describes the
  spec model. Either rewrite to match the shipped `report_yield` /
  `report_loss` model, or wait for C4.
- [MISMATCHES.md](MISMATCHES.md) — §2.3 still says introspection
  deferred. After C1, update or close that row.
- [DEPLOYMENT.md](DEPLOYMENT.md) — keep refreshing the "current"
  section after every devnet upgrade.
- [CLAUDE.md](../CLAUDE.md) — Phase 4d's token allow-list isn't
  mentioned. Add a short paragraph under "Architecture".
- [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — historical, leave alone.

---

## How to resume

If you're a fresh Claude session: read this file, then
[CLAUDE.md](../CLAUDE.md), then ask the user which item to start with.
Don't try to do all of B + C + D in one turn — each is a multi-commit
workstream.

**Recommended next move**: A1 (transfer DeFi Alpha admin) is one
click; A2 (devnet smoke test) catches anything we missed in 4a–4d
before more code gets layered on. Then B1 (real Kamino) since the
mockKamino path proved the framework works.
