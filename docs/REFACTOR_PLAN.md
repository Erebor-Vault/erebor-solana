# Refactor Plan — Phase-3 Security Audit Fixes + Per-Strategy Authority

> **Status.** Plan only. Picked up after the audit in this session
> (30-issue list, attached as a comment thread in commit history)
> and the user's decisions on A–F. Resume in a fresh Claude session
> with this file open and execute top-to-bottom.

This plan supersedes the Phase-2 model where `vault_state` is the
universal CPI signer. After this lands, **every CPI signs as either
`vault_authority` (one per vault) or `strategy_authority[i]` (one
per strategy)**. `vault_state` becomes a pure config account that
never signs.

---

## 0. Decisions taken (do not re-litigate)

| Decision | Choice | Issue # |
|---|---|---|
| **A** Inflation-attack mitigation | OpenZeppelin virtual-shares offset (`VIRTUAL_SHARES = 1_000_000`) | #4 |
| **B** Loss handling | Add `report_loss` instruction, authority-only | #6 |
| **C** Cross-strategy isolation | **Option 1: per-strategy authority PDA** (the spec model). Multisig admin/authority is necessary but not sufficient — the agent key is single-sig and that's where the cross-strategy drain originates. | #9, #10 |
| **D** Instruction-sysvar introspection (sibling-ix anti-theft) | Defer. MISMATCHES note. | #7 |
| **E** Weight sum cap | Add `total_active_weight_bps: u16` on `VaultState`, enforce sum ≤ 10 000 in `set_strategy_weight` and on `is_active` transitions in `deactivate_strategy` | #18 |
| **F-first** (caller of `execute_action`) | Keep `delegate || authority` (so authority retains escape-hatch for liveness). Snapshot **both** caller's ATA and `strategy.delegate`'s ATA. Anti-theft fires if either grows. | #30 |
| **F-second** (external withdrawal liveness) | Authority's `execute_action` path is the escape hatch — no program change. Frontend warning: "pair lend with withdraw discriminator when whitelisting". | (UX) |

Plus all unambiguous bucket-1 fixes:
- **#1, #2** u128 share math in deposit + withdraw + downcast guard
- **#3** `checked_add` / `checked_sub` everywhere on accounting fields
- **#5** `rebalance_strategy` → authority-only
- **#8** `expected_recipient_index: u16` (drop `Option`)
- **#11** `init_if_needed` for `admin_token_account` in `withdraw`
- **#12** `require!(underlying > 0)` after share math
- **#14** `strategy_token_account.mint == vault_state.token_mint` constraint on `report_yield`
- **#15** Reject `TransferHook` + `PermanentDelegate` extensions on `initialize_vault`
- **#19** Pause check on `deallocate_from_strategy`
- **#20** Pause check on `report_yield`
- **#21** Two-step admin/authority transfer (`propose_admin` + `accept_admin`, same for authority)
- **#24** `allowed_action.vault == vault_state.key()` constraint on `execute_action`
- **#25** Reorder reserve check first in `withdraw`

Defer with MISMATCHES note (do not touch this round):
- #7 (sibling instruction-sysvar introspection)
- #16 (deactivation external-position check — depends on `ValueSource` registry, separate task)
- #17 (`create_strategy` race UX)
- #26 (`expected_account_count` on `AllowedAction`)
- #28 (non-canonical strategy ATA — informational only)

---

## 1. New constants

```rust
/// Cap on the sum of `target_weight_bps` across all *active* strategies.
pub const MAX_TOTAL_ACTIVE_WEIGHT_BPS: u16 = 10_000;

/// Virtual-shares offset for inflation-attack mitigation (audit #4 / spec §9).
/// OpenZeppelin pattern: shares = `amount × (supply + VIRTUAL) / (assets + 1)`.
pub const VIRTUAL_SHARES: u128 = 1_000_000;
```

(`DEFAULT_PERFORMANCE_FEE_BPS = 500` and `MAX_PERFORMANCE_FEE_BPS = 2000` already exist.)

## 2. New error variants

```rust
LossExceedsDeposited,
NotPendingAdmin,
NotPendingAuthority,
WeightSumExceedsMax,
MintHasTransferHook,
MintHasPermanentDelegate,
DuplicateDelegate,
MathOverflow,
```

## 3. New events

```rust
#[event] pub struct LossReported { vault, strategy, strategy_id, amount, new_total_deposited }
#[event] pub struct AdminProposed { vault, current_admin, pending_admin }
#[event] pub struct AuthorityProposed { vault, current_authority, pending_authority }
```

## 4. New PDAs

| PDA | Seeds | Owns |
|---|---|---|
| `vault_authority` | `["vault_authority", vault_state]` | reserve ATA, share mint authority |
| `strategy_authority[i]` | `["strategy_authority", vault_state, strategy_id (u64 LE)]` | strategy *i*'s ATA |

`vault_state` no longer owns/signs anything. It's a pure config PDA at the same seeds as today.

## 5. VaultState — new fields

```rust
pub vault_authority_bump: u8,            // 1 byte
pub total_active_weight_bps: u16,        // 2 bytes
pub pending_admin: Pubkey,               // 32 bytes (Pubkey::default() if none)
pub pending_authority: Pubkey,           // 32 bytes (Pubkey::default() if none)
```

Total VaultState bytes: ~165 + 67 = 232. **Layout-incompatible with prior PDAs.** Re-init on a fresh test mint (round 5 of devnet redeploys).

## 6. StrategyAllocation — new fields

```rust
pub authority_bump: u8,                  // 1 byte
```

## 7. Per-instruction signer table

| Instruction | Old signer | **New signer** | Notes |
|---|---|---|---|
| `initialize_vault` | n/a | n/a + reject hooks/perm-delegate mints (#15) | inits `vault_authority` PDA |
| `deposit` | `vault_state` (mint) | **`vault_authority`** for `mint_to`. Apply virtual shares (#4) + u128 (#1) |
| `withdraw` | `vault_state` (reserve→user, reserve→admin fee) | **`vault_authority`** for both transfers. u128 (#2), `init_if_needed` admin ATA (#11), reorder reserve check (#25), require_underlying_>0 (#12) |
| `create_strategy` | `vault_state` (approve delegate) | **`strategy_authority[i]`**. Init strategy_authority PDA. Dedupe-check delegate vs other strategies (#10 mitigation) |
| `update_strategy_delegate` | `vault_state` (revoke + approve) | **`strategy_authority[i]`**. Dedupe-check |
| `allocate_to_strategy` | `vault_state` | **`vault_authority`** (transfers from reserve which is owned by vault_authority) |
| `deallocate_from_strategy` | `vault_state` | **`strategy_authority[i]`** (strategy ATA is owned by strategy_authority). Add pause check (#19) |
| `rebalance_strategy` | `vault_state` (both legs) + permissionless | **`vault_authority` for in-leg, `strategy_authority` for out-leg, authority-only signer** (#5) |
| `report_yield` | n/a (read-only) | n/a — add pause check (#20) + mint constraint (#14) |
| **`report_loss` (new)** | n/a | authority-only; decrements `total_deposited` saturating (#6) |
| `set_strategy_weight` | n/a | enforce sum cap (#18); update `total_active_weight_bps` |
| `deactivate_strategy` | `vault_state` (revoke) | **`strategy_authority[i]`**. Decrement `total_active_weight_bps` |
| `set_paused` | n/a | unchanged |
| `set_performance_fee_bps` | n/a | unchanged |
| `add_allowed_action` | n/a | drop `Option<u16>` for `expected_recipient_index` — make required (#8) |
| `remove_allowed_action` | n/a | unchanged |
| `execute_action` | `vault_state` (universal) | **`strategy_authority[i]` only**. Caller = delegate OR authority. Snapshot **both** caller ATA + delegate ATA, revert if either grows (#30 revised). Add `allowed_action.vault == vault_state.key()` constraint (#24) |
| `transfer_admin` | n/a | **REMOVE** — replaced by propose/accept |
| `set_authority` | n/a | **REMOVE** — replaced by propose/accept |
| **`propose_admin` (new)** | n/a | admin-only. Stores `pending_admin`. Emits `AdminProposed` |
| **`accept_admin` (new)** | n/a | callable only by `pending_admin`. Promotes `pending_admin` → `admin`, clears pending. Emits `AdminTransferred` |
| **`propose_authority` (new)** | n/a | admin-only. Stores `pending_authority`. Emits `AuthorityProposed` |
| **`accept_authority` (new)** | n/a | callable only by `pending_authority`. Promotes pending → authority, clears pending. Emits `AuthoritySet` |

## 8. Pervasive changes

- Every `+=` / `-=` / `*` / `/` on `VaultState.total_deposited`, `Strategy.allocated_amount`, `VaultState.strategy_count`, `total_active_weight_bps` → `checked_*` returning a domain error (#3).
- Every `amount × supply / total` style share computation → u128 widening + downcast guard (`MathOverflow` error).

## 9. Frontend changes

| File | Change |
|---|---|
| [app/src/lib/pda.ts](app/src/lib/pda.ts) | Add `deriveVaultAuthorityPda(vault)` + `deriveStrategyAuthorityPda(vault, id)` |
| [app/src/hooks/useDeposit.ts](app/src/hooks/useDeposit.ts) | Add `vaultAuthority` to `accountsStrict` |
| [app/src/hooks/useWithdraw.ts](app/src/hooks/useWithdraw.ts) | Add `vaultAuthority`; admin ATA still required but program now `init_if_needed`s it |
| [app/src/hooks/useAdminActions.ts](app/src/hooks/useAdminActions.ts) | Update `createStrategy`, `deactivateStrategy`, `updateDelegate`, `setStrategyWeight` for new authority PDAs. Replace `transferAdmin` / `setAuthority` with `proposeAdmin` / `acceptAdmin` / `proposeAuthority` / `acceptAuthority`. Add `reportLoss` |
| [app/src/hooks/useAuthorityActions.ts](app/src/hooks/useAuthorityActions.ts) | Update for new authority PDAs on allocate/deallocate/rebalance |
| [app/src/components/admin/strategy/AllowedActionsEditor.tsx](app/src/components/admin/strategy/AllowedActionsEditor.tsx) | Drop "leave blank" path (`expected_recipient_index` is required). Add a "WARNING: pair lend with withdraw discriminator" callout |
| [app/src/components/admin/PerformanceFeeEditor.tsx](app/src/components/admin/PerformanceFeeEditor.tsx) | Unchanged |
| New `app/src/components/admin/strategy/ReportLossButton.tsx` | Authority-only, on per-strategy admin page |
| New `app/src/components/admin/AdminTransferFlow.tsx` | Two-step propose/accept on per-vault admin page |

## 10. Scripts

| Script | Update |
|---|---|
| `scripts/setup-multi-vaults.ts` | New PDAs, new mint, same vault names + ids + strategy counts |
| `scripts/transfer-vault-admin.ts` | Use `propose_admin` + `propose_authority`; second call to accept must come from the recipient's keypair (8qKt…) — **needs the 8qKt keypair to be available**, OR transfer keypair stays with admin until accept-step is wired through frontend |
| `scripts/dump-deployment.ts` | Include `performance_fee_bps`, `total_active_weight_bps`, `pending_admin`, `pending_authority`, derived authority PDAs |
| `scripts/init-vault.ts` | New PDAs |
| `scripts/create-vault.ts` | Same |
| `scripts/create-strategies.ts` | Same |

## 11. Tests

[tests/my_project.ts](tests/my_project.ts) needs:
- All PDA derivations updated
- New tests for: cross-strategy drain attempt (must fail), virtual shares first-deposit, `report_loss` happy path + error, two-step admin (propose without accept doesn't change admin), weight sum cap, Token-2022 hook rejection, `init_if_needed` admin ATA on fee=0 vault

## 12. Documentation

- `OVERVIEW.md` §10 security model — rewrite cross-strategy row, Token-2022 row
- `MISMATCHES.md` — close §2.1 (per-strategy authority), §2.4 (virtual shares), §2.7 (Token-2022 hooks); shrink §2.3 to "instruction-sysvar introspection still deferred"
- `DEPLOYMENT.md` — full refresh, round-4 (`HgctyjCk…`) PDAs added to orphaned section
- `CLAUDE.md` — update "vault_state PDA is universal CPI signer" — that's no longer true; describe the new model

## 13. Migration steps (devnet)

In order:
1. Apply all program edits, `anchor build`
2. Update tests, `anchor test` against local validator (NOT devnet)
3. `solana program extend DXcUni7… 100000 --url devnet` (the new binary may exceed current data buffer)
4. `anchor upgrade target/deploy/my_project.so --program-id DXcUni7… --provider.cluster devnet`
5. Sync IDL: `cp target/idl/my_project.json app/src/idl/my_project.json && cp target/types/my_project.ts app/src/idl/my_project.ts`
6. `bun scripts/setup-multi-vaults.ts` — fresh test token, 5 vaults, 17 strategies (round 5)
7. Transfer DeFi Alpha admin/authority via the new propose flow:
   - `bun scripts/transfer-vault-admin.ts` calls `propose_admin` + `propose_authority`
   - The 8qKt keypair must call `accept_admin` + `accept_authority` to finalize. If we don't have 8qKt's keypair available to scripts, this is a documentation note: "DeFi Alpha admin transfer is in two-step pending-accept state. Wait for 8qKt to accept via the frontend's AdminTransferFlow."
8. `bun scripts/dump-deployment.ts` → refresh DEPLOYMENT.md
9. Update `app/src/lib/constants.ts` token mint
10. Update `app/.env.local` token mint

## 14. Acceptance

Done when:
- `anchor build` clean
- `anchor test` green (existing + new tests)
- All 5 vaults rendered correctly on the frontend home page
- A test withdrawal demonstrates the fee flow still works under the new vault_authority signer
- `git log` shows two commits:
  1. **In-flight checkpoint** (already committed before this refactor): `feat: withdrawal performance fee + AllowedAction frontend wiring`
  2. **Refactor**: `refactor: per-strategy authority PDAs + audit fixes (Phase-3)`

## 15. Out-of-scope deferrals (next tasks)

These are *user task* 2, 3, 4 from the same conversation:

- **Task 2** — Comprehensive program tests including invariants + fuzz. Build on the test base after this refactor lands.
- **Task 3** — E2E with mocked Kamino program + simulated AI agent. Needs a small Anchor program at `programs/mock_kamino/` plus a TS harness driving the agent.
- **Task 4** — Playwright E2E with mocked wallet for the frontend. Needs wallet-adapter mocking plumbing.

Each is its own subsequent commit.
