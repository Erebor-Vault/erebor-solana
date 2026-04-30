# Erebor Frontend — Plan

> **Purpose.** Forward-looking roadmap for the Erebor dashboard at
> [app/](app/): what is shipped, what is *next*, and the open
> design questions that gate future work. For a complete description
> of the current implementation see [FRONTEND.md](FRONTEND.md). For
> spec-vs-code gaps see [MISMATCHES.md](MISMATCHES.md). Items that
> need a program change first are in
> [SOLANA_VAULT_SPEC.md §15](SOLANA_VAULT_SPEC.md) +
> [MISMATCHES.md §2](MISMATCHES.md).

---

## 1. North star

A non-custodial dashboard for AI-agent-operated Solana vaults that:

- Lets a user deposit / withdraw / monitor positions across **many
  vaults on many clusters** without trusting any one operator.
- Lets an admin curate strategies, set weights, whitelist
  `(target_program, discriminator)` actions (per spec
  [§7.5](SOLANA_VAULT_SPEC.md)), register value sources, rotate
  delegates — without ever touching the AI agent's keypair.
- Lets an authority push / pull funds between the reserve and a
  strategy as a manual override.
- Surfaces the **per-strategy whitelist publicly** so users can audit
  every delegate's blast radius themselves.

Every audience gets the same URL and the same controls — **role
gating disables, never hides** — so the UI is its own documentation
of what each role can do.

---

## 2. Status — what's actually shipped

The MVP described below is implemented; see [FRONTEND.md](FRONTEND.md)
for full per-component coverage.

- **Multi-vault landing** with vault list + active-vault stats +
  deposit/withdraw + allocation pie + user position
  ([app/src/app/page.tsx](app/src/app/page.tsx)).
- **Admin panel** with strategy creation + per-strategy card
  (weight / delegate / deactivate / allocate / deallocate) + a
  rebalance-all action
  ([app/src/app/admin/page.tsx](app/src/app/admin/page.tsx)).
- **Wallet adapter integration**
  ([app/src/components/providers/SolanaProvider.tsx](app/src/components/providers/SolanaProvider.tsx))
  + role-aware navbar
  ([app/src/components/layout/Navbar.tsx](app/src/components/layout/Navbar.tsx)).
- **Build-time vault registry**
  ([app/src/lib/constants.ts](app/src/lib/constants.ts)) with
  on-chain PDA derivation
  ([app/src/lib/pda.ts](app/src/lib/pda.ts)).

Everything else listed in the EVM playbook (server-side RPC proxy,
runtime add-vault dialog, allowed-action editor, value-source editor,
config editor, signed-delta authority rebalance, activity feed) is a
roadmap item — see §3, §4.

---

## 3. Roadmap — high-impact next slices

### 3.1 Add custom vault dialog

[app/src/lib/constants.ts](app/src/lib/constants.ts) is build-time
only. A runtime dialog mirroring the EVM playbook's
`AddCustomVaultDialog` would:

1. Accept a paste of `(token_mint, vault_id)` (or a single Vault PDA).
2. Validate by `program.account.vaultState.fetchNullable(vaultPda)`.
3. If found, also fetch `getMint(token_mint)` to learn decimals +
   symbol (or accept a manual `tokenSymbol`).
4. Persist to `localStorage` under `erebor:customVaults`.
5. Merge with `VAULT_REGISTRY` via a `useVaults` hook (new — analogue
   of [`useStrategies`](app/src/hooks/useStrategies.ts)).

Misconfigured / wrong-cluster entries should render an `unreachable`
destructive badge instead of crashing.

### 3.2 Disable-not-hide role gating

🟡 **Started.** [useRoles.ts](app/src/hooks/useRoles.ts) exposes
`{ connected, isAdmin, isAuthority }` keyed by the active vault's
on-chain admin/authority pubkeys. The new
[PauseToggle.tsx](app/src/components/admin/PauseToggle.tsx) uses it
to render the control for everyone but pass `disabled={!isAdmin}`.

Follow-up: rewire the existing admin controls
([CreateStrategyForm](app/src/components/admin/CreateStrategyForm.tsx),
[StrategyCard](app/src/components/admin/StrategyCard.tsx),
`rebalanceAll` button) the same way, then drop or relax the
[`AdminGuard`](app/src/components/admin/AdminGuard.tsx) wrapper so
non-admin visitors can see the admin surface in read-only mode.

### 3.3 Activity feed

✅ **Shipped.** [ActivityFeed.tsx](app/src/components/vault/ActivityFeed.tsx)
bootstraps from `getSignaturesForAddress` + `getTransaction` for the
most recent ~25 program txs, then subscribes via
`connection.onLogs(programId, …)` for live updates. Decodes Anchor
events through `program.coder.events.decode(...)` and filters to the
active vault PDA. Allowed-action / value-source events will surface
automatically once those program features land.

Follow-up polish:
- A paid RPC raises the bootstrap signature window (the public RPC's
  `getSignaturesForAddress` page is small).
- Cross-vault activity feed on `/` for users with positions across
  many vaults — easy once an indexer (§5.4) exists.

### 3.4 Allowed-action whitelist editor

Blocked on the program adding `AllowedAction` PDAs +
`add_allowed_action` / `remove_allowed_action` instructions —
[MISMATCHES.md §2.1](MISMATCHES.md). UI shape (mirrors the EVM
playbook):

1. **Preset dropdown** — `ACTION_PRESETS` filtered by cluster +
   asset. Curated entries: Marginfi `lending_account_deposit` /
   `lending_account_withdraw`, Lulo deposit/withdraw, Drift deposit
   / withdraw, Jupiter swap. Each option shows a `✓` and "(already
   defined)" suffix when the strategy already has that
   `(target_program, discriminator)` whitelisted.
2. **Manual inputs** — `target_program`, instruction name + IDL
   reference (so the 8-byte discriminator can be derived), optional
   `recipient_account_index` + `expected_recipient`.
3. Submit → `addAllowedAction(...)`. The current whitelist is
   listed below the form, fed by
   `program.account.allowedAction.all(filters)`.

### 3.5 Auto deposit / withdraw config editor

Blocked on `set_deposit_config` / `set_withdraw_config` —
[MISMATCHES.md §2.1](MISMATCHES.md). Structurally identical to §3.4
but writes into `strategy.deposit_config` / `withdraw_config` (spec
[§6](SOLANA_VAULT_SPEC.md)).

### 3.6 Value-source registration

Blocked on `add_value_source` / `remove_value_source` —
[MISMATCHES.md §2.1](MISMATCHES.md). Preset dropdown (per cluster +
asset) covers the three kinds in spec
[§6](SOLANA_VAULT_SPEC.md): `SplAtaBalance`, `MangoLoopValue`,
`AccountU64`. The `MangoLoopValue` preset captures the per-helper
oracle pubkey + collateral / debt mints.

### 3.7 Authority signed-delta rebalance

Replace the current `rebalanceAll` with a per-strategy push / pull
radio that maps to a signed delta (`push → +amount`, `pull →
-amount`). Blocked on the program version of `rebalance(strategy_id,
delta: i64)` per spec
[§7.6](SOLANA_VAULT_SPEC.md) — see [MISMATCHES.md §2.2](MISMATCHES.md).

Until then, expose it as separate "Allocate" and "Deallocate"
buttons (which the per-strategy card already does).

### 3.8 Sum-cap UX for active strategy weights

✅ **Shipped.** [StrategyList.tsx](app/src/components/admin/StrategyList.tsx)
now renders a running progress bar above the cards. Warns (doesn't
block) when over-allocated. When under, surfaces the residual reserve
buffer percentage. Makes the "weights are absolute, not normalized"
semantics legible without a program change.

### 3.10 Pause UI

✅ **Shipped** alongside the program-side `set_paused` instruction.
[PausedBanner](app/src/components/vault/PausedBanner.tsx) renders on
`/` and `/admin` whenever `vault_state.paused` is true.
[PauseToggle](app/src/components/admin/PauseToggle.tsx) is the
admin-only flip; uses `useRoles` for disable-not-hide.

### 3.9 Connected-wallet e2e (Playwright)

The biggest test gap. Wallet adapter's modal doesn't run headlessly.
The unblock is a mocked connector seeded with a `Keypair.generate()`
on a private validator (or `solana-test-validator --bpf-program …`),
registered conditionally when `process.env.NEXT_PUBLIC_E2E === "1"`.
With that in place we can script:

1. Open landing → `Add vault` → paste devnet deployment → confirm row.
2. Deposit happy path → check pie + share price.
3. Withdraw → check share burn.
4. Admin: create strategy + set weight → check card rerender.
5. Authority: `allocate` → `rebalanceAll` → check pie shrink.

### 3.10 Server-side RPC proxy

Optional. Only matters if private RPC keys (Helius / Triton) need to
stay server-only. A Next.js route handler at `app/src/app/api/rpc/[cluster]/route.ts`
that forwards `POST` JSON-RPC bodies with the upstream URL chosen
from server-only env vars (`HELIUS_RPC_URL` / `TRITON_RPC_URL` /
`MAINNET_RPC_URL`).

---

## 4. Larger initiatives (gated on program work)

Each of these requires a program change to land first; the UI work is
listed alongside so it's ready when the program is.

| Program feature ([MISMATCHES.md §2](MISMATCHES.md))                                    | Frontend work                                                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `execute_action` + `AllowedAction` PDAs (spec §7.5, §7.7)                              | Allowed-action editor (§3.4), public popover on each strategy card showing the curated whitelist            |
| `AutoActionConfig` (deposit / withdraw config)                                         | Config editor (§3.5)                                                                                        |
| `ValueSource` PDA + resolver                                                           | Value-source editor (§3.6); off-chain `total_assets` helper that reads value sources alongside vault state  |
| `rebalance(strategy_id, delta: i64)`                                                   | Push / pull radio (§3.7)                                                                                    |
| Pause flag                                                                             | Vault-level pause/resume button gated on a `PAUSER_ROLE` (or admin); banner across the dashboard when paused; deposit/admin write buttons disabled by `usePaused` |
| Emergency withdrawal                                                                   | Admin-only force-unwind dialog inside per-strategy admin route; warns clearly that delegate flow is bypassed |
| Per-strategy + vault-wide circuit breakers                                             | Breaker badge on `VaultList` + `VaultStats`; reset button gated on admin; tooltip explaining what tripped    |
| Fees (deposit / performance / vault creation)                                          | Show fee bps on the deposit form; fee accrual in activity feed; fee-manager-role-gated editor                |
| Per-action loss / cooldown limits                                                      | New columns in the allowed-action whitelist (`loss cap`, `cooldown`); preset library updates                |
| Token allowlist per strategy                                                           | Editor card under strategy admin route; current allowlist read-back from events                              |
| `VaultFactory` + on-chain registry                                                     | Replace `useVaults` env+localStorage merge with an on-chain enumerator                                      |
| `#[event]` emissions across the program                                                | Activity feed (§3.3); historical analytics                                                                  |

The disable-not-hide pattern (§3.2) means most of these can be
**rendered disabled today** with an "available after the program
upgrade" tooltip — shipping the surface early is cheap and
self-documenting.

---

## 5. Cross-cutting work

### 5.1 Brand pass

Current build is a generic dark theme with custom CSS variables. When
a real brand exists:

- Replace the navbar text with a logo.
- Re-tune the accent palette in
  [app/src/app/globals.css](app/src/app/globals.css).
- Replace the wallet adapter modal CSS overrides if the brand
  conflicts.

### 5.2 Accessibility audit

Pre-1.0 wants a formal pass:

- axe-core in CI on `/` and `/admin`.
- Keyboard-only e2e for deposit + admin flows.
- Screen-reader pass on the popover (Radix isn't used; we'd need to
  audit the bespoke popover used in `VaultSelector`).

### 5.3 Mobile polish

- The two-column dashboard collapses below `lg`. Verify on iPhone SE
  + Pixel 8a viewports.
- `StrategyList` overflows on narrow screens — consider a card-list
  collapse instead of horizontal scroll.
- Admin forms are dense; consider an accordion below `md`.

### 5.4 Indexer-backed analytics

Today everything is read live from RPC. For "running APY", drawdown
charts, and historical cumulative yield we need a thin indexer
(Helius webhooks + Postgres, Goldsky, or in-house). Outline:

1. Index `VaultInitialized`, `Deposited`, `Withdrawn`,
   `Rebalanced`, `ActionExecuted`, `FundsPushed`, `FundsPulled`
   events (once they exist — [MISMATCHES.md §2.5](MISMATCHES.md)).
2. Expose a `/api/analytics/{vault}` endpoint wrapping the indexer.
3. New client hooks: `useVaultApy`, `useVaultDrawdown`,
   `useStrategyHistory`. Drop into `DashboardPage` as a fourth panel
   below the pie.

Out of scope until at least one vault has real production
deployment.

### 5.5 Multi-cluster

Today only `devnet` and `mainnet-beta` are wired. Adding a `localnet`
cluster (for `solana-test-validator`) would unblock a fully-local
demo loop without touching devnet RPC quotas. Similarly, an
`anchor.workspace`-driven local connection helper would simplify
end-to-end dev.

---

## 6. Open design questions

Unresolved at the product / UX level. None block shipping the current
build; each shapes a future slice.

- **Should weights be normalized or absolute in the UI?** Today
  they're absolute (matching the program). Some users will read
  `60% + 40%` as "100% allocated" and miss the residual reserve
  behaviour. Options: (a) keep absolute and educate via the
  running-sum bar (§3.8); (b) show both ("active 90% / reserve buffer
  10%"); (c) flip to normalized in the UI and translate at write
  time. Lean (b).
- **Should the add-vault dialog ever delete trusted vaults?**
  Today the dialog doesn't exist (§3.1). Once it does, deleting
  base-registry vaults should be impossible; only `localStorage`
  customs are removable.
- **Where should per-strategy histories live?** A separate
  `/vault/[id]/strategy/[id]` route vs. an expandable panel in
  `StrategyCard`. Lean toward the dedicated route once analytics
  arrive (§5.4).
- **Should the activity feed cross vaults?** Today it doesn't exist
  (§3.3). A cross-vault feed on `/` makes sense for users with many
  positions but is cheap to delay until indexer-backed analytics.
- **Confirmation modals for irreversible actions?** Strategy
  deactivation, delegate rotation, and authority deallocate are all
  consequential. Today they fire immediately on Save. A "type the
  strategy id to confirm" pattern would slow accidents without
  slowing intentional admins.
- **Address-lookup-table surfacing?** Once auto-rebalance lands
  (spec §10), high-fan-out vaults will need ALTs. The UI may need
  to expose ALT hints for client tx builders.

---

## 7. Definition of done — pre-1.0 frontend

Track these in a project board; the program-side equivalent lives in
[MISMATCHES.md](MISMATCHES.md) and
[SOLANA_VAULT_SPEC.md §16](SOLANA_VAULT_SPEC.md).

- [ ] `bun run lint` clean on every commit (CI).
- [ ] Connected-wallet Playwright e2e covering deposit / admin /
      authority paths (private validator + mocked connector).
- [ ] axe-core run on `/` and `/admin` clean.
- [ ] All write paths show explicit success toast + error alert
      with truncated `error.message` (audit pass).
- [ ] Activity feed decodes named args for every event in the
      program IDL (post §3.3).
- [ ] Multi-cluster config: `mainnet-beta`, `devnet`, `localnet`
      all selectable, including from the (future) add-vault dialog.
- [ ] Brand applied (logo, colours).
- [ ] Mobile audit (forms stack, table collapses) on iPhone SE +
      Pixel 8a viewport sizes.
- [ ] Each contract-pre-req feature in §4 wired in disabled state
      with an "after program upgrade" tooltip.

---

## 8. Reference material

- [FRONTEND.md](FRONTEND.md) — current implementation snapshot.
- [MISMATCHES.md](MISMATCHES.md) — every program-side gap the
  frontend is waiting on.
- [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) — load-bearing
  architecture decisions (section 14 covers the dashboard).
- [OVERVIEW.md](OVERVIEW.md) — high-level explainer, including the
  intended `execute_action` flow.
- [CLAUDE.md](../CLAUDE.md) — contributor guide.
- [DEPLOYMENT.md](DEPLOYMENT.md) — addresses to seed
  `VAULT_REGISTRY` against.
- [AI_PLAN.md](AI_PLAN.md) — AI agent design (the off-chain
  half of the system the dashboard surfaces).
