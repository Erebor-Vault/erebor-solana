# Task 3 — End-to-end test with mocked Kamino + simulated AI agent

> **Status.** Mock program shipped + E2E harness shipped. Harness will
> not run until [REFACTOR_PLAN.md](REFACTOR_PLAN.md) is applied (relies
> on `vault_authority`, `strategy_authority` PDAs and the dual-ATA
> snapshot in `execute_action`).

## Why this exists

The headline guarantee of Erebor is "the AI agent can only call admin-
whitelisted actions, and even those are bounded by anti-theft". To
demonstrate that, we need a target program the agent CPIs into via
`execute_action`. Real Kamino is too large to run in tests, so we
ship a minimal stand-in: same instruction names → same Anchor
discriminators, same shape of accounts → same execute_action wiring.

Once the refactor lands, this harness verifies end-to-end:

1. Strategy ATAs really are isolated (one strategy can't drain another via execute_action).
2. The whitelist gate really does revert un-listed (target, discriminator) pairs.
3. The recipient_index pin really does prevent siphoning to the agent's wallet.
4. Yield earned in an external protocol really does flow back to the vault and bumps `total_deposited` on `report_yield`.

## What's in this commit

| File | Purpose |
|---|---|
| [programs/mock_kamino/Cargo.toml](programs/mock_kamino/Cargo.toml) | Cargo crate for the mock program |
| [programs/mock_kamino/src/lib.rs](programs/mock_kamino/src/lib.rs) | The mock program — `init_reserve`, `deposit_reserve_liquidity_and_obligation_collateral`, `withdraw_obligation_collateral_and_redeem_reserve_collateral`, `simulate_yield` |
| [programs/mock_kamino/program-keypair.json](programs/mock_kamino/program-keypair.json) | Program keypair → ID `HLDVeTCx7mJeHApCpDptwbHd78iLCPYrFnVAymjrANp2` |
| [Anchor.toml](Anchor.toml) | Both programs registered for devnet/localnet/mainnet |
| [scripts/e2e-kamino.ts](scripts/e2e-kamino.ts) | The E2E harness — drives my_project + mock_kamino through deposit / yield / withdraw |

The mock program ID is also added to [target/deploy/mock_kamino-keypair.json](target/deploy/mock_kamino-keypair.json) (auto-managed by `anchor build`).

## Mock Kamino design

Real Kamino has hundreds of accounts and modes (oracle prices,
reserve farms, bad-debt management, redemption fees, …). The mock
keeps three moving parts:

- **`Reserve` PDA** — one per liquidity mint, seeds `["reserve", liquidity_mint]`. Tracks total liquidity + total cToken supply; signs CPIs that move funds in/out of the liquidity supply ATA.
- **Collateral mint (cToken) PDA** — seeds `["collateral_mint", liquidity_mint]`. Mint authority = the reserve PDA. Decimals match the underlying mint.
- **Liquidity supply ATA** — owned by the reserve PDA. Holds the underlying that depositors lent.

The redemption rate `liquidity_per_ctoken = total_liquidity / total_collateral_supply` rises as `simulate_yield` mints additional liquidity into the supply ATA without touching cToken supply. Real Kamino is more nuanced (interest accrues continuously per-block based on borrow utilization); the mock captures the same end-state in one admin-callable knob.

### Method names match real Kamino

The mock's two user-facing methods are named `deposit_reserve_liquidity_and_obligation_collateral` and `withdraw_obligation_collateral_and_redeem_reserve_collateral`. Anchor's discriminator algorithm is `sha256("global:<method>")[..8]`, so the bytes match real Kamino's. The frontend's [`actionPresets.ts`](app/src/lib/actionPresets.ts) lists those discriminators today against the *real* Kamino program ID; the test swaps in the mock's program ID and reuses the same discriminators.

### Accounts are simpler than real Kamino

Real Kamino's deposit takes 14+ accounts (oracle price feeds, reserve farms, lending market PDAs, etc.). The mock takes 8: source, destination collateral, reserve, liquidity mint, collateral mint, liquidity supply, user transfer authority, token program. The simplification is intentional — the wire format the agent uses (discriminator + 8-byte amount) is the same; only the account list shrinks.

For an admin connecting the real Kamino preset to a strategy, the actual on-mainnet discriminator + program ID still matches; only the *account list the agent passes* would be longer.

## Running the E2E harness

Pre-conditions:

1. Phase-3 refactor (REFACTOR_PLAN.md) is fully applied — the harness depends on:
   - `strategy_authority` PDA owns each strategy's token account
   - `execute_action` signs as `strategy_authority`, not `vault_state`
   - `expected_recipient_index` is mandatory in `add_allowed_action`
   - The `dual_token_ata` (caller + delegate) snapshot is in `execute_action`'s account list
2. A local validator is running (or a fresh devnet vault is available).

```bash
# Terminal 1
solana-test-validator -r --quiet

# Terminal 2
PATH="$HOME/.cargo/bin:$PATH" anchor build
anchor deploy --provider.cluster localnet
bun scripts/e2e-kamino.ts
```

Expected output:

```
[1] minting test token...
[2] init mock_kamino reserve...
[3] init Erebor vault + strategy...
[4] user deposits 1000 USDC...
    authority allocates 800 USDC to strategy...
[5] whitelisting Kamino deposit + withdraw on strategy...
    deposit  disc: 0x8239d6b02daefea5
    withdraw disc: 0xb1402d2c05998d05
[6] agent calls execute_action(deposit) → Kamino...
    deposited 500 USDC into Kamino
[7] admin simulates 50 USDC of yield in Kamino...
[8] agent calls execute_action(withdraw)...
[9] strategy ATA balance after withdraw: 850.0 USDC
    expected ≈ 550 USDC of principal+yield
✓ E2E happy path complete
```

## Negative tests still to add

The harness today drives the happy path. Add these assertions before declaring task 3 complete:

- **Un-whitelisted discriminator** — `execute_action` with a discriminator the admin never registered → reverts with `ActionNotAllowed`.
- **Wrong target program** — call with a `target_program` that doesn't match the AllowedAction PDA → reverts with `TargetProgramMismatch`.
- **Recipient pin violation** — relayed instruction routes the destination away from `strategy.token_account` (or, post-refactor, the strategy_authority's collateral ATA) → reverts with `RecipientMismatch`.
- **Cross-strategy account injection** — caller is delegate of strategy 0 but passes strategy 1's ATA in `remaining_accounts` → with the per-strategy authority refactor, the runtime simply rejects (signer seeds for strategy_authority[0] don't authorize strategy_authority[1]'s ATA). Confirm the failure mode is "signer privilege escalation" and not a silent success.
- **Anti-theft direct siphon** — relayed instruction transfers the underlying to the caller's ATA → reverts with `AntiTheft` (the dual-ATA snapshot catches it).
- **Authority emergency withdraw** — agent is offline; authority calls `execute_action` directly to redeem → succeeds, anti-theft snapshot fires on the *delegate's* ATA (not authority's) so it doesn't false-positive.

These six negative assertions are TODO inside `scripts/e2e-kamino.ts` — easy to add after the happy path passes.

## How this connects to the AllowedAction preset catalog

[`app/src/lib/actionPresets.ts`](app/src/lib/actionPresets.ts) ships hand-picked discriminators for real-protocol Kamino, Marginfi, Drift, Solend, Lulo, Jupiter, Raydium. The mock program lets us test the *flow* against a target whose Anchor build we control. When the test passes against the mock, the same code path runs against real Kamino on mainnet; only the program ID differs.

For confidence, when shipping to mainnet, an admin should manually verify each preset's discriminator against the protocol's published IDL or SDK before whitelisting it.

## Out of scope

- Real Kamino account enumeration. The mock's 8 accounts are enough to test our gateway; mirroring all 14 of mainnet is rabbit-hole territory.
- Other protocols. Once the Kamino path passes, similar harnesses for Marginfi / Drift / Solend are mostly copy-paste of `programs/mock_kamino/` with different method names.
- Performance benchmarking under load. The harness drives a single user flow; load tests belong in task 2 (TEST_PLAN.md).

## Related docs

- [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — task 1: per-strategy authority refactor (must land first)
- [TEST_PLAN.md](TEST_PLAN.md) — task 2: program tests (invariants + fuzz)
- [PLAYWRIGHT_PLAN.md](PLAYWRIGHT_PLAN.md) — task 4: frontend E2E
- [TASKS.md](TASKS.md) — top-level status of all four tasks
