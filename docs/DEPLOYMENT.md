# Deployment Info

## Programs (devnet, current)

| Program       | Program ID                                        | Notes                                  |
| ------------- | ------------------------------------------------- | -------------------------------------- |
| `my_project`  | `FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo`    | Vault, Phase-1–3 hardening + Phase-4a/b/d + Phase-5/5b (`PythPriceFeed` ValueSource). Anchor 0.32.1, Rust 1.89.0 |
| `mock_kamino` | `H4tUCeXMQduSmB6fjqbYMdFb49E8YnEHku5NWFrWKaGU`    | cToken model + obligations/borrow/repay |
| `mock_lulo`   | `DUECqnJ77fP2Kd9SqeTsVc9n7MiTaBvSW3mREM8DuBVs`    | Treasury + per-strategy ProtocolPosition |
| `mock_pyth`   | `2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq`    | Pyth-style price feed (`MockPriceFeed` PDA seeded `[b"price", mint]`); devnet/localnet only |

| Stale program ID                                | Replaced by / status                              |
| ----------------------------------------------- | ------------------------------------------------- |
| `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B` | OLD_Erebor's source `declare_id!`, never deployed |
| `HLDVeTCx7mJeHApCpDptwbHd78iLCPYrFnVAymjrANp2` | OLD_Erebor's source `declare_id!` for mock_kamino, never deployed |
| `B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z` | **Closed** 2026-05-02; ID burnt by Solana loader. Replaced by `FuAJhy…`. ~4.95 SOL rent reclaimed. |
| `S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK` | **Closed** 2026-05-02; ID burnt. Replaced by `H4tUCe…`. ~2.68 SOL reclaimed. |
| `3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm` | **Closed** 2026-05-02; ID burnt. Replaced by `DUECqn…`. ~1.93 SOL reclaimed. |

## Phase-5b deploy (2026-05-03) — `my_project` upgrade + `mock_pyth` fresh deploy

Plan 1 of the strategy-config-presets work
([spec](superpowers/specs/2026-05-03-strategy-config-presets-design.md),
[plan](superpowers/plans/2026-05-03-plan-1-pyth-value-source-and-mock-pyth.md))
shipped a new `ValueSource` variant `PythPriceFeed` and a companion
`mock_pyth` program that produces price accounts in a Pyth-compatible
wire layout (price/expo/publish_time at offsets 8/16/20 after the
8-byte Anchor disc).

| Program       | Action                                | Tx signature                                                                                                            | Schema impact |
| ------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| `my_project`  | **Upgrade in place**                  | (in `anchor deploy` output — IDL upgraded at `BXd4T37ekJ9BF6mBc3sWStp3nbsAyQSqDACKA2Dx5BAi`)                             | Additive: new `kind = 2` (PythPriceFeed) + 5 B carved out of `ValueSource._reserved` for `mint_balance_source_index: u8` + `max_staleness_secs: u32`. `add_value_source` now takes 9 args (was 7); existing accounts deserialise unchanged because the new bytes were already zero in `_reserved`. |
| `mock_pyth`   | **Fresh deploy** at `2AnSsnW…URoq`    | [`5yaSN9u7…`](https://explorer.solana.com/tx/5yaSN9u7KcMmmVUEL4MvbGLMT2gr4buxWLL99MPfGJdecwqQ5SXTwEcsNZAxKQGYE11e4VnFzM54zLRwxLDpPfVt?cluster=devnet) | New program; IDL at `A4yHRmHHcyJpFue39YZg2BfSguukiFKf8Bsx7Tovfgr6`. |

Authority on both programs: `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (deployer wallet, same as Phase-1–3 redeploy).

**SOL impact:** ~1.4 SOL net (deployer 14.98 → 13.57). The `my_project`
upgrade was effectively free — new `.so` (878,864 B) is smaller than
the existing program data allocation (901,800 B), so no extra rent.
`mock_pyth` paid ~1.4 SOL for a 199,360 B program account + buffer.

**Mainnet posture:** `mock_pyth` is gated out of mainnet via
[scripts/deploy.sh](../scripts/deploy.sh) (`anchor deploy` is restricted
to `--program-name my_project` when `CLUSTER = mainnet`). The
`my_project` upgrade itself is mainnet-safe in principle (additive,
backwards-compatible); the live mainnet flip is tracked under
[FOLLOWUPS.md A4](FOLLOWUPS.md#a4-mainnet-wiring-for-strategy-config-presets).

**Pre-existing devnet state:** unaffected. Round-7 vaults + their
strategies + already-registered `ValueSource` accounts continue to
work — the two new fields are zero in pre-existing accounts and the
two existing kinds (`SplAtaBalance`, `AccountU64`) ignore them.

## Phase-1–3 redeploy (2026-05-02) — close + fresh deploy under new IDs

Phase 1 / 2 / 3 of the program upgrade introduced layout-breaking changes
on `VaultState` (`_reserved: [u8; 64]`), `StrategyAllocation`
(`_reserved: [u8; 32]`), and `AllowedAction` (added `loss_per_call_bps_cap`,
`cooldown_secs`, `last_executed_at`, `_reserved: [u8; 32]`), plus six
new instructions (`rebalance_with_delta`, `set_auto_action_config`,
`clear_auto_action_config`, `add_value_source`, `remove_value_source`,
`settle_strategy_value`).

Solana's BPFLoaderUpgradeable now permanently burns a program ID once
`solana program close` runs against it — `anchor deploy` against a
closed ID returns `Program <id> has been closed, use a new Program Id`.
The path-B-port IDs (`B7EUo8…` / `S4taBh…` / `3YSjEZ…`) were closed
to reclaim rent (9.57 SOL total) and three fresh keypairs were
generated under `target/deploy/`. The closed keypairs are archived in
`target/deploy/closed-keypairs-archive/`.

`anchor keys sync` updated `declare_id!` in each crate. `Anchor.toml`
was updated for `[programs.devnet]`, `[programs.localnet]`, and
`[programs.mainnet]`. `app/src/idl/my_project.{ts,json}`,
`app/src/lib/constants.ts`, `app/src/lib/adapters/{mockKamino,mockLulo}.ts`,
`agent/lulo/src/config.ts`, `agent/kamino_looper/src/config.ts`, and
test fixtures were rewritten to reference the new IDs. Net SOL impact:
~10.58 SOL spent on redeploy vs. 9.57 SOL reclaimed — roughly break-even
modulo the binary-size growth from the new instructions.

After the redeploy:

- `bun scripts/init-protocol-config.ts` re-bootstrapped the
  `ProtocolConfig` PDA at `JED48w78V2R6ZJL4gzUd4PMo5bGSqu5FogGNDsAAjKsm`
  (governance + treasury = deployer wallet, `protocol_fee_bps = 200`,
  init tx `3iCg5ZEMbWpytSCAEyvvm1mcAdCyJGz9XzeYhsDdQRvU1CrpWB3gVMqcAMj3wHmHrhHa1atD47zdwDPCVLDyKq4H`).
- `bun scripts/setup-multi-vaults.ts` minted a fresh test USDC
  (`7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE` — round 7) and
  initialised 5 vaults with their strategies; allocations + simulated
  yield were folded into each `VaultState.total_deposited`.
- `bun scripts/transfer-vault-admin.ts` proposed admin + authority
  transfer of vault 4 (DeFi Alpha) to
  `DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike`. The recipient must
  call `accept_admin` and `accept_authority` from their own keypair to
  finalise; until then the live admin / authority remain `4wrBiaN…`.

All round-5 / round-6 vaults are unreachable: their `VaultState` PDAs
were derived from the old (now-closed) program IDs, so even though the
PDA addresses are still on-chain under the burnt program IDs, the
current `my_project` (`FuAJhy…`) doesn't own them. Round-7 is the only
live cohort.

## Path-B port deploy (2026-04-30) — upgrades all 3 programs in place

After completing the path-B port (see [PORT_PROGRESS.md](PORT_PROGRESS.md))
all 3 programs were redeployed via `anchor deploy --provider.cluster devnet
--program-name <each>`. Same program IDs reused (the keypairs in
`target/deploy/` matched the previously-deployed devnet programs after
`anchor keys sync`), so this is an **upgrade in place**. No IDs burned, no
rent reclaimed.

| Program       | Tx signature                                                                                                            | IDL data account                                  | Schema impact |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------- |
| `mock_lulo`   | [`2R2YiSG2…`](https://explorer.solana.com/tx/2R2YiSG2j3MupqbZfjaPTqiMZY2a1SNfm25Vi9poBEfaQu3HeWQbBnNXGaaFiwuTyoBijJJxtjvNi8maMCZJLvyc?cluster=devnet) | `3B36KpZCncdwvxrdM8BJDh1a3T2d4op4P1BtXpYTyRLf`   | None — same code as newArch port |
| `mock_kamino` | [`3u9wnXnC…`](https://explorer.solana.com/tx/3u9wnXnCj21sdE9PA9vvmiwtUYcqmATYb6vrWbw3867q7mM4tBKTQ8YiSf5BVKB1xJWkd5ZeNL9CChGDa9GEL3h8?cluster=devnet) | `62eKv1mCJt2k1pzFoduKj7Yz7ntsLprtsm2zENe3B25E`   | **Breaking** — was newArch oracle/multi-asset/ProtocolPosition; now OLD_Erebor cToken/single-mint + obligations |
| `my_project`  | [`2x7jdpGL…`](https://explorer.solana.com/tx/2x7jdpGLDcGMmRNk2exMjRz7pQv7nMFPvPCdHYBMkfZcNh5Zv4enQLhNTka34tUXunoTSkTBjVt3ZXzjdz9VsFQD?cluster=devnet) | `FAf4W4hYgddkZsb7HYis7cDjWswT6T7rvrhiNau6RGpq`   | **Breaking** — was newArch (`execute_strategy_action`, action_id-based AllowedAction); now OLD_Erebor (`execute_action`, deterministic AllowedAction PDA seeds, per-strategy authority PDAs, two-step admin transfer, virtual-shares offset). See PORT_PROGRESS.md |

### Stale on-chain state from before this redeploy

mock_kamino's schema flipped. Any `Reserve` / `Obligation` accounts created
before this deploy are unreadable by the new program:

- **`Obligation`** seed changed from `["obligation", strategy_token_account]`
  to `["obligation", reserve, owner]` (owner = `strategy_authority` PDA).
  New PDAs live at completely different addresses — no collision with old.
- **`Reserve`** seed is unchanged: `["reserve", liquidity_mint]`. **If you
  previously initialized a reserve for the same mint, `init_reserve` will
  fail with "account already exists".** Either init the new strategies
  against a *fresh* test mint, or close the old reserve via the old admin
  keypair before re-running setup.

my_project's `AllowedAction` PDA seeds also changed (newArch:
`[strategy, action_id u16]`; OLD_Erebor: `[strategy, target_program,
discriminator]`). Old AllowedActions are orphaned at the old seeds; new
ones land at fresh addresses. Old `StrategyAllocation` accounts share the
discriminator but the field layout changed (`actionCount` removed,
`target_weight_bps` + `authority_bump` added). Treat any pre-redeploy
strategies as stale and recreate fresh ones via the new setup scripts.

Round-5 vaults at USDC mint `5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N`
have been superseded by round-6 (mint `GhE6BWCz…`) — see "Devnet Vault
Instances (current — Phase-3, round 6)" below. Round-5 strategies +
AllowedActions are orphaned on-chain.

## Devnet Deployment (Phase-4d — token whitelist, on top of Phase-4b)

Phase-4d program changes:

- New per-mint **`AllowedToken`** PDA at seeds `["allowed_token", mint]`.
  Existence of the PDA is the whitelist check; the data carries the mint
  (for off-chain `program.account.allowedToken.all()`) + bump.
- New instructions: `add_allowed_token(mint)`, `remove_allowed_token(mint)`,
  both gated by `protocol_config.governance`.
- `AllowedAction` extended with `output_mint_index: Option<u16>` (layout-
  breaking — existing AllowedActions need re-creation).
- `add_allowed_action` signature gains the new field.
- `execute_action` gains an `allowed_output_token: AccountInfo<'info>`
  slot. When the action's `output_mint_index` is `Some`, the program
  derives `["allowed_token", remaining_accounts[idx].key()]`, requires
  the supplied account to match, and requires it to be a live program-
  owned PDA (lamports > 0 + owner == program). When `None`, the slot is
  ignored — caller passes `SystemProgram::id` as filler.
- New errors: `OutputMintNotAllowed`, `OutputMintIndexOutOfRange`.
- New events: `AllowedTokenAdded`, `AllowedTokenRemoved`.
  `AllowedActionAdded` extended with `output_mint_index`.

Initial whitelist on devnet: the round-5 USDC mint
`5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N` was added via
[scripts/init-allowed-token.ts](scripts/init-allowed-token.ts) (tx
`VNFd2uPdxUQKUkBQ2X6YB2rnxHAYdEngR8ArJjLWe2VZ2hp1AE4wvhiy6vLqxUFS7ZBQ9xrZxD1PEfkj89SgfZ7`).
Add more mints with `bun scripts/init-allowed-token.ts --mint <pubkey>`
(governance signer must run it).

## Devnet Deployment (Phase-4b — auto-pull on withdraw, on top of Phase-4a)

Phase-4b program changes:

- **`withdraw` now auto-pulls from strategy ATAs in id order when the
  reserve can't cover the requested underlying.** Caller passes
  `[strategy_pda, strategy_authority, strategy_token_account]` triples in
  `remaining_accounts`; the program walks them, pulling
  `min(strategy_ata.amount, shortfall)` from each strategy ATA → reserve
  (signed by `strategy_authority[i]`), updating `strategy.allocated_amount`,
  emitting `StrategyDeallocated`. New error `InsufficientLiquidity` is
  raised if the chain still can't cover after iterating.
- Funds parked in *external* protocols (Kamino reserve, Drift sub-account,
  etc.) aren't touched by this loop. The agent / frontend is expected to
  redeem via `execute_action(<protocol>_withdraw, …)` first; redeemed
  funds land in the strategy ATA and are swept by the auto-pull on the
  next `withdraw`. Adapter helpers + `useWithdraw` orchestration that
  bundle the redeem with the withdraw atomically land in Phase-4c.



Phase-4a program changes:

- New singleton **`ProtocolConfig`** PDA at seeds `["protocol_config"]`
  holding `governance`, `treasury`, `protocol_fee_bps` (default 200).
- `withdraw` splits the performance fee in two: `protocol_fee_bps × gross / 10_000`
  to `treasury`'s underlying ATA (init-if-needed), the remainder
  `(performance_fee_bps − protocol_fee_bps) × gross / 10_000` to the vault
  admin's ATA.
- `set_performance_fee_bps` now requires `new_bps ≥ protocol_fee_bps`.
- New instructions: `initialize_protocol_config`, `set_treasury`,
  `set_protocol_fee_bps`, `set_governance` (last three gated by
  `protocol_config.governance`).
- New errors: `UnauthorizedGovernance`, `TreasuryMismatch`,
  `PerformanceFeeBelowProtocolFee`.
- New events: `ProtocolConfigInitialized`, `TreasurySet`, `ProtocolFeeBpsSet`,
  `GovernanceSet`. `PerformanceFeeCharged` extended with `treasury_fee` /
  `curator_fee` / `protocol_fee_bps`.

Phase-3 changes (still in effect — see [REFACTOR_PLAN.md](REFACTOR_PLAN.md)):

- New PDAs: `vault_authority` (one per vault) and `strategy_authority[i]`
  (one per strategy) — these are the new CPI signers; `vault_state` becomes
  pure config and never signs.
- `VaultState` adds `vault_authority_bump`, `total_active_weight_bps`,
  `pending_admin`, `pending_authority` (layout-breaking).
- `StrategyAllocation` adds `authority_bump` (layout-breaking).
- `AllowedAction.expected_recipient_index` is now required `u16` (was
  `Option<u16>`).
- `transfer_admin` / `set_authority` removed; replaced with two-step
  `propose_admin` + `accept_admin` and `propose_authority` + `accept_authority`.
- New `report_loss` instruction.
- New errors: `LossExceedsDeposited`, `NotPendingAdmin`,
  `NotPendingAuthority`, `WeightSumExceedsMax`, `MintHasTransferHook`,
  `MintHasPermanentDelegate`, `DuplicateDelegate`, `MathOverflow`.
- New events: `LossReported`, `AdminProposed`, `AuthorityProposed`.
- Deposit/withdraw use OpenZeppelin virtual-shares offset
  (`VIRTUAL_SHARES = 1_000_000`); share-token decimals run 10⁶ ahead of
  the underlying.

| Param            | Value                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Cluster          | `devnet`                                                                                       |
| RPC URL          | `https://api.devnet.solana.com`                                                                |
| Last Upgrade Tx  | `5yrwS6rnqgYSozjnp6mmCNXaRywkZ2wPsvja5f67BCqpWfzNoW1csxHv9MtpxUSTYedPuUfmEgZqkaeGcmDZeXgq` (Phase-4d — token whitelist) |
| Phase-4b tx      | `VUi8EAwXHbgQbokMuwUUSNq6LF83wKEFyKJMZ8jukehFpTXJQjg4RmSCPvkFWsJ3wBjXCfHSdMVaP21J7H9GPTy` (auto-pull on withdraw) |
| Phase-4a tx      | `3J1watnXbNz1QfkggdYUyJsUx38HufAVZSW7tpQpEKkdKjDN72gZoLut5maztX4TXk12oHZtfwvhqXAFs6KCFnL1` (treasury fee split) |
| Wallet (deployer)| `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                |
| Test Token Mint  | `GhE6BWCzx1EZjP36oK34Y4S57FGfLx2y4GEZSVXUQggc` (6 dp, mint authority = wallet, round 6 — 2026-05-01) |
| Explorer         | https://explorer.solana.com/address/FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo?cluster=devnet |

### ProtocolConfig (Phase-4a)

Singleton PDA at seeds `["protocol_config"]`. Carves a constant 2 % cut
from every withdrawal's performance fee, routed to `treasury`'s underlying
ATA. The remainder of `vault.performance_fee_bps − protocol_fee_bps`
goes to the vault admin (curator). Reinitialise via
[scripts/init-protocol-config.ts](scripts/init-protocol-config.ts).

| Param             | Value                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| ProtocolConfig PDA| `JED48w78V2R6ZJL4gzUd4PMo5bGSqu5FogGNDsAAjKsm` (re-initialised 2026-05-02 under `FuAJhy…`)    |
| Governance        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                |
| Treasury          | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (deployer wallet, rotatable via `set_treasury`) |
| protocol_fee_bps  | `200` (2 %)                                                                                    |
| Init tx           | `3iCg5ZEMbWpytSCAEyvvm1mcAdCyJGz9XzeYhsDdQRvU1CrpWB3gVMqcAMj3wHmHrhHa1atD47zdwDPCVLDyKq4H`     |

## Devnet Vault Instances (current — round 7)

All five vaults share the test token mint
`7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE` and were initialised by
[scripts/setup-multi-vaults.ts](scripts/setup-multi-vaults.ts) on
2026-05-02 against the fresh `my_project` deployment at
`FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo`.

DeFi Alpha (vault 4) has admin + authority **proposed** to
`DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike` via
[scripts/transfer-vault-admin.ts](scripts/transfer-vault-admin.ts):

- `propose_authority` tx `5xoQQvEH3LBRKXEaAyYAKAEta1CrtcJvLSAV1Kif5B8ajP9FvmjzoAD68BoMKNt3Fd2JZhP9w4HvRxj5rTC9JxAs`
- `propose_admin` tx `pZxhVb275DSkrc9eScSMPK2G9ihr8cRZQmQCzDRxaQrNUMozL6frvJRgF6yHKuXw42frDYCapFqXDJXgLx4uWgj`

The recipient must call `accept_admin` and `accept_authority` from their
own keypair to finalise. Until then, `4wrBiaN…` remains the live admin
and authority on vault 4 too. The deployer wallet (`4wrBiaN…`) holds
admin + authority on vaults 0–3 outright. Performance fee defaults to
500 bps on every vault.

| Vault | Name | Vault PDA | TVL (USDC) | Strategies | Active wt sum |
| ----- | ---- | --------- | ---------- | ---------- | ------------- |
| 0 | AT trader agent | `9Sb7qoB8TdWnNybm7AgyUNkjYR8U3icvo6VcTW5xPoUj` | 105.76 | 4 | 5500 bps |
| 1 | Conservative | `DfpsHCp7KY8EYkDMyAuAPQXdZg3rM4HhKLvGbu71MHb6` | 51.02 | 2 | 6000 bps |
| 2 | Aggressive Vault | `JE84KzophftPHUxB9LvKqubUqAGbCpTiCsJUpDujH7nd` | 228.35 | 5 | 7500 bps |
| 3 | Stablecoin Yield | `Cj8mc49SixSWCT4RxG6VDTH29ya4s6azDAFeZreY2Ewb` | 83.725 | 3 | 7500 bps |
| 4 | DeFi Alpha | `DcXb3hpfZHCSajC6yRXreuVr4MHepNmEQ4mFwgsfvZeb` | 129.20 | 3 | 6249 bps |

Per-vault PDA detail (vault_authority, share_mint, reserve_ata, and
strategy lists) regenerated by `bun scripts/dump-deployment.ts`. Vault
authorities and strategy authorities are derived deterministically from
seeds — see "PDA Derivation Seeds" below.

### Vault 0 — AT trader agent

| Param | Value |
| ----- | ----- |
| Vault Authority | `Bqru9SK2bD6X3MK37CYPg7nJtMBQjqWP3HrZdUKoNyub` (re-derive from `["vault_authority", vault_pda]`) |
| Share Mint | derived `["shares", vault_pda]` |
| Reserve ATA | derived from `(vault_authority, token_mint)` |

Strategies (all admin/authority = `4wrBiaN…`):

| # | PDA | Strategy Authority | Token Account | Delegate | Weight | Allocated |
| - | --- | ------------------ | ------------- | -------- | ------ | --------- |
| 0 | `89uMajerzxnVUP2QnkfDxZ9zFYhYNtMwLbKAUfDVF2ih` | `9XnWSYCsFjtuwy13YebHbvMiaJ36k15zoSpSY8oEaLMM` | `EhYJtXAnud3JaNYNybbT5vVqtEoW3h45fVUgb2dNJs7Q` | `BqELWRVy1RWKcauzEUuVkoQJJ9yDkk15kmLMDEY4QZ3W` | 2000bps | 21.00 |
| 1 | `AEguZMcjjPfAGUrYb5MikAGLaH9ErcW1Bsn5Z16BBHn6` | `4PNTuXefuew9cMJWecb9UL3vPUX92VNBsAuQJjZ2zCfX` | `Hm5LA8Gu2dgKit5oVyf2ej7N4rXjZaRP6usMPbsGgaio` | `FpCYAgLZxMCSJ4MZhzjKsjpgWW3ovhTjpEcKA7YSwjQh` | 1500bps | 16.20 |
| 2 | `6kajpifV3GAmrdSidmEjwLZEpSpwZeZznQnv5muU3DQu` | `4JhbS3JGBGF1MLr3gmUxdNB8HppFPLcN9bbYKqNpbB15` | `B5x1QNkefRDk8XbuXfrE184aAEDxZunpzJ7RTfS3z5Eq` | `HjfqumtoMiG2MsxbYXRFQipf8EdaWNi11ihWbmWYhRED` | 1200bps | 13.80 |
| 3 | `DVaVTVRxG9kvQRnY4vFojrqgfd2mHhxs1uTZssSoNrLd` | `F1KMWi7bnTyc5RCMaibpski7FJp3gJJSrHSB4ZqA5JTD` | `HH2r2ZvBRbxrMYEMToKiNoU5b4hqttKDMmwunVGWLvmy` | `79jh53dDdGhzreTduAQ3gKKt2bNjQkuUZ8qy8KLSAEup` | 800bps | 9.76 |

### Vault 1 — Conservative

| # | PDA | Strategy Authority | Token Account | Delegate | Weight | Allocated |
| - | --- | ------------------ | ------------- | -------- | ------ | --------- |
| 0 | `Czqy9MWsZiCzYL9ueabvdcntpnbefqTWpFTYHVvaAMqe` | `9S4MsEhc3YydA8fZEw54dSUd27q73Xw2ky7kV4HH1n5d` | `8exE1L6FG3aAemrA31GRHNddKUZTChUuAyQaN3By8tVF` | `J9Wa8qUAzKJaHffBea9HX9AE4sr4tjd56exMa9h5f8Ly` | 3600bps | 18.54 |
| 1 | `5TcYrUGPzr3MPqUMzMJADLP2HesgYXki7pR48sZ5mZze` | `jFVJh4pqMGgreukEkMRzxeB9zAWRnNLoueLkv2HwBKM` | `E4QGX5iqqqMRUFccRsBfDmYH9PFnpDwsD6fXCXK4K7wA` | `Hy6QAZsRYf3wxhZHZimgqurEUCyHmhpYFDgEvKvMZXgp` | 2400bps | 12.48 |

### Vault 2 — Aggressive Vault

| # | PDA | Strategy Authority | Token Account | Delegate | Weight | Allocated |
| - | --- | ------------------ | ------------- | -------- | ------ | --------- |
| 0 | `CUveFDgTBz3Wa7WjjU8SNzZyRT9cmM11vV4jBg9zvqKL` | `GdR3ayDg7anu2ztoiQT1Je1LYEyM2vabJZkq2EanxCDr` | `8wYXu1cUkkybkzXy2YdnzcG8XLR5gn76FtKK6jTYkzDp` | `A4KDHec47HCXhfeGhDGsDrrT75AkEr1bpRsbuX5PUkZg` | 2000bps | 44.80 |
| 1 | `EUe6pHHA7mps3y6hLHgtG1y8wmA1UvZLViYKkVRQ3cSL` | `M5igsH8wihwanNtfw5d6fpb5NZQuMv1dYuWPoe8re17` | `Hv5ts274DAnZZjg965JYf8nTj1ULUe7ZpkMW7hpkPLNt` | `GLtMQ2zYeGk1L9VTak6RgN3LRVB5x4sioKrMxYvoUU9p` | 1750bps | 41.30 |
| 2 | `FywshrgLXaCUfGnLHN1pMRBvZhgq4Djm7ByE739ofLX8` | `97i1vdQ23idjLzkV4ZWYXuPVrbdU4e2zLr7JadPW2mYS` | `GCVXzByKfYCzXCxv76y6EmqDCGGJrWd4N5Nb4hFUdTsn` | `GNoAGCJHaDP3RfbH2Ud1LTL6Mg9uizie97MHDgJQ2ers` | 1500bps | 37.50 |
| 3 | `CM4aFovWqePSoRNx8NPo2gb4hhLTG8czAuQCAqRQ7nnA` | `H6HxKQKNAg337scvpQFtZthJjeR2WoNNFZ2h4SqFYz8b` | `8stPKWnoVGXQ4P2WSJ64rykU73JubouLcG2rmQfsRHp4` | `CQzRon3LPX52i4PkhKPymNp3MP7zi4JAm3GW8ijwJMP4` | 1250bps | 28.75 |
| 4 | `RQ54iU1cpTymc2E7L5M8f4YjaaU8GuELSzg1EpH7D2f` | `5VGU81wKxSGUzcxpr93iesM16v633reB7K4MM9r1P4Pj` | `FmiR13pBQQmfNht1EZw7u6oYkn91A4Kevg18ZEeGCtFs` | `5StjfQnSs6xit5WQdBFaheEEGmzRyp1CTFhTLVdDC6iY` | 1000bps | 26.00 |

### Vault 3 — Stablecoin Yield

| # | PDA | Strategy Authority | Token Account | Delegate | Weight | Allocated |
| - | --- | ------------------ | ------------- | -------- | ------ | --------- |
| 0 | `7AegJ8PVu67WiUnzTVWiAjY9r5hUPQTGw8A8VW8JqJsF` | `8Zh6f8ts6mgq9kDUwoZapnhPcTPuVBBcJVcbZeRY69JK` | `2kNE3SrCHEFEcFwmNM9s7UfjB8yUpzDvhfqyixXqy4WM` | `EwTW1MJm8sBbEDqreXwUC3jwAhQGnc8oCtj7iFaeUTHS` | 3125bps | 26.50 |
| 1 | `A3PC6JJXRquAZLSVR1BCdRbGusyz4PPMsgAskenPRa5r` | `FKvrBobVHx3ENGPphDF4muxBBsZrkA9MyW38pGsfT869` | `D6WKxeuJKe3FjGefEPRjemyJr1LpBp4HFpGsUTnB64Wk` | `5Zz25vkr2EFC7eVhyQ27gAjUiRBU7HDDqEDcWsJGjswT` | 2500bps | 21.40 |
| 2 | `3oqJhhaCtJBHD2AyeCVZVCnmd5iZpRkNk1hq8LGJBQh2` | `HVupzcJCh4UwuaXRRqFPF65UZHbh5SUiSbjPJFEBoqYj` | `F4XiPfqkKroPY6ivB7uZQJ6eM24AuszkwpZa6PpCBZwM` | `qE5hC6C4Kd7fYZAWnYBS6m35QdK6nBXU65NxXfnBJEB` | 1875bps | 15.825 |

### Vault 4 — DeFi Alpha (admin + authority transfer pending)

| Param | Value |
| ----- | ----- |
| Live admin / authority | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` |
| Pending admin / authority | `DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike` |

| # | PDA | Strategy Authority | Token Account | Delegate | Weight | Allocated |
| - | --- | ------------------ | ------------- | -------- | ------ | --------- |
| 0 | `9TKUTmftLVZSLDPCqhn5YTvBvdWevVKD5mYCASPMxuaS` | `FkuD3W3vrRvkhJW1JaMuhQ14hN8FLMs7MdVWWRt9FwaE` | `9H625kDDRn1TciA1mEEunuGjXA2em8K4bu17o1TnJKJi` | `HVqVW1hJbz9kf3uKMFqAx3um9JuTNZugMXxX3M4GT2Ry` | 2500bps | 33.30 |
| 1 | `ewhRZYUd29XQuVGvuqBnVpLLieCDhdXtAtUdCkLt87A` | `3Gyw84eRzrkavo1kUo9ZZYCH9DFodZY7XBwTbuoWTi8J` | `5m5dbP7d4qczgiqig6qZLjn5UhRuMtyKGu9vzkn3Dtdo` | `CRszpziSiF8MTv4Sa2CpUg4oj5u5vj2nK7FphNmPjWuz` | 2083bps | 29.50 |
| 2 | `2caG3L2y5HeRtX1RH5mL1DZDQ4BbRE4pp42J5AJQCd8N` | `95zYV2Vq8c6fwjQUXocFSXJVBTuzu1tdLfowGANhNnjT` | `EjPRBLdzc3fJc6T9h369kH9GBuRtwYkmfhqLhz2RhNcq` | `HKJLQLtNxdGDocG5GXQtbYwuwUypBtnWpn7yKVvmsDQV` | 1666bps | 21.40 |

## Devnet Vault Instances (round 6 — orphaned by 2026-05-02 redeploy under fresh program IDs)

The five round-6 vaults below were created on 2026-05-01 against the
old `my_project` program (`B7EUo8…`, since closed). The new program at
`FuAJhy…` does not own the round-6 `VaultState` PDAs even though the
old PDA addresses still exist on-chain under a closed program. None of
the round-6 vaults are reachable from any current frontend / agent
binary; treat as historical only.

Round-6 mint: `GhE6BWCzx1EZjP36oK34Y4S57FGfLx2y4GEZSVXUQggc`. The
deployer wallet (`4wrBiaN…`) was the live admin/authority on vaults 0–3
and holds the pending pubkey on vault 4 (`DhCAaTtz…`).

**Performance fee**: every vault initialises at the program default of 500 bps (5%).
Admin can change per-vault via `set_performance_fee_bps`, capped at 2000 bps.

### Vault 0 — AT trader agent

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `0`                                                                                             |
| Vault PDA        | `EhCSC7mUL9nMWeoFzz4uU7SAbTpyqG87oqNCsszcnNnn`                                                  |
| Vault Authority  | `TDqBpjsG3JD16RdfadbNpGZA9g62CVN161F7qyBbJSJ`                                                   |
| Share Mint       | `7PNBvoQsbxXVm3ZzFDn1Cqk2dsJiMfoAVLxCzwrZkDF8`                                                  |
| Reserve ATA      | `BgHXLJ41xaPXq7pQq2VsezME8q4UtPvgDQNkf6pqN6HC`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `105.76 USDC` (100 deposited + 5.76 simulated yield)                                            |
| Active Wt Sum    | `5500 bps`                                                                                      |
| Strategies       | `4`                                                                                             |

#### Vault 0 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `HqeLCVvjNRNggU38VwGU2WPcApKemX6p2aFMoFyQ9F5c` | `RDeYb5fzUWtGF5zweEL4M4QQ9f6r1Kkn25RB2KZ8tyw`  | `CvGF6huXafoHGmDCQWK59T6MYByxpCPkpo2JkrPE44WG` | `EDDPGWcnKxhcg9CLdyfLAXgAvFmBFbGzAHrq6pUGXmD`  | 2000bps | 21.00     |
| 1  | `5w9LUFasbdLr5wAsfcq9mogdCCSFda76qu4vVS6E7yqo` | `GC5DLAphFzsnkWSqPrTw39vaVoF8noxUZGKqiyzQ2DuY` | `33auK91XFFzA1uyuFW6SGHdowp8kuZGWuPTEfSAapgiM` | `AcsB4fgpaLkBvvjMWgqLgfHHGRzKTRtnEpdfb9b3ko53` | 1500bps | 16.20     |
| 2  | `6YL2Qxxwm1t61rmjope8c9K8QPtxjr2mMZT1w2uhpyA8` | `3LDQSH5DyRn2mCQkoXefj39W7G4P4MqWRnuNtU7ZcxSR` | `9fTjCVCdp56oqHQUuEhqdHckL2Ls6cY6HCX3A3WybQ4w` | `7pckKZGYgj7uWqExMrmJPYVVnNyiU69bBk6mfpowT1pk` | 1200bps | 13.80     |
| 3  | `4UZgnJV4XHwEUYfUzD8nVkGpB5ZqxsPL4vuee5t4DB2e` | `9hHFBdme22jA2Uty9jjaRykeiJwCCefV6TX7USqfBYeT` | `4K9GBQ5GRdSknbVky4LTPbG6dXhYLUWTJimoVFszMLvP` | `4UJmQbrdXAVa2yArXVSvk5u2arVWwgEyyBvf3wWEr9v4` | 800bps  | 9.76      |

### Vault 1 — Conservative

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `1`                                                                                             |
| Vault PDA        | `hE1pptxkAGvJevf7NY2ixKgHHQfADEz6aoZ2ZY3QBSX`                                                   |
| Vault Authority  | `6wGwffnFU1J5q8xDzCaSSRCMCEFoRdNUT75eySfRRaJM`                                                  |
| Share Mint       | `5BpMPrnpcn5tFPsh9WMk8c5KxUPrLNVf82vnZ8952azf`                                                  |
| Reserve ATA      | `M2rRSp7Qw5tp2DfUC1eKEk437r3AJFK4byrGELpjZuQ`                                                   |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `51.02 USDC` (50 deposited + 1.02 simulated yield)                                              |
| Active Wt Sum    | `6000 bps`                                                                                      |
| Strategies       | `2`                                                                                             |

#### Vault 1 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `FKgs6m72XJYABBXLdKBp3eg9tncFHeQoqDdKuH1K3PeN` | `A27HREKo5myA1AHAhBFfrQQBKtw5BRaeCUgGroi29nNj` | `9DcbJ9umVSm1RbSpR5YJ1T66TRjA84SgfULJ8gTjzn4H` | `2whCpYzs7bKYshULwbyVYuTyycbp7GXb1mCSEmHTwnDn` | 3600bps | 18.54     |
| 1  | `B4Vn5qXJAMNhyEptNFUPmqsoAh6ytEqf3Lrc8ixpa4Dy` | `B7WfzSMGMyVdjhM42p1t17pgsmsA6BrggmxHCyyqQs54` | `GipVsZZ7BphakG76okdY7sGPro4e7AcwMcf5kRyz3foX` | `Zpoip3u6noPXkuRa6aS6xEtk5j7V9eDRGLwxsdxtYBP`  | 2400bps | 12.48     |

### Vault 2 — Aggressive Vault

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `2`                                                                                             |
| Vault PDA        | `37YsPFcvhCauRovsidePXM4jQjjf3kAW6vazn7D8aneE`                                                  |
| Vault Authority  | `6qyhhG7SVSniNzCf4YDexqZgGAbsC2fP3B4MYyKqym1f`                                                  |
| Share Mint       | `3EmG9PKrubdrGnaBjkDyKm5fHKpgUJz43PG9FJJbZkh5`                                                  |
| Reserve ATA      | `2jm8CX2sa9HMYi4SkjXDcmneuxAYDacyyJtijpZBTgbr`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `228.35 USDC` (200 deposited + 28.35 simulated yield)                                           |
| Active Wt Sum    | `7500 bps`                                                                                      |
| Strategies       | `5`                                                                                             |

#### Vault 2 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `7H59e5dPeHVN4E1MCdWGmtnaF94rQhGeGtn33YkogLdu` | `75PdE7ZWVUBgqUxZkMVfdQLLqD26t9QXuRYNousNv1Ej` | `HywDijsgvqqc4iJx3z3M5rM1Fa5kscZbpU5b3NFN3Vbv` | `BWH9ub5ZZswoF7uXDftPyq9gYLVTHigSpwXfhMCyRXo4` | 2000bps | 44.80     |
| 1  | `H2PTcajmRMhSrWVRTySx69e7ZveE3SVBXK6iM5YX9akc` | `HphgJac7d5hrW2dE2QWkK1yTufnVCnrzRjmQBC3JdEsA` | `RffowGxqVbMXx4PkPWrwJgKxEK3r68TvZ84awiG1pfK`  | `BXhwj32r3YChVnBNqKWZnaPybQQvEhZJiK8rvpFKPbGf` | 1750bps | 41.30     |
| 2  | `5Y4sGobj8NhSMtdfbb9Npbbp2XacXnUBLhW9j7wKZTzo` | `E8vN34jS9oRuodkkKMfKfQDjLfpASjMZGc4kZQvcna2L` | `HAvNZ98Uh3P5TgMbyhjLXZCxyYQE5bEMz3cnKds1CfFZ` | `MdWbsvaeh1keu8PA1CXZ6Z76pYcKQCT3eP1YmyzRrdC`  | 1500bps | 37.50     |
| 3  | `GTNrs1tyFxD2LwroXgfQQMzZqzNtuubM37U48fiNwbJM` | `9v62GFZk2efK3osaL48NmwPhMTaoeNDQCQbFZXDvuncW` | `8bBoGf35NC2oEqiUPze32TDD69oExYBuiDN8mfa39c3X` | `B8nuECcjhTbaQ1JJvUddUqJ4kUDxNv3NmmqCYJXiPWBX` | 1250bps | 28.75     |
| 4  | `5a443orYnT8SHb1aoFzxDJBhJCtN92Mr5ZkozZNmfiFt` | `3j9qq2abu5zpLkKRcBJ8w2V9UEdHbnPh1YqZksKbhKYQ` | `629m5cnGJKvbMXVhLcECeUNsEfgjRL1Sif4c2MEnPj6Y` | `6QMQZ2go9U1xm78iienbtfbhjb3U9eWapBbeN7c2h3f5` | 1000bps | 26.00     |

### Vault 3 — Stablecoin Yield

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `3`                                                                                             |
| Vault PDA        | `6RbwzzwZ7xPNvpsfdRHzidyuukCc6Jdsqwk7HntagnyB`                                                  |
| Vault Authority  | `C1u5yFcqxnc6PX6dWHE2V8F81redr3m5Y29urSumXv1V`                                                  |
| Share Mint       | `DSPiG7PiJ9ot2iQvHAcMsjAVSbm9487mNAGr2ZjpJRTo`                                                  |
| Reserve ATA      | `AoPMVXWbF6JU4Wxh2Wd4h5JXanD9AiEnWsJNgctutce4`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `83.725 USDC` (80 deposited + 3.725 simulated yield)                                            |
| Active Wt Sum    | `7500 bps`                                                                                      |
| Strategies       | `3`                                                                                             |

#### Vault 3 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `9iLhhTWzu61jRWk38sKiGL5hGuqksjEYHwVXKvTs9J4f` | `G4FmJQnsymyfF5DHqZNBTYezztJH3B5o4DV5LUzr513C` | `6GUcbFJxZv6uhACbYNGsqApreQaWLofWwASLzkfY4vpU` | `2c3J6aLCjSZxcum2CPxLixznEUPxJsepMPmvyuNo6yd6` | 3125bps | 26.50     |
| 1  | `AzYi3MZSfaCppG5L37xbvhSCY3AcAXzYozbYmDUnhoDY` | `8UFAwL8arQVH5L9WCJaGGhfVqvXWznZqrVBGaNTx8hyz` | `8y6z95tadBj3mMZwF3deh2MLitCCFoVRLtCqECUwGb8u` | `9ebPH7W4n6H2WE6s6t4YLpiGES6fErXvbLFeqC83Ziej` | 2500bps | 21.40     |
| 2  | `8nDs4cMR9TB8Lsy6H24wmd5VEfEQq8oiKyYPNoWsx9N1` | `HPzd4PZWSa7sHWhnvfjYykSyk8woWkejFHCzmomhxFEL` | `AeCoxNW6X3bDREPKgmvwFC16Bu1nPJvVg2aFjFdF5Rmd` | `AZUn8Q4mt4PKbzY4oTz1JiSFqyVFpHibzJC3uRQ2uhYK` | 1875bps | 15.825    |

### Vault 4 — DeFi Alpha (admin + authority transfer **pending**)

| Param             | Value                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID          | `4`                                                                                             |
| Vault PDA         | `4U5YYV12XoZmfKZugRiNp9GC4vHoMo5YD5eixQjdeN3x`                                                  |
| Vault Authority   | `5FTNvYEEXHVQcyRdSfLXiY23ee6h3VsXR7VsAnzmy4cD`                                                  |
| Share Mint        | `BoBBYz5muWAbQ65fJWHyAwbubjskvqfjCVGEP369J6kx`                                                  |
| Reserve ATA       | `6qYpE6S7Y9DWry3MUhWjvdNHk9GRxsMMkkvkKqD9js88`                                                  |
| Admin (live)      | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (transfer pending)                               |
| Pending Admin     | `DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike` ⭐                                              |
| Authority (live)  | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (transfer pending)                               |
| Pending Authority | `DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike` ⭐                                              |
| Performance Fee   | `500 bps (5.00%)`                                                                               |
| Total Deposited   | `129.20 USDC` (120 deposited + 9.20 simulated yield)                                            |
| Active Wt Sum     | `6249 bps`                                                                                      |
| Strategies        | `3`                                                                                             |
| propose_authority | `MMB3DZdWcPHSM7sPJssHm7Z93fusyQNvi3baZMancnoj1saxEYSbJAYn6V4TSoVAbY3L8EMeVSW5Uc6yKjRXd5V`       |
| propose_admin     | `3qqVUjFF2HtwPobKnDLdZnhMbxyve8RSj3tQnjfabqQhrPDA6jfCWMGwnxS2xRFbuWqa3aw5HpRPFqDYnDgZCG6s`     |

> The `DhCAaTtz…` recipient must call `accept_admin` and `accept_authority`
> from their own keypair to finalise. Until then admin and authority
> remain `4wrBiaN…` on this vault. The frontend's
> [AdminTransferFlow](app/src/components/admin/AdminTransferFlow.tsx)
> surfaces an "Accept" button when the connected wallet matches a
> pending pubkey.

#### Vault 4 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `GbL56t7MzvgbNGsDfEBaFm2foJNynQHDGTDEoPvxqwdP` | `DdwYMQFNVKvqiL4Md4VzTYi16SoBQkMo79wPS6Fo7tFs` | `E4zekxZ1aG8HJmJHbYV8cqTXGrhVj8YGfMmZezGMngNi` | `HRX8c1Lc2AUym9pfG4jLNjfmK8JFHBY78x9KztGA3QYn` | 2500bps | 33.30     |
| 1  | `DbLKctB61zWLJd8AcQCL9QN4nRFCHT1bHZHXSJbkPseq` | `T29cguxH5gY9SvWBznKnFzy5SznAANMrxCusZP9kQhu`  | `5Y2hZPGsj8nw5n6XzYxksoE3QrZ8LxDNauTsEaRGfRsr` | `Ca32jPVZRNno1brYXiinK31JKpu6T1t7L9Q3Zfi9WDYh` | 2083bps | 29.50     |
| 2  | `HPp9B5XCYuPrsBemzLNu7FVRXviHuNtfLpX6H7wCW87T` | `31m6EpVyeEkEfeGqFqyQRpGtnWEVkFycXozMnk6hsk3Z` | `2ehW3aLP5x34ffJUKMM779ecyvHZaeSdsAKmSTGzPS1J` | `E8KumQA3BD5a2qTEUGafvrpzAsuFyriz98j7bMU9w4CS` | 1666bps | 21.40     |

## Devnet Vault Instances (round 5 — orphaned by 2026-04-30 path-B port redeploy)

> **Status.** The five vaults below were initialised against the
> Phase-3/4 program and the round-5 USDC mint
> `5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N`. The 2026-05-01
> setup-multi-vaults run replaced them with round-6 (mint
> `GhE6BWCzx1EZjP36oK34Y4S57FGfLx2y4GEZSVXUQggc`) — see the section
> above. The PDAs in this section are no longer reachable from the
> dashboard.

All five vaults share the test token mint
`5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N` and were initialised by
[scripts/setup-multi-vaults.ts](scripts/setup-multi-vaults.ts) against
the freshly upgraded program. Each vault now has both a `vault_state`
config PDA *and* a derived `vault_authority` signer PDA; the reserve
ATA is owned by the `vault_authority`, not by `vault_state`.

DeFi Alpha (vault 4) has admin + authority **proposed** to
`8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv` via
[scripts/transfer-vault-admin.ts](scripts/transfer-vault-admin.ts) — the
recipient must call `accept_admin` and `accept_authority` from their
own keypair to finalise. Until then, `4wrBiaN…` remains the live admin
and authority on vault 4 too. The deployer wallet (`4wrBiaN…`) holds
admin + authority on vaults 0–3 outright.

**Performance fee**: every vault initialises at the program default of 500 bps (5%).
Admin can change per-vault via `set_performance_fee_bps`, capped at 2000 bps.

### Vault 0 — AT trader agent

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `0`                                                                                             |
| Vault PDA        | `FPC9KaAfDknXyNeLvbk9eAhLzZNqgP7YwncXzAx3Ne5P`                                                  |
| Vault Authority  | `7G7HojQDPK3RfiMgiyA1TGPrbArXomwuiuacPP3DmPAR`                                                  |
| Share Mint       | `G6ntTzWfvURyd6d2uSZC36V9iB3aD2qtDBrkC9oCoav`                                                   |
| Reserve ATA      | `BYKmzhf1ougbSD6MJBdxzwW64uboV4HzRYUQJUV6G8rJ`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `105.76 USDC` (100 deposited + 5.76 simulated yield)                                            |
| Active Wt Sum    | `5500 bps`                                                                                      |
| Strategies       | `4`                                                                                             |

#### Vault 0 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `GufR3h8bXvZXa6WRitsfiuxYXSQCQP82GN3nRce4FueT` | `DnfDkmzzHktHoVQ82Wi3xkjRUVfZXXVYuFE3dng2Ejx6` | `E7w2rWVhFWoRFMbhF3TDqE2VsW7HBXuMysCktkJD2aiK` | `GsKU8mSxxY84fVtL4MgwfothYSFCBiyvD4Si4w4Y9nmd` | 2000bps | 21.00     |
| 1  | `Gd8AwoZ46caoew1yekU5edxgZmJTzbXXPRty1zYRkNVX` | `2canY8vk76eV5aitvkopHkVXUD4zdZqjZfQEomx2KyUr` | `HkYAJursY4LurJuceQy67jpsjiW28WpQXeDx3oD7pJ8F` | `9fvPeVtyLLfuXvLbQZaLwRm7oWEkGrEM2TrdQFzQkrCH` | 1500bps | 16.20     |
| 2  | `2GJ2z6vSMH6sxqx2kumT2AyeMrRPBA5jCsvrKdaWbDCV` | `5N3pZsdbzqLtYS5WfTsHCwaJD2hwzd75ohaDmocSHr34` | `FZycaSgPyUMQ2WQvpTDfnjk1cRndJzj49HtCvea9B7YJ` | `8txufZzyZhTuvsZXCukHJVwYvatB7EQiuVoxJQBtHw5U` | 1200bps | 13.80     |
| 3  | `6JyuCSenrYmAVk9JTmupGQPdBCLkpdndqyW4KL9Wtote` | `4tT5unPB8KNKjLNFZu2D1WN7x63SiyshbR9SUaasz3dJ` | `CJQCuLxc4QWc9JkBoGJvhEzxKq3X4eDusm4n9NcRdkBh` | `A1xXqBKusDw3LZqBAdVnMheot4HRcHVRZAB2VV95khGe` | 800bps  | 9.76      |

### Vault 1 — Conservative

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `1`                                                                                             |
| Vault PDA        | `BxExd9JrrwtXVwEBTEFVzrDsiUweraPiRWMxHZGWSEiA`                                                  |
| Vault Authority  | `J4ujfvjPEsocebJ56kEFv7SPans1LHvBBL9kVycTs7Cm`                                                  |
| Share Mint       | `ErxoMWJd9Pws8CySwBracR19dD2QHyDnGtEpgFaTT41r`                                                  |
| Reserve ATA      | `83N28kvAe6Rmc3dkJHvCh9F9JBUC4miBmbWTrJzHbJZ3`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `51.02 USDC` (50 deposited + 1.02 simulated yield)                                              |
| Active Wt Sum    | `6000 bps`                                                                                      |
| Strategies       | `2`                                                                                             |

#### Vault 1 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `FRPvNrUBYJ3EBniDUyP9XkwYpLeipxW1KeoYU3zqrcdQ` | `C4jFb99wEox9CBW8pVj38Ptrp3S351AjNmbo3YJcsZNa` | `3W6aueXJ5P8DrhrfsWP7xhwtC9CSZQP39AAK1aPD9bVL` | `4pnSxMgNzia4XzsErMQvmYJHszQC6iTq8f41S6REMd7N` | 3600bps | 18.54     |
| 1  | `5WjJiV165k7dmJFXywjLKm4HsUrWFgSYZjbhq228trkL` | `8Y8XhtQtt9AxiUBHpZCnBYtxMKBzcUDoodMxoaudfEFQ` | `3tZiXMBnsc3FgWh25DcfMH1n6fyGYsa7aSoTTrpz2rcF` | `EQBqzyoqsRbRKu7RJKTyTHMDh95u314YB1CxkiuzcL6x` | 2400bps | 12.48     |

### Vault 2 — Aggressive Vault

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `2`                                                                                             |
| Vault PDA        | `DhtxUXLPoiqce27kFULGNCh7aYPeUGMD7kzgj3eX1KVA`                                                  |
| Vault Authority  | `9KjD4NVVcVzgTDPckjtEN82L5TzVVEFnkYmg7xxLzsME`                                                  |
| Share Mint       | `AiQ8FjubciVhaMheaVG7zZryhHFPneKGZC6rsqWHPmjW`                                                  |
| Reserve ATA      | `D1NsiE7TGXBJwKcjN2DEgGpRavebjVUPSeG1tgmCJmjY`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `228.35 USDC` (200 deposited + 28.35 simulated yield)                                           |
| Active Wt Sum    | `7500 bps`                                                                                      |
| Strategies       | `5`                                                                                             |

#### Vault 2 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `7wotrusN3ZHNfm63iewGAZqiqq5T741Y456MVzzWt3eA` | `9D8XQVVwytf8KX9ajXWTceDTFq1vDpV8Au5teukMykku` | `nvLBNNX64ZDWkEk9oP2FXbw13sq7BJkhkghYSytXoxU`  | `FXD92MmMVxRVe43NY4VQat2mqGo3ZLHnvxMYoC5iwvkG` | 2000bps | 44.80     |
| 1  | `AhAFt1jBmYQHBTGuKvLztunxKVSMhyRdyTRqqsdoUS1t` | `EMHJVi4baojAJkakzPjeRDrRvkUw7SdT4VBcfK7BGaTr` | `DnB7ZE2GPYNsg7msSLW69M36288gwaxj4TUHMrPvDHec` | `EpeSdgPgsQHRW37U9HLtEAqJBvX6FaSV8Jg8Zt8CuDPb` | 1750bps | 41.30     |
| 2  | `Fh1gjcHZkxkRpKYbCipbbSsnETDtdWiCmQuarsEFQ8Lm` | `dRi9N4rRhbnF4ZCudXYLKx2kw2542gTHNiQHZTJm5wY`  | `2GYBvKhtuHeLMaBtyxNUx1qqNRPQZPqC6EMdXKZHKNhD` | `GFYJokv3mPKvxDMa7TKDWA9GvWXQMhLtqa2Xb3bhihY5` | 1500bps | 37.50     |
| 3  | `6qWMKiVJ8yYtgXkfkXasLf7ToauksVk6wrMgRPLSsfUd` | `AN5qdrLDUt9yMDoUrrFX4ChkbNBEYYg2sgCa9kH17jt9` | `FyQt1cDmCnpAJmUGYs2EDjYRNVwDzkye8gNLgMpCSRj8` | `FKBy7JiXzksBtLEkTN99a9ebzsvnkzMGGGtWSvPmDjav` | 1250bps | 28.75     |
| 4  | `EFTSL9dvFAq3qT7AByzVwJ6sV73KyAS1dbCEfDimSz32` | `GNJHhmA3xa3VQLnUaSgeh41ZUonHcJSyUu9N1NPMDxyy` | `GurYoxYLRtXNCCWaHmRsrsXwEz2tmWqHCxfXuK57PMnW` | `2FEajMuLGVMHUPCui4hsofis2o4Kh9Vj3wrKVjPCPZVQ` | 1000bps | 26.00     |

### Vault 3 — Stablecoin Yield

| Param            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID         | `3`                                                                                             |
| Vault PDA        | `HN4DVsVKe9hR9dSxZ3nz1usXiXo5b3Epg6meJp1qTZ4V`                                                  |
| Vault Authority  | `3jdoupuJp467F9fnm4xdRLCpT358Vg3yXEHBfd18YPHk`                                                  |
| Share Mint       | `GoDd6C92ZuQ9RBU5NFtvG24aDEwahmkbHHR8ariPBiPQ`                                                  |
| Reserve ATA      | `Gozdm3T7PtwruzmWFa8AVvN4MzAFnwPiG2XgghPTr2xn`                                                  |
| Admin            | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Authority        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                  |
| Performance Fee  | `500 bps (5.00%)`                                                                               |
| Total Deposited  | `83.725 USDC` (80 deposited + 3.725 simulated yield)                                            |
| Active Wt Sum    | `7500 bps`                                                                                      |
| Strategies       | `3`                                                                                             |

#### Vault 3 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `D3mRdKNwbqnBFDiM6M6S6uXMLamP8n2G2F7uBRmbUnxq` | `E8mq7cjTYocxLBBPgTx8Ti2jYags3Bvd96S1kCgwyPWC` | `H47YpoT3KxC9wtzvi16T7Wkupqgh87xdNtxmad59wb6G` | `8EkMVwYDLt2r3fPtzCvs18jjz8rzeWodWGfijyZnzLHJ` | 3125bps | 26.50     |
| 1  | `FHwBzhb9tbFE6zy8mxJ6dcGBcDH6ExrdSuejTGJmTV2w` | `FDotcedoPN39VmwL3KECWVj5pbu9Gkg7of7g95MGuFah` | `3XC2HSvvSek8E3ppmNd9SEfeBkZAqRzP8pfMJ9zsNzFj` | `5XUnTsZxVTCKsA6FYo3haBaa94E74W4AsiwA28dgHY8b` | 2500bps | 21.40     |
| 2  | `CHBZRVJHwr7kE6JjMesQSJ2Md8PrPrSxtikTBLLSz1Qu` | `Hfuunyws1CavpSpXkiuUyDH61rGHdkGSs33L1WiESnpM` | `3E9cYaoVetr8on8pNKJWSeU4eVEaYxsXmXdk5wid4S9T` | `G5ULDRB71VX75xWhEtShiCz2Sg72u1VP8m3vJspcnx9D` | 1875bps | 15.825    |

### Vault 4 — DeFi Alpha (admin + authority transfer **pending**)

| Param             | Value                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Vault ID          | `4`                                                                                             |
| Vault PDA         | `EAZxaw8UCwaHBD4ixP9LhHQvduyWcFwAnQ8pJicoeqgz`                                                  |
| Vault Authority   | `CPFDTVkcrMNnwHf4trP4XHHViPTvQB6QjtXjouA5HGJM`                                                  |
| Share Mint        | `3HmzPNLSh3Lh4MnwjbNM9vHtEiCXcFpgeFernwFy72yT`                                                  |
| Reserve ATA       | `8ykfqfjSs2ocXMbqEjp9ULWxvYHRRjo3mcLPkTRkeydv`                                                  |
| Admin (live)      | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (transfer pending)                               |
| Pending Admin     | `8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv` ⭐                                              |
| Authority (live)  | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (transfer pending)                               |
| Pending Authority | `8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv` ⭐                                              |
| Performance Fee   | `500 bps (5.00%)`                                                                               |
| Total Deposited   | `129.20 USDC` (120 deposited + 9.20 simulated yield)                                            |
| Active Wt Sum     | `6249 bps`                                                                                      |
| Strategies        | `3`                                                                                             |
| propose_authority | `uUmYT9Qmk9zm791sDfApmwRYPMxm5zBWHoz79ArKpzw5f8DGbGBak2fnwFpXyT8WmKEpVr1D6rPHSfK7urriowu`       |
| propose_admin     | `62trQtS9qEyDTJV6qp1J4PBLg44E6nKS9iEFQ2kqZSBRAdWstGaoHPFy5jrFjruJvACjdoqDAmQ1v44yAA1JUhBR`     |

> The `8qKt…` recipient must call `accept_admin` and `accept_authority`
> from their own keypair to finalise. Until then admin and authority
> remain `4wrBiaN…` on this vault. The frontend's
> [AdminTransferFlow](app/src/components/admin/AdminTransferFlow.tsx)
> surfaces an "Accept" button when the connected wallet matches a
> pending pubkey.

#### Vault 4 — Strategies

| #  | PDA                                            | Strategy Authority                             | Token Account                                  | Delegate                                       | Weight  | Allocated |
| -- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------- | --------- |
| 0  | `BBhauyMqa6G1f2aCtxwAPDfXrj1kEP1dv5jQyGrVhCvD` | `BtJDQJZ5o73tKP3ssV6JGSQg8bYte2ChTSJKA5C3Cyqg` | `3HRjpGEaygsDsu86wyCU958o4D6YGF65Txiade5oBVsN` | `AmabEB3FFTp34HAxpnhH6DnWaVD6yipzApgdU5fQWyB3` | 2500bps | 33.30     |
| 1  | `DDH8gLKNZ6uNU4DhVYZLBHXhQ1mUyoc2exjmLM3hVT9r` | `RJFhjPRnoCoxdmsLahUsjYG5vWtYF6LdhqYRUzEyQmm`  | `ADdKki36ek8iY2mVSZKcmybfUPiH7BBsr1uD61c1LHkT` | `6qyvKHsxrTkHLiarwz7JhyPGP2R4T7R9qrBJaEHJBRif` | 2083bps | 29.50     |
| 2  | `8Gaye7h4vGqaY3gLvJrBwEFvBSuFuqaJ8qoqpCkzFbod` | `3n8cwDavwBi7xfuKCPZ7zhzYk193Jb7Bqj3ykNeY9Bdx` | `6qYUosRDr5Bu6Ewo2X1zTT6pEqMfrqVCvPV74uBwDogJ` | `AJxUUntKkjPVv63bYmKhYMYFS9HJJKLZ2nxNfRCJ45QR` | 1666bps | 21.40     |

## Devnet Vault Instances (previous — orphaned)

Four previous mints exist on-chain. All are layout-incompatible with the
Phase-3 program — `vault_authority` ATAs were not created back then,
`StrategyAllocation.authority_bump` and `VaultState.pending_*` fields
are missing, and the reserve/strategy ATAs are owned by `vault_state`
rather than the new authority PDAs. None of these vaults will work
against the current binary; treat them as historical only.

### Round 4 — token mint `HgctyjCk…` (pre Phase-3 refactor)

| Vault ID | Name             | Vault PDA                                       |
| -------- | ---------------- | ----------------------------------------------- |
| 0        | AT trader agent  | `FZLnyXun7dTEZMXgymbD3GzKP7tnQmGo1zsfwqMgEJZK` |
| 1        | Conservative     | `HdGrUafBWTmdB7gNRJmiFDcx1Ggiwqu3245gwRrvfqv7` |
| 2        | Aggressive Vault | `CQAoCYwHsuQF2Gpvhtukz6cU6sBEu46GnP7oiacMsS9H` |
| 3        | Stablecoin Yield | `5KaLPjmgz2byRA2ubspdvw4174VJ8QNrRGra9BNGS8Ex` |
| 4        | DeFi Alpha       | `5N1x1UtYxBumZ8sppEtnLr58i87zMyUZx1pa9dHYEyoN` |

### Round 3 — token mint `J1qLR4P2…` (pre `performance_fee_bps`)

| Vault ID | Name             | Vault PDA                                       |
| -------- | ---------------- | ----------------------------------------------- |
| 0        | AT trader agent  | `FkBwLqji7nyPw31cwsCZjkJZsREtstVjSWT6g4J654f6` |
| 1        | Conservative     | `By69p2FCzhEuu83w3ohaMn1kiXakiG325aLnuQjVck33` |
| 2        | Aggressive Vault | `GsftPiLyhpN2Vg36qfJ7PLMbaL65ptwaxai5RmFfDauV` |
| 3        | Stablecoin Yield | `A2fMEbAic9knPkwJeAt9JKpHk3PjAzhaPtYZN1Qpzjis` |
| 4        | DeFi Alpha       | `BffnRVWtrbKbsDJNf1fMdoQ7L1xLSfP6zsVax2nDTDne` |

### Round 2 — token mint `BZwn5e9G…` (pre Phase-2 upgrade)

| Vault ID | Name             | Vault PDA                                       |
| -------- | ---------------- | ----------------------------------------------- |
| 0        | AT trader agent  | `5KLbcx1Nx5hfh1ifJuVZNek1ftJj7XdLgn9fqGzBecVo` |
| 1        | Conservative     | `F4Lv2URDLJVzueEHR5gZFSYruCSMYL3tUKGgACj8TG7Y` |
| 2        | Aggressive Vault | `6xEoJHozn2XUHY1LqKmTkK8bEiYRNmkpxXP9dAEpU2YW` |
| 3        | Stablecoin Yield | `DzMXyWphTbHAVVpZvT7zh29a9ZgSRFKmkuP4cF3A6fk4` |
| 4        | DeFi Alpha       | `GytTobRsp6JVfEX6RenukZDT1L2as3MqMWUhUgZJeY8m` |

### Round 1 — token mint `45AbULTJ…` (pre Phase-1 upgrade — layout-incompatible)

| Vault ID | Name             | Vault PDA                                       |
| -------- | ---------------- | ----------------------------------------------- |
| 0        | Erebor           | `8L3UciW6sNQtBDWevUcmhRnt5JKjPc8ggAKrBeE8g2qz` |
| 1        | Conservative     | `EHx7udmvUEn55Sduskw3M6GuBnAwbe51SdWsgQFkirCR` |
| 2        | Aggressive Vault | `Gk3kNYdehLBWiQt6r3enE9VjMTHAUzr2LMYzBwog6T89` |
| 3        | Stablecoin Yield | `7D64M8RVE47GFbqQUC6arZ1NriTngju6oJioNtEA94Nz` |
| 4        | DeFi Alpha       | `4TKfe8fvjJ1zi4vubVncharyaqAkvZUGoYGEGCtZoGpJ` |

## Mainnet Deployment

Not yet deployed.

## PDA Derivation Seeds

All vault accounts are deterministic — derived from the program ID + seeds below.

| Account                | Seeds                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| Vault State            | `["vault", token_mint, vault_id (u64 LE)]`                                     |
| Vault Authority        | `["vault_authority", vault_state]`                                             |
| Strategy Authority     | `["strategy_authority", vault_state, strategy_id (u64 LE)]`                    |
| Share Mint             | `["shares", vault_state]`                                                      |
| Reserve ATA            | ATA of `(vault_authority, token_mint)` — owner is `vault_authority`, not `vault_state` |
| Strategy               | `["strategy", vault_state, strategy_id (u64 LE)]`                              |
| Strategy Token Account | `["strategy_token", vault_state, strategy_id (u64 LE)]`                        |
| AllowedAction          | `["allowed_action", strategy, target_program, discriminator (8 bytes)]`        |
| AllowedToken           | `["allowed_token", mint]`                                                      |
| ProtocolConfig         | `["protocol_config"]` (singleton)                                              |

## Key Files

| File                                    | Description                           |
| --------------------------------------- | ------------------------------------- |
| `id.json`                               | Deploy wallet keypair (DO NOT commit) |
| `target/deploy/my_project-keypair.json` | Program keypair                       |
| `target/deploy/my_project.so`           | Compiled program binary               |
| `target/idl/my_project.json`            | IDL (interface definition)            |
| `programs/my_project/src/lib.rs`        | Program source (`declare_id!`)        |
| `app/src/lib/actionPresets.ts`          | Curated catalog of allowed-action presets (Kamino, Marginfi, Drift, Solend, Lulo, Jupiter, Raydium) |

## Commands

```bash
# Check program on-chain
solana program show FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo --url devnet

# Check wallet balance
solana balance -k ./id.json --url devnet

# Build + upgrade
PATH="$HOME/.cargo/bin:$PATH" anchor build
solana program extend FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo 100000 --url devnet
anchor upgrade target/deploy/my_project.so \
  --program-id FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo \
  --provider.cluster devnet

# Initialise a single vault for a token mint
bun scripts/init-vault.ts --cluster devnet --mint <TOKEN_MINT_ADDRESS>

# Mint a fresh test token + init 5 vaults + 17 strategies
bun scripts/setup-multi-vaults.ts

# Re-print this DEPLOYMENT.md table from on-chain state
bun scripts/dump-deployment.ts

# Transfer admin + authority of a single vault to another wallet
bun scripts/transfer-vault-admin.ts

# Verify on-chain binary matches local build
solana program dump FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo on-chain.so --url devnet
sha256sum on-chain.so target/deploy/my_project.so
```
