# Task 2 — Comprehensive program tests (invariants + fuzz)

> **Status.** Plan only. Resume in a fresh session **after**
> [REFACTOR_PLAN.md](REFACTOR_PLAN.md) lands. This plan picks up
> from a green `anchor test` against the post-refactor program.

## Goals

1. Every state-mutating instruction has a **happy path** + **negative path** + **role check**.
2. **Cross-instruction invariants** are checked after every test mutation.
3. **Property-based fuzzing** over random sequences of deposit/withdraw/allocate/rebalance/yield/loss + checks invariants hold throughout.
4. **Hard-to-reach edges** (zero amounts, max u64, off-by-one, virtual-shares boundary) covered explicitly.

Out of scope here:
- E2E with mocked Kamino → see [E2E_KAMINO.md](E2E_KAMINO.md)
- Frontend E2E → see [PLAYWRIGHT_PLAN.md](PLAYWRIGHT_PLAN.md)

## Repo layout

```
tests/
├── my_project.ts              # existing happy-path suite (~38 tests today)
├── invariants.ts              # NEW — per-instruction invariant assertions
├── fuzz.ts                    # NEW — proptest-style randomized sequences
├── permissions.ts             # NEW — every "wrong signer" case
├── edges.ts                   # NEW — zero / MAX / off-by-one / virtual shares boundary
├── allowed_actions.ts         # NEW — whitelist gateway + cross-strategy isolation
└── helpers/
    ├── invariants.ts          # check_vault_invariants(), assertion helpers
    ├── fuzz_runner.ts         # sequence generator + executor
    └── fixtures.ts            # one-shot setup: vault + N strategies + funded depositors
```

## Invariants to verify after every mutation

These are properties that must hold for every reachable state. Add an `assertAllInvariants(vaultPda)` helper that checks all of them, and call it at the end of every test that mutates state.

### TVL identity

```
vault.total_deposited
  ==
reserve_ata.amount
  + Σ_{i ∈ active} strategy[i].allocated_amount
  + (any unrealized yield not yet reported)
```

The "unrealized yield" caveat is necessary because `report_yield` is the only path that increases `total_deposited` from external sources. Between `actual_balance > allocated_amount` and the next `report_yield`, the equality holds with `unrealized = strategy_token.amount - allocated_amount`.

### Share-price identity

```
share_price = total_deposited / share_supply
            == 1.0 immediately after first deposit (within virtual-shares rounding)
            >= 1.0 after first deposit if no losses
```

After a `report_loss(amount)`, `share_price` decreases by `amount / share_supply`.

### Performance-fee invariant

After every successful `withdraw(shares_to_burn)`:

```
shares_burned
  → user_token_ata.amount   += net = gross × (1 - fee_bps/10_000)
  → admin_token_ata.amount  += fee = gross × fee_bps/10_000
  → reserve_ata.amount      -= gross
  → vault.total_deposited   -= gross
  → share_supply            -= shares_burned
```

Two assertions: before/after balance deltas match the formula, and `total_deposited / share_supply` is preserved (within rounding).

### Weight-sum invariant (post-refactor)

```
vault.total_active_weight_bps
  ==
Σ_{i ∈ active} strategy[i].target_weight_bps
  ≤
MAX_TOTAL_ACTIVE_WEIGHT_BPS (10_000)
```

Verified after every `set_strategy_weight`, `deactivate_strategy`, and `create_strategy`.

### Per-strategy authority isolation (post-refactor)

```
strategy[i].token_account.owner == strategy_authority[i]
strategy[j].token_account.owner == strategy_authority[j]   for j ≠ i
strategy_authority[i] != strategy_authority[j]
reserve_ata.owner == vault_authority
share_mint.mint_authority == vault_authority
```

Verified at vault init + after every `create_strategy`.

### Pause-flag invariant

```
vault.paused == true  ⇒  deposit / allocate / deallocate / rebalance / report_yield  all revert with VaultPaused
vault.paused == true  ⇒  withdraw still succeeds (users can always exit)
```

A dedicated test toggles pause and verifies each gated path reverts.

### Two-step admin invariant

```
propose_admin(X) sets pending_admin = X but admin unchanged
accept_admin (signed by X) promotes pending → admin, clears pending
accept_admin (signed by anyone else) reverts with NotPendingAdmin
```

Same for authority.

## Per-instruction test matrix

For each instruction below: ✅ happy, ❌ negative, 🚫 wrong-role, ⚙ edge.

| Instruction | ✅ | ❌ | 🚫 | ⚙ |
|---|---|---|---|---|
| `initialize_vault` | normal mint | duplicate (already inited) | non-admin | Token-2022 with TransferHook (must reject) |
| `deposit` | first / repeat | paused, zero amount | n/a (anyone) | virtual-shares boundary, u64 max |
| `withdraw` | partial / full | insufficient reserve, zero shares, zero underlying after rounding | n/a | fee=0 path, fee=2000 (max) path, init_if_needed admin ATA |
| `create_strategy` | first / Nth | duplicate (same id) | non-admin | duplicate delegate across strategies (must reject — DuplicateDelegate) |
| `update_strategy_delegate` | new pubkey | same as current | non-admin | duplicate delegate — must reject |
| `set_strategy_weight` | normal | weight > 10_000 | non-admin | sum > 10_000 across active — must reject |
| `allocate_to_strategy` | normal | reserve < amount, paused | non-authority | strategy inactive |
| `deallocate_from_strategy` | normal | strategy < amount, paused | non-authority | strategy inactive |
| `rebalance_strategy` | up / down / no-op | n/a | non-authority (was permissionless, now authority-only) | weight=0 fully drains |
| `deactivate_strategy` | drained strategy | strategy still has funds (StrategyStillHoldsFunds) | non-admin | weight is decremented from total_active_weight_bps |
| `report_yield` | gain | loss (must revert via `actual_balance < allocated_amount` → use report_loss instead) | non-authority | strategy ATA mint mismatch — must reject |
| `report_loss` (new) | normal | amount > total_deposited (LossExceedsDeposited) | non-authority | matched by deallocate to drain |
| `set_paused` | toggle | n/a | non-admin | n/a |
| `set_performance_fee_bps` | normal | bps > MAX_PERFORMANCE_FEE_BPS | non-admin | 0 → fee CPI skipped |
| `propose_admin` | normal | n/a | non-admin | proposing self |
| `accept_admin` | by pending | by anyone else (NotPendingAdmin) | n/a | clears pending after accept |
| `propose_authority` | normal | n/a | non-admin | n/a |
| `accept_authority` | by pending | by anyone else (NotPendingAuthority) | n/a | n/a |
| `add_allowed_action` | normal | duplicate (already exists) | non-admin | recipient_index = u16::MAX |
| `remove_allowed_action` | existing entry | non-existing | non-admin | n/a |
| `execute_action` | whitelisted call | un-whitelisted disc, wrong target_program | non-delegate AND non-authority | dual-ATA snapshot fires on either ATA growth, recipient pin violation, **cross-strategy ATA injection rejected** |

Total target: ~120 tests across the matrix.

## Property-based fuzzing

Define a state machine:

```
state = {
  vault: VaultState,
  strategies: [StrategyAllocation; N],
  user_balances: Map<Pubkey, (token_ata, share_ata)>,
  agent_balances: Map<Pubkey, (token_ata, c_token_ata)>,
}
```

Operations (chosen with random weights):
- `deposit(user, amount)` where `amount ∈ [0, user_token_balance]`
- `withdraw(user, shares)` where `shares ∈ [0, user_share_balance]`
- `allocate(strategy_id, amount)` where `amount ∈ [0, reserve_balance]`
- `deallocate(strategy_id, amount)` where `amount ∈ [0, strategy_token.amount]`
- `rebalance(strategy_id)` (post-refactor: authority-signed)
- `set_weight(strategy_id, bps)` where `bps ∈ [0, 10_000]` (constrained so sum never exceeds the cap)
- `simulate_yield(strategy_id, amount)` (testbed-only — mints to strategy ATA)
- `report_yield(strategy_id)`
- `report_loss(strategy_id, amount)`

For each random sequence (length 50–500):
1. Apply operation, capture pre/post state
2. Verify all invariants hold
3. If any fails, shrink the sequence to find the minimal counter-example

Implementation: `fast-check` (the JS `proptest` equivalent) wraps the sequence generator. A fuzz "run" is one batch of, say, 100 random sequences. CI runs 1 batch; nightly runs 100.

## Edge cases

- **First deposit at exactly `VIRTUAL_SHARES`**: shares should be `amount × (0 + VIRTUAL) / (0 + 1) = amount × VIRTUAL`. Verify the OZ formula matches expectation.
- **Inflation attack attempt**: deposit 1 wei, donate 10^18 to reserve, second user deposits 100 USDC — they should still get a meaningful share. Without the offset their share would round to 0; with the offset they get a defensible slice.
- **MAX u64 amount on deposit**: u128 widening should hold. Deposit `2^63` (half of u64::MAX) into a vault, withdraw it back, verify share count is exact.
- **Zero-amount withdrawal**: shares_to_burn > 0 but `underlying_amount` rounds to 0 (extreme share-price scenarios). Should revert with `ZeroAmount` (audit #12).
- **fee_bps == 0**: withdraw works without admin's USDC ATA being initialized.
- **fee_bps == MAX (2000)**: 20% fee, math still doesn't overflow.
- **Loss followed by deposit**: depositor at lower share price gets more shares per USDC. Invariants still hold.
- **Deactivate active strategy with allocated > 0**: must revert (StrategyStillHoldsFunds).
- **Re-allocate to deactivated strategy**: must revert (StrategyInactive).
- **Allowed-action discriminator collision attempt**: two different (target, disc) pairs hashing to colliding PDA seeds. Should be impossible by construction (32+32+8-byte seeds), but assert it.

## CI integration

- Existing `bun run lint` + `anchor test` runs the happy-path suite. Add `bun run test:invariants` and `bun run test:fuzz` (latest 1 batch).
- Nightly (or on `main` push): full fuzz batch (100 runs).
- Coverage target: > 90% line coverage on `programs/my_project/src/lib.rs` after this lands. Use `cargo llvm-cov` against the program crate, exporting to lcov.

## Acceptance

Done when:
- `tests/invariants.ts`, `tests/fuzz.ts`, `tests/permissions.ts`, `tests/edges.ts`, `tests/allowed_actions.ts` exist and all pass.
- The per-instruction matrix above is filled in.
- `cargo llvm-cov --workspace --lcov` shows > 90% on `programs/my_project/src/lib.rs`.
- 1 fuzz batch (100 random sequences) passes.
- One commit: `test: invariant + fuzz + permission test suite (task 2)`.

## Related

- [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — task 1, must land first
- [E2E_KAMINO.md](E2E_KAMINO.md) — task 3
- [PLAYWRIGHT_PLAN.md](PLAYWRIGHT_PLAN.md) — task 4
- [TASKS.md](TASKS.md) — top-level status
