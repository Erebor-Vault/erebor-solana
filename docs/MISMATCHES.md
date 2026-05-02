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
> **Repo reality (as of this audit).** Solana / Anchor 0.32.1, three
> programs (`my_project` id `FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo`,
> `mock_kamino`, `mock_lulo`), Next.js + wallet adapter frontend at
> [app/](../app/), two runnable AI agents at
> [agent/lulo/](../agent/lulo/) and
> [agent/kamino_looper/](../agent/kamino_looper/), Bun as package
> manager.

---

## 1. Wholesale theme mismatch (4 of 5 docs)

The original drafts of these four files described an EVM port. They
have been rewritten as Solana documents; this row exists for the audit
trail.

| File                            | Theme of original draft                                                                                                  | Actual repo                                                                                                | Status                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [CLAUDE.md](../CLAUDE.md)          | Solidity 0.8.27, Foundry, `forge build`, `frontend/` next.js with wagmi/viem/RainbowKit, pnpm, `src/Vault.sol`, `lib/`. | Anchor 0.32.1 program at [programs/my_project/](programs/my_project/), [app/](app/), bun, no Solidity. | Rewritten in this round.                                                                                            |
| [OVERVIEW.md](OVERVIEW.md)      | ERC-4626 vault + EIP-1167 minimal-proxy strategy clones, OpenZeppelin AccessControl, Mock Aave V3 + YieldDripper.        | SPL token vault PDA + per-strategy PDA, admin/authority `Pubkey` fields, `simulate-yield.ts` keeper.       | Rewritten in this round. Cross-network references remain in the §2 mapping table only.                              |
| [FRONTEND.md](FRONTEND.md)      | wagmi v2 + viem + RainbowKit Next.js 14, server-side `/api/rpc/[chain]/route.ts` proxy, hooks like `useStrategyAllowedActionsLogs`, `useAllowance`, `useRoles`; components like `AdminPanel.tsx`, `WeightSlider.tsx`, `StrategyTable.tsx`. | `@solana/wallet-adapter-react` + `@coral-xyz/anchor`, no proxy, hooks `useDeposit`/`useWithdraw`/`useStrategies`/`useAdminActions`/`useAuthorityActions`, components `AdminGuard`/`StrategyCard`/`AllocationChart`. | Rewritten in this round. None of the files referenced in the original draft existed in [app/src/](app/src/).       |
| [FRONTEND_PLAN.md](FRONTEND_PLAN.md) | Roadmap for the EVM dashboard (Playwright e2e on RainbowKit, log replay for `AllowedActionAdded` events, Base mainnet wiring). | Solana app — log replay irrelevant; the equivalent is multi-cluster, not multi-chain.                      | Rewritten in this round.                                                                                            |

---

## 2. [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) vs. [programs/my_project/src/](../programs/my_project/src/)

After Phase-3/4/5 the program now covers the full spec surface
end-to-end: per-strategy authority PDAs, share-math, allow-list,
`execute_action` with sibling-instruction introspection, treasury fee
split, value sources + NAV settle, auto-action config, signed-delta
rebalance, fan-out on deposit, auto-pull on withdraw. The remaining
gaps are cosmetic (a few defensive error names Anchor's machinery
already covers) and one optional read-only view (`compute_total_assets`).

Status legend: ✅ shipped · 🟡 partial / divergent · ❌ missing · ➕ extra (not in spec)

### 2.1 Accounts (spec §5–§6)

| Field / account                                  | Status | Notes                                                                                                                                        |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VaultState` core fields                         | ✅      | `admin`, `authority`, `token_mint`, `share_mint`, `vault_id`, `total_deposited`, `strategy_count`, `bump`, `share_mint_bump`, `vault_authority_bump`, `paused`, `performance_fee_bps`, `total_active_weight_bps`, `pending_admin`, `pending_authority`, `_reserved: [u8; 64]`. |
| Separate `vault_authority` signer PDA            | ✅      | Seeds `["vault_authority", vault_state]`. Owns reserve ATA + share mint. Bump cached in `vault_state.vault_authority_bump`.                  |
| Separate `strategy_authority` signer PDA         | ✅      | Seeds `["strategy_authority", vault_state, strategy_id (u64 LE)]`. Owns strategy *i*'s ATA. Bump cached in `strategy.authority_bump`.        |
| `AllowedAction` PDA                              | ✅      | Required `expected_recipient_index: u16` (audit #8); cross-checked `vault` field on `execute_action` (audit #24); `loss_per_call_bps_cap` + `cooldown_secs` + `last_executed_at` (Phase-5).               |
| `Strategy` (spec) ≡ `StrategyAllocation` (code)  | 🟡     | Renamed. `authority_bump` + `_reserved: [u8; 32]` cushion shipped. Spec's `value_source_count` / `action_count` / inline `deposit_config` / `withdraw_config` are factored into separate PDAs (`ValueSource`, `AllowedAction`, `AutoActionConfig`) instead of inline.     |
| `ValueSource` PDA                                | ✅      | One PDA per `(strategy, slot_index)` (Phase-5). Kinds: `SplAtaBalance` (read SPL token amount) and `AccountU64` (read u64 at offset). Includes `scale_num`/`scale_den` for cToken-style exchange rates. |
| `AutoActionConfig` PDA                           | ✅      | One per `(strategy, kind)` where kind ∈ {0=Deposit, 1=Withdraw}. Records the curator's intended `(target, disc, ix_data)` (Phase-5). Read off-chain by the agent. |
| `AllowedToken` PDA                               | ✅      | Phase-4d. Protocol-level mint allow-list at `["allowed_token", mint]`. Used by `execute_action` when an action declares `output_mint_index`. |
| `ProtocolConfig` PDA                             | ✅      | Phase-4a. Singleton at `["protocol_config"]`. Holds `governance`, `treasury`, `protocol_fee_bps`, used for the treasury fee split inside `withdraw`. |
| `_reserved` slack bytes                          | ✅      | `VaultState` (64 B), `StrategyAllocation` (32 B), `AllowedAction` (32 B), `ValueSource` (32 B), `AutoActionConfig` (variable). Future fields land via realloc, no fresh-mint migration. |

### 2.2 Instructions (spec §7)

| Instruction                                              | Status | Notes                                                                                                                                                                    |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initialize_vault`                                       | ✅      | Caller becomes admin **and** authority; spec lets them differ at init. Rejects Token-2022 mints with `TransferHook` / `PermanentDelegate` extensions (audit #15).         |
| `propose_admin` / `accept_admin` / `propose_authority` / `accept_authority` | ✅ | Two-step (audit #21). One-step `transfer_admin` / `set_authority` were removed.                                                                |
| `deposit`                                                | ✅      | Phase-5: optional auto-fan-out. If `remaining_accounts` carries `[strategy_pda, strategy_token_ata]` pairs, deposit pushes `amount × target_weight_bps / 10_000` from reserve into each, signed by `vault_authority`. Empty `remaining_accounts` = back-compat reserve-only path. `FanOutExceedsDeposit` guard blocks duplicate-strategy drains. |
| `withdraw`                                               | ✅      | Phase-4b auto-pull. If reserve is short, walks `[strategy, strategy_authority, strategy_token]` triples in `remaining_accounts`, signs strategy-side legs with `strategy_authority`. Phase-4a fee split: `protocol_fee_bps` → treasury, remainder → admin. |
| `create_strategy`                                        | ✅      | Approves delegate with `u64::MAX`. Strategy starts `is_active = true`, `weight_bps = 0`. Dedupe loop rejects duplicate delegate (`DuplicateDelegate`).                    |
| `set_strategy_weight`                                    | ✅      | Caps at 10 000 bps per strategy **and** enforces sum ≤ 10 000 across active strategies via `vault_state.total_active_weight_bps` (audit #18).                            |
| `deactivate_strategy`                                    | ✅      | Requires `allocated_amount == 0 && strategy_token_account.amount == 0` upfront (revert: `StrategyStillHoldsFunds`). Permanence ✅. |
| `set_paused`                                             | ✅      | Admin-only. Toggles `vault_state.paused`. Emits `PausedToggled`.                                                                                                         |
| `set_delegate` (spec) → `update_strategy_delegate` (code)| 🟡     | Renamed. Functionality matches.                                                                                                                                          |
| `add_allowed_action` / `remove_allowed_action`           | ✅      | Required `expected_recipient_index: u16`; plus Phase-5 `loss_per_call_bps_cap` + `cooldown_secs`.                                                                         |
| `add_value_source` / `remove_value_source`               | ✅      | Phase-5. Per-strategy registry; `settle_strategy_value` reads them and books the signed delta into both `strategy.allocated_amount` and `vault.total_deposited`.         |
| `set_auto_action_config` / `clear_auto_action_config`    | ✅      | Phase-5. Spec called these `set_deposit_config` / `set_withdraw_config`; this implementation uses a single ix dispatched on `kind` (0=Deposit, 1=Withdraw).              |
| `allocate_to_strategy` / `deallocate_from_strategy`      | 🟡     | Public authority-only instructions. Spec wants them as internal helpers; auto-fan-out on `deposit` and auto-pull on `withdraw` cover the spec's user-facing flow, so these are kept as authority-side emergency moves. |
| `rebalance_strategy`                                     | ✅      | Authority-only (audit #5). Weight-driven: `target = total_deposited × weight / 10_000`.                                                                                  |
| `rebalance_with_delta(delta: i64)`                       | ✅      | Phase-5. Spec §7.6's explicit signed-delta entrypoint. Authority-only; reverts on overflow / underflow / insufficient reserve.                                            |
| `execute_action` ⭐ (spec §7.7)                          | ✅      | Full validation chain incl. sibling-instruction introspection. See §2.3.                                                                                                  |
| `settle_strategy_value`                                  | ✅      | Phase-5. Reads the strategy's `ValueSource` registry, sums into a live `computed_value`, books `delta_signed = computed_value − allocated_amount` into both `strategy.allocated_amount` and `vault.total_deposited`. Replaces the spec's `compute_total_assets` write path. |
| `compute_total_assets` (optional view, spec §8)          | ❌      | Read-only NAV aggregator. The write path is `settle_strategy_value`; a no-side-effect view ix has not been added. Low value with `settle_strategy_value` and indexer-side aggregation in place. |
| `report_yield`                                           | ➕     | Not in spec. Reads strategy's actual SPL balance, computes `actual − allocated_amount`, increments `total_deposited`. Coexists with `settle_strategy_value` (Phase-5) which is the more general value-source-driven version. |
| `report_loss`                                            | ➕     | Authority-only counterpart to `report_yield` (audit #6). Subtracts from `strategy.allocated_amount` and `vault_state.total_deposited`.                                    |
| `initialize_protocol_config` / `set_treasury` / `set_protocol_fee_bps` / `set_governance` | ➕ | Phase-4a protocol-level governance — not spec'd, supports the treasury fee split inside `withdraw`. |
| `add_allowed_token` / `remove_allowed_token`             | ➕     | Phase-4d protocol-level mint allow-list, gates `output_mint_index` on swap-style allowed actions.                                                                         |

### 2.3 `execute_action` validation chain (spec §7.7)

✅ Full chain implemented:

1. **Sibling-instruction introspection (audit #7).** Walk the
   `instructions` sysvar; reject the tx if any *other* instruction in
   the same tx has `strategy.token_account` at any meta slot
   (`SiblingInstructionForbidden`). This is more aggressive than the
   spec proposal — it covers both the "delegate-signed Token::transfer
   in a sibling ix" and the "side-channel siphon via a third program"
   cases without having to special-case the SPL Token program ID.
2. Caller is `strategy.delegate` OR `vault_state.authority`
   (`CallerNotDelegateOrAuthority`).
3. `target_program` AccountInfo matches the requested key
   (`TargetProgramMismatch`).
4. `AllowedAction` PDA exists for `(strategy, target_program,
   discriminator)`; cached `vault` field is cross-checked (audit #24).
   Cooldown check (`ActionCooldownActive`) and `loss_per_call_bps_cap`
   bound enforced (Phase-5).
5. Required `expected_recipient_index` (audit #8) — the relayed
   instruction's `accounts[index]` must equal `strategy.token_account`
   (`RecipientMismatch`).
6. Optional `output_mint_index` — if set, the mint at that meta slot
   must be on the `AllowedToken` allow-list (`OutputMintNotAllowed`).
7. Pre-snapshot **both** caller's ATA balance and
   `strategy.delegate`'s ATA balance (audit #30) and the strategy
   ATA's balance for the per-action loss cap.
8. `invoke_signed` with **`strategy_authority[i]`** seeds.
9. Post-reload all three ATAs; revert with `AntiTheft` if caller or
   delegate ATA grew, or `ActionLossExceedsCap` if strategy ATA fell
   by more than `loss_per_call_bps_cap × allocated_amount / 10_000`.
10. Update `last_executed_at` (cooldown bookkeeping). Emit `ActionExecuted`.

### 2.4 Share math (spec §9)

✅ `VIRTUAL_SHARES = 1_000_000` baked into both deposit and withdraw
share math (u128 widening + downcast guard). First depositor receives
`amount × 10^6` shares; donate-to-vault inflation grief is not
profitable.

### 2.5 Events (spec §11)

✅ All spec events emit, plus Phase-4/5 additions:

- Spec coverage: `VaultInitialized`, `Deposited`, `Withdrawn`,
  `StrategyCreated`, `StrategyAllocated`, `StrategyDeallocated`,
  `StrategyWeightSet`, `DelegateUpdated`, `StrategyDeactivated`,
  `YieldReported`, `Rebalanced`, `AdminTransferred`, `AuthoritySet`,
  `PausedToggled`, `AllowedActionAdded`, `AllowedActionRemoved`,
  `ActionExecuted`, `ValueSourceAdded`, `ValueSourceRemoved`,
  `AutoActionConfigSet` (≡ spec's `DepositConfigSet` / `WithdrawConfigSet`,
  unified on `kind`), `AutoActionConfigCleared`.
- Extras: `LossReported`, `AdminProposed`, `AuthorityProposed`,
  `AllowedTokenAdded`, `AllowedTokenRemoved`, `PerformanceFeeCharged`,
  `PerformanceFeeSet`, `ProtocolConfigInitialized`, `TreasurySet`,
  `ProtocolFeeBpsSet`, `GovernanceSet`, `StrategyValueSettled`.

The spec's `FundsPushed` / `FundsPulled` correspond to the existing
`StrategyAllocated` / `StrategyDeallocated` events (different name,
same semantics).

### 2.6 Errors (spec §11)

✅ Spec coverage closed. Canonical map of spec name → shipped name:

| Spec error                          | Shipped as                    |
| ----------------------------------- | ----------------------------- |
| `AntiTheft`                         | `AntiTheft`                   |
| `ActionNotAllowed`                  | `ActionNotAllowed`            |
| `RecipientMustBeStrategy`           | `RecipientMismatch`           |
| `DelegateSignedSplTransferInTx`     | `SiblingInstructionForbidden` (broader — any sibling that touches the strategy ATA) |
| `MathOverflow`                      | `MathOverflow`                |
| `InsufficientLiquidity`             | `InsufficientLiquidity`       |
| `NotDelegateNorAuthority`           | `CallerNotDelegateOrAuthority`|
| `WeightTooHigh`                     | `WeightExceedsMax`            |
| `InsufficientIdle`                  | `InsufficientReserve`         |

Anchor's macro infrastructure handles the rest of the spec list
(`NotInitialized`, `AlreadyInitialized`, `DataTooShort`,
`StrategyDoesNotExist`, `StrategyAlreadyDeactivated`, `NotVault`)
through account constraints and discriminator checks, so dedicated
error variants aren't needed.

Defensive target-classification errors (`TargetIsAsset`, `TargetIsSelf`,
`TargetIsVault`, `TargetIsSystemProgram`, `TargetIsTokenProgram`,
`CallFailed`, `ValueSourceFailed`) were not added — sibling-ix
introspection + the recipient pin + the output-mint allow-list cover
the threat space the spec used those errors for. Add only if a
specific attack path the existing checks miss is identified.

Phase-5 added: `ActionCooldownActive`, `ActionLossExceedsCap`,
`LossCapTooHigh`, `SiblingInstructionForbidden`, `DeltaOutOfRange`,
`InvalidAutoActionKind`, `AutoActionDataTooLarge`,
`InvalidValueSourceKind`, `InvalidValueSourceScale`,
`ValueSourceIndexOutOfBounds`, `ValueSourceTargetMismatch`,
`ValueSourceTargetIsStrategyAta`, `ValueSourceTargetTooSmall`,
`FanOutExceedsDeposit`.

### 2.7 Token-2022 (spec §13)

✅ `initialize_vault` rejects mints that carry the `TransferHook` or
`PermanentDelegate` extension (`MintHasTransferHook` /
`MintHasPermanentDelegate`). Classic SPL Token mints have no
extensions and are accepted unchanged.

### 2.8 Auto-rebalance (spec §10)

✅ Closed.

- **Deposit fan-out**: if the depositor passes `[strategy_pda, strategy_token_ata]`
  pairs in `remaining_accounts`, deposit pushes funds out by weight,
  signed by `vault_authority` ([deposit.rs](../programs/my_project/src/instructions/deposit.rs)).
- **Withdraw auto-pull**: if the reserve can't cover, withdraw walks
  `[strategy, strategy_authority, strategy_token]` triples and pulls
  underlying back to reserve in caller order
  ([withdraw.rs](../programs/my_project/src/instructions/withdraw.rs)).
- **Rebalance**: `rebalance_strategy` (weight-driven) and
  `rebalance_with_delta` (signed-delta) are both authority-only.

The TS-side adapter framework at [app/src/lib/adapters/](../app/src/lib/adapters/)
stacks redeem CPIs ahead of withdraws when an external position needs
to be unwound first.

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
| Allowed-action whitelist editor                 | 🟡     | Program-side ready. Frontend hooks `useAllowedActions.tsx` + `useAdminActions.ts` exist; full editor UI (per-strategy preset list + custom ix-data builder) still TODO. |
| Auto-action config editor                       | ❌      | Program-side ready (`set_auto_action_config` / `clear_auto_action_config`). UI not built.                                                                                            |
| Value-source registration UI                    | ❌      | Program-side ready (`add_value_source` / `remove_value_source` / `settle_strategy_value`). UI not built.                                                                             |
| Authority manual rebalance                      | 🟡     | A `rebalanceAll` button exists in [app/src/app/admin/page.tsx](app/src/app/admin/page.tsx). Program supports both weight-driven `rebalance_strategy` and signed-delta `rebalance_with_delta`; the signed-delta push/pull UI per spec §14 is not built yet. |
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

## 4. Off-chain agents

✅ Two runnable agents ship today, both calling on-chain via
`execute_action`:

- [agent/lulo/](../agent/lulo/) — Lulo lending agent. Polls vault
  state, decides lend/redeem against `mock_lulo`, dispatches via
  `execute_action(LULO_PROGRAM, lend_disc | withdraw_disc, ix_data)`.
  Claude-backed advisor when `ANTHROPIC_API_KEY` is set, rule-based
  baseline otherwise.
- [agent/kamino_looper/](../agent/kamino_looper/) — leveraged-loop
  agent against `mock_kamino`. Manages a deposit/borrow loop with
  `INTERMEDIATE_HF_FLOOR = 1.10` (above mock_kamino's `HF_MIN_BPS =
  10_500`), routes deposits/withdraws/borrows/repays through
  `execute_action` with per-strategy authority signing.
- [agent/shared/](../agent/shared/) — common chain-layer helpers
  (PDA derivations, `execute_action` builders).

Both run end-to-end against devnet. The `execute_action` whitelist
gateway (§2.3) is in place, so neither uses the mock-stub fallback.

---

## 5. Internal doc consistency (root-level)

The repo's root-level docs are Solana-themed and broadly accurate:

- [README.md](../README.md) — documentation index. ✅
- [OVERVIEW.md](OVERVIEW.md) — high-level explainer.
- [PLAN.md](PLAN.md) — historical implementation plan.
- [DEPLOYMENT.md](DEPLOYMENT.md) — live program id
  `FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo` matches
  [Anchor.toml](../Anchor.toml).
- [AI_PLAN.md](AI_PLAN.md) — design for the unbuilt agent.
- [CLAUDE.md](../CLAUDE.md) — the rewritten long-form contributor guide
  (this file's §1 documents what it replaced).

The canonical documentation is now the root-level set listed in
[README.md](../README.md)'s "Documentation index". The original
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
