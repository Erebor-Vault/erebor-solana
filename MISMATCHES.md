# Mismatches between `new-docs/` and the actual repo

> **What this document is.** A line-by-line audit of every place the
> documentation in [new-docs/](.) drifted from the real Erebor codebase
> at the time it was written. It exists so anyone reading the spec set
> can see, at a glance, where to trust the spec and where to trust the
> code. The companion implementation plan lives at
> `~/.claude/plans/based-on-following-documents-jiggly-mochi.md`.
>
> **TL;DR.** Four of the five files in `new-docs/` were originally
> drafted against an EVM/Solidity/Foundry codebase that does not exist
> in this repo. They have since been rewritten as Solana documents.
> The one on-theme file ([SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md))
> describes a much more ambitious program than what
> [programs/my_project/src/lib.rs](programs/my_project/src/lib.rs)
> implements today; this document is the gap list.
>
> **Repo reality (as of this audit).** Solana / Anchor 0.32.1, Rust
> 1.89.0, single program `my_project` with id
> `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B`, Next.js + wallet
> adapter frontend at [app/](app/), scaffold-only AI agent at
> [agent/](agent/), Bun as package manager.

---

## 1. Wholesale theme mismatch (4 of 5 docs)

The original drafts of these four files described an EVM port. They
have been rewritten as Solana documents; this row exists for the audit
trail.

| File                            | Theme of original draft                                                                                                  | Actual repo                                                                                                | Status                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)          | Solidity 0.8.27, Foundry, `forge build`, `frontend/` next.js with wagmi/viem/RainbowKit, pnpm, `src/Vault.sol`, `lib/`. | Anchor 0.32.1 program at [programs/my_project/](programs/my_project/), [app/](app/), bun, no Solidity. | Rewritten in this round.                                                                                            |
| [OVERVIEW.md](OVERVIEW.md)      | ERC-4626 vault + EIP-1167 minimal-proxy strategy clones, OpenZeppelin AccessControl, Mock Aave V3 + YieldDripper.        | SPL token vault PDA + per-strategy PDA, admin/authority `Pubkey` fields, `simulate-yield.ts` keeper.       | Rewritten in this round. Cross-network references remain in the §2 mapping table only.                              |
| [FRONTEND.md](FRONTEND.md)      | wagmi v2 + viem + RainbowKit Next.js 14, server-side `/api/rpc/[chain]/route.ts` proxy, hooks like `useStrategyAllowedActionsLogs`, `useAllowance`, `useRoles`; components like `AdminPanel.tsx`, `WeightSlider.tsx`, `StrategyTable.tsx`. | `@solana/wallet-adapter-react` + `@coral-xyz/anchor`, no proxy, hooks `useDeposit`/`useWithdraw`/`useStrategies`/`useAdminActions`/`useAuthorityActions`, components `AdminGuard`/`StrategyCard`/`AllocationChart`. | Rewritten in this round. None of the files referenced in the original draft existed in [app/src/](app/src/).       |
| [FRONTEND_PLAN.md](FRONTEND_PLAN.md) | Roadmap for the EVM dashboard (Playwright e2e on RainbowKit, log replay for `AllowedActionAdded` events, Base mainnet wiring). | Solana app — log replay irrelevant; the equivalent is multi-cluster, not multi-chain.                      | Rewritten in this round.                                                                                            |

---

## 2. [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) vs. [programs/my_project/src/lib.rs](programs/my_project/src/lib.rs)

The spec is on-theme but reads like documentation of a fully built
program. In reality, [lib.rs](programs/my_project/src/lib.rs) covers
roughly **§17 step 1 ("skeleton + share math") + a slice of §17 step 2
("strategy lifecycle")** and nothing past that. The whole agent layer
— allowed actions, value sources, `execute_action`, anti-theft,
introspection — is unbuilt.

Status legend: ✅ shipped · 🟡 partial / divergent · ❌ missing · ➕ extra (not in spec)

### 2.1 Accounts (spec §5–§6)

Closed in Phase-3 (per-strategy authority refactor — see
[REFACTOR_PLAN.md](REFACTOR_PLAN.md)):

| Field / account                                  | Status | Notes                                                                                                                                        |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VaultState` core fields                         | ✅      | Now: `admin`, `authority`, `token_mint`, `share_mint`, `vault_id`, `total_deposited`, `strategy_count`, `bump`, `share_mint_bump`, `vault_authority_bump`, `paused`, `performance_fee_bps`, `total_active_weight_bps`, `pending_admin`, `pending_authority`. |
| Separate `vault_authority` signer PDA            | ✅      | Seeds `["vault_authority", vault_state]`. Owns reserve ATA + share mint. Bump cached in `vault_state.vault_authority_bump`.                  |
| Separate `strategy_authority` signer PDA         | ✅      | Seeds `["strategy_authority", vault_state, strategy_id (u64 LE)]`. Owns strategy *i*'s ATA. Bump cached in `strategy.authority_bump`.        |
| `AllowedAction` PDA                              | ✅      | Built. `expected_recipient_index` is a required `u16` (audit #8); cross-checked `vault` field on `execute_action` (audit #24).               |
| `Strategy` (spec) ≡ `StrategyAllocation` (code)  | 🟡     | Renamed. Has `authority_bump` now; still missing `value_source_count`, `action_count`, `deposit_config`, `withdraw_config`, `_reserved`.     |

Still open:

| Field / account                                  | Status | Notes                                                                                                                                        |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ValueSource` PDA / inline list                  | ❌      | Required by spec §6/§8.                                                                                                                      |
| `AutoActionConfig` (`deposit_config` / `withdraw_config` on Strategy) | ❌ | Required by spec §6/§7.5.                                                                                                                    |
| `_reserved` slack bytes for forward-compat       | ❌      | No realloc cushion. Adding fields will require a migration.                                                                                  |

### 2.2 Instructions (spec §7)

| Instruction                                              | Status | Notes                                                                                                                                                                    |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initialize_vault`                                       | ✅      | Caller becomes admin **and** authority; spec lets them differ at init. Rejects Token-2022 mints with `TransferHook` / `PermanentDelegate` extensions (audit #15).         |
| `propose_admin` / `accept_admin` / `propose_authority` / `accept_authority` | ✅ | Two-step (audit #21). One-step `transfer_admin` / `set_authority` were removed.                                                                |
| `deposit`, `withdraw`                                    | 🟡     | No auto-rebalance. Reserve-only — `withdraw` reverts (`InsufficientReserve`) when the reserve can't cover; spec §7.3 / §10 wants per-strategy `pull_funds` in id order.  |
| `create_strategy`                                        | ✅      | Approves delegate with `u64::MAX` so the agent can later spend. Strategy starts `is_active = true`, `weight_bps = 0`.                                                    |
| `set_strategy_weight`                                    | ✅      | Caps at 10 000 bps per strategy **and** enforces sum ≤ 10 000 across active strategies via `vault_state.total_active_weight_bps` (audit #18).                            |
| `deactivate_strategy`                                    | ✅      | Requires `allocated_amount == 0 && strategy_token_account.amount == 0` upfront (revert: `StrategyStillHoldsFunds`). Caller must drain via `deallocate_from_strategy` first. Permanence ✅. (Spec §7.5 calls for `total_value == 0`; without value-source tracking this is the closest enforceable invariant.) |
| `set_paused` (admin-only)                                | ✅      | New in this round. Toggles `vault_state.paused`. Emits `PausedToggled`.                                                                                                  |
| `set_delegate` (spec) → `update_strategy_delegate` (code)| 🟡     | Renamed. Functionality matches.                                                                                                                                          |
| `add_allowed_action` / `remove_allowed_action`           | ✅      | Built. `expected_recipient_index` is required `u16` (audit #8).                                                                                                          |
| `add_value_source` / `remove_value_source`               | ❌      | Required for spec §7.5 + §8.                                                                                                                                             |
| `set_deposit_config` / `set_withdraw_config`             | ❌      | Required for spec §7.5 + §10.                                                                                                                                            |
| `push_funds` / `pull_funds` (internal helpers)           | 🟡     | Exposed as **public** instructions `allocate_to_strategy` / `deallocate_from_strategy`. Spec wants them internal, called from `deposit` / `withdraw` / `rebalance`.        |
| `rebalance(strategy_id, delta: i64)`                     | 🟡     | Current `rebalance_strategy` is **authority-only** (audit #5) but still weight-driven (computes `target = total_deposited × weight / 10_000`). Spec §7.6 wants explicit signed `delta`; deferred.                                                          |
| `execute_action` ⭐ (spec §7.7)                          | 🟡     | Built; sibling-instruction introspection deferred. See §2.3.                                                                                                              |
| `compute_total_assets` (optional view, spec §8)          | ❌      |                                                                                                                                                                          |
| `report_yield`                                           | ➕     | Not in spec. Reads the strategy's actual SPL balance, computes `actual - allocated_amount`, increments `total_deposited`. Useful but inconsistent with spec's "NAV via value sources, no `reportYield` path" model. |
| `report_loss`                                            | ➕     | Not in spec, paired with `report_yield` (audit #6). Authority-only; subtracts from `strategy.allocated_amount` and `vault_state.total_deposited`.                          |

### 2.3 `execute_action` validation chain (spec §7.7)

🟡 Built **except** for sibling-instruction introspection (audit #7,
deferred). The chain that *is* implemented:

1. Caller is `strategy.delegate` OR `vault_state.authority`.
2. `target_program` AccountInfo matches the requested key.
3. `AllowedAction` PDA exists for `(strategy, target_program,
   discriminator)`; its cached `vault` field is cross-checked
   (audit #24).
4. Required `expected_recipient_index` (audit #8) — the relayed
   instruction's `accounts[index]` must equal `strategy.token_account`.
5. Pre-snapshot **both** caller's ATA balance and `strategy.delegate`'s
   ATA balance (audit #30 revised).
6. `invoke_signed` with **`strategy_authority[i]`** seeds.
7. Post-reload both ATAs; revert with `AntiTheft` if either grew.

What's still missing: the spec also wants the program to walk the
`instructions` sysvar and reject the transaction if any *sibling*
instruction (i.e. another instruction in the same tx) is a Token
program transfer signed by the delegate against their own ATA, or
otherwise touches strategy ATAs from outside `agent_vault`. Without
that walk, an attacker who controls the agent key can stage a
sibling Token::transfer in the same tx (the agent already has
delegate auth on the strategy ATA) and the balance-snapshot
anti-theft won't see it. Defer to a follow-up; the per-strategy
authority refactor blunts the worst-case blast radius (a compromised
agent on strategy *i* can only drain strategy *i*).

### 2.4 Share math (spec §9)

✅ Closed. `VIRTUAL_SHARES = 1_000_000` baked into both deposit and
withdraw share math (u128 widening + downcast guard). First
depositor receives `amount × 10^6` shares, not 1:1 — the donate-to-vault
inflation grief is no longer profitable.

### 2.5 Events (spec §11)

🟡 14 of the 17 spec events emit today. Implemented in this round:
`VaultInitialized`, `Deposited`, `Withdrawn`, `StrategyCreated`,
`StrategyAllocated`, `StrategyDeallocated`, `StrategyWeightSet`,
`DelegateUpdated`, `StrategyDeactivated`, `YieldReported`,
`Rebalanced`, `AdminTransferred`, `AuthoritySet`, `PausedToggled`.

Still missing (blocked on the upstream features being built):
`AllowedActionAdded`, `AllowedActionRemoved`, `ActionExecuted`,
`ValueSourceAdded`, `ValueSourceRemoved`, `DepositConfigSet`,
`WithdrawConfigSet`. The spec's `FundsPushed` / `FundsPulled`
correspond to the existing `StrategyAllocated` /
`StrategyDeallocated` events (different name, same semantics).

### 2.6 Errors (spec §11)

🟡 11 of ~25 spec error variants exist (`InsufficientBalance`,
`InsufficientReserve`, `StrategyInactive`, `UnauthorizedAdmin`,
`UnauthorizedAuthority`, `InvalidMint`, `ZeroAmount`,
`WeightExceedsMax`, `InsufficientReserveForRebalance`, `VaultPaused`,
`StrategyStillHoldsFunds`). Missing —
mostly because the underlying features are missing — `AntiTheft`,
`ActionNotAllowed`, `RecipientMustBeStrategy`,
`DelegateSignedSplTransferInTx`, `MathOverflow`,
`TargetIsAsset` / `TargetIsSelf` /
`TargetIsVault` / `TargetIsSystemProgram` / `TargetIsTokenProgram`,
`CallFailed`, `ValueSourceFailed`, `NotInitialized`,
`AlreadyInitialized`, `DataTooShort`, `NotDelegateNorAuthority`,
`StrategyDoesNotExist`, `StrategyAlreadyDeactivated`, `WeightTooHigh`
(spelled `WeightExceedsMax`), `InsufficientIdle`,
`InsufficientLiquidity`, `NotVault`, `RecipientMustBeStrategy`.

### 2.7 Token-2022 (spec §13)

✅ Closed. `initialize_vault` rejects mints that carry the
`TransferHook` or `PermanentDelegate` extension (`MintHasTransferHook`
/ `MintHasPermanentDelegate`). Classic SPL Token mints have no
extensions and are accepted unchanged.

### 2.8 Auto-rebalance (spec §10)

❌ Deposits land in the reserve and stay there. Withdrawals can only
be filled from the reserve. The "weighted fan-out on deposit, pull in
id order on withdraw" model lives only in the spec; the existing
`rebalance_strategy` instruction is a separate, post-hoc, permissionless
keeper call that anyone can trigger.

---

## 3. [SOLANA_VAULT_SPEC.md §14](SOLANA_VAULT_SPEC.md) vs. [app/](app/)

Spec §14 maps the EVM frontend onto Solana substitutes. Comparing
against [app/src/](app/src/):

| Surface                                         | Status | Notes                                                                                                                                                                                |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wallet adapter + `@solana/web3.js` + Anchor IDL | ✅      | Next.js 16.2.1, `@solana/wallet-adapter-react` 0.15, `@coral-xyz/anchor` 0.32.1.                                                                                                     |
| Vault registry (multi-vault)                    | 🟡     | Build-time only — `VAULT_REGISTRY` array in [app/src/lib/constants.ts](app/src/lib/constants.ts) (5 USDC vaults indexed by `vaultId: 0..4`). No runtime "Add custom vault" dialog.   |
| Per-vault role badges + disable-not-hide gating | ❌      | Single all-or-nothing `AdminGuard` wrapper at [app/src/components/admin/AdminGuard.tsx](app/src/components/admin/AdminGuard.tsx). The whole admin page is gated; controls aren't selectively disabled. |
| Deposit / withdraw forms                        | ✅      | [DepositForm.tsx](app/src/components/vault/DepositForm.tsx), [WithdrawForm.tsx](app/src/components/vault/WithdrawForm.tsx).                                                    |
| Allocation pie                                  | ✅      | [AllocationChart.tsx](app/src/components/admin/AllocationChart.tsx) — recharts donut.                                                                                              |
| Activity feed                                   | ✅      | [ActivityFeed.tsx](app/src/components/vault/ActivityFeed.tsx) — bootstrap from `getSignaturesForAddress` + `getTransaction`, then live `connection.onLogs` subscription. Decodes events via Anchor's `BorshEventCoder`. Filtered to the active vault. |
| RPC proxy                                       | ❌      | Web3.js calls hit the Solana RPC directly.                                                                                                                                           |
| Strategy create / weight / delegate / deactivate UI | ✅  | [CreateStrategyForm.tsx](app/src/components/admin/CreateStrategyForm.tsx), [StrategyCard.tsx](app/src/components/admin/StrategyCard.tsx), [StrategyList.tsx](app/src/components/admin/StrategyList.tsx). Weight slider lives inside `StrategyCard`. |
| Allowed-action whitelist editor                 | ❌      | Blocked on §2.1.                                                                                                                                                                     |
| Deposit/withdraw config editor                  | ❌      | Blocked on §2.1.                                                                                                                                                                     |
| Value-source registration UI                    | ❌      | Blocked on §2.1.                                                                                                                                                                     |
| Authority manual rebalance                      | 🟡     | A `rebalanceAll` button exists in [app/src/app/admin/page.tsx](app/src/app/admin/page.tsx) (wired through [useAuthorityActions.ts](app/src/hooks/useAuthorityActions.ts)). No signed-delta push/pull radio per spec §14. |
| Pause toggle + paused banner                    | ✅      | [PauseToggle.tsx](app/src/components/admin/PauseToggle.tsx) (admin-only, disable-not-hide via `useRoles`); [PausedBanner.tsx](app/src/components/vault/PausedBanner.tsx) on `/` and `/admin`. |
| Sum-cap UX warning                              | ✅      | Running weight-sum bar in [app/src/components/admin/StrategyList.tsx](app/src/components/admin/StrategyList.tsx). Warns when over-allocated; shows reserve buffer % when under. |
| `useRoles` hook (per-control role flags)        | ✅      | [useRoles.ts](app/src/hooks/useRoles.ts) — used by `PauseToggle` for disable-not-hide. `AdminGuard` still wraps `/admin` for now; per-control disabling can roll out incrementally without rewriting the gate. |

The [app/src/components/](app/src/components/) inventory:

- `admin/AdminGuard.tsx` — role gate wrapper.
- `admin/AllocationChart.tsx` — recharts donut.
- `admin/CreateStrategyForm.tsx` — create-strategy + delegate input.
- `admin/StrategyCard.tsx` — per-strategy detail (weight, deactivate, update delegate).
- `admin/StrategyList.tsx` — strategy index.
- `layout/Navbar.tsx`, `layout/VaultSelector.tsx` — header + vault dropdown.
- `providers/SolanaProvider.tsx`, `providers/VaultProvider.tsx` — wallet + vault context.
- `shared/AmountInput.tsx`, `shared/TxToast.tsx`.
- `vault/DepositForm.tsx`, `vault/WithdrawForm.tsx`, `vault/UserPosition.tsx`, `vault/VaultList.tsx`, `vault/VaultStats.tsx`.

The [app/src/hooks/](app/src/hooks/) inventory:

- `useVaultProgram` — Anchor `Program` instance.
- `useDeposit`, `useWithdraw` — user flows.
- `useAdminActions` — `createStrategy`, `deactivateStrategy`, `updateDelegate`, `setStrategyWeight`.
- `useAuthorityActions` — `allocate`, `deallocate`, `reportYield`, `rebalanceStrategy`, `rebalanceAll`.
- `useStrategies`, `useUserPosition`.

---

## 4. Off-chain agent

🟡 [agent/src/](agent/src/) now ships a runnable harness — entry point
[agent/src/index.ts](agent/src/index.ts) boots a polling loop that
reads strategy state via PDA derivation
([agent/src/vault-client.ts](agent/src/vault-client.ts)), asks an
advisor what to do
([agent/src/llm-advisor.ts](agent/src/llm-advisor.ts) — rule-based
baseline, Claude-backed when `ANTHROPIC_API_KEY` is set, with a
cooldown wrapper to bound LLM spend), and dispatches to mocked
lend/withdraw stubs ([agent/src/strategy.ts](agent/src/strategy.ts)).
`bun run start` works end-to-end against devnet for a vault the agent
is the delegate of.

The lend / withdraw paths stay **mocked** until the spec's
`execute_action` whitelist gateway (§2.3) is in place — without it
the agent has no on-chain proof that an inner protocol call is
sandboxed, which is the whole reason for the gateway. AI_PLAN.md
describes the eventual two-step Lulo flow that will replace the mock.

---

## 5. Internal doc consistency (root-level)

The repo's root-level docs are Solana-themed and broadly accurate:

- [README.md](README.md) — lists 10 instructions that match
  [lib.rs](programs/my_project/src/lib.rs) exactly, plus a
  documentation index. ✅
- [OVERVIEW.md](OVERVIEW.md) — high-level explainer (this file's §1
  documents how it was rewritten in this round). ✅
- [PLAN.md](PLAN.md) — implementation plan; "Phase 5 cleanup" has
  open items, none blocking.
- [DEPLOYMENT.md](DEPLOYMENT.md) — program id
  `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B` matches
  [Anchor.toml](Anchor.toml). ✅
- [AI_PLAN.md](AI_PLAN.md) — design for the unbuilt agent.
- [CLAUDE.md](CLAUDE.md) — the rewritten long-form contributor guide
  (this file's §1 documents what it replaced).

The canonical documentation is now the root-level set listed in
[README.md](README.md)'s "Documentation index". The original
`new-docs/` folder was a transitional scratchpad and has been removed
in this round.

---

## 6. What this means for downstream work

Phase 1 of the implementation plan (rewrite the four EVM-themed docs +
this audit + add a status banner to
[SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md)) is what produced this
document. Phases 2–4 — making the program actually deliver the spec's
guarantees, building the corresponding UI, fleshing out the agent —
are tracked in the plan file, not here. Treat the ❌/🟡 rows above as
a punch list.
