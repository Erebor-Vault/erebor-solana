# Deployment Info

## Programs (devnet, current)

| Program       | Program ID                                        | Notes                                  |
| ------------- | ------------------------------------------------- | -------------------------------------- |
| `my_project`  | `B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z`    | Vault. Anchor 0.32.1, Rust 1.89.0      |
| `mock_kamino` | `S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK`    | cToken model + obligations/borrow/repay |
| `mock_lulo`   | `3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm`    | Treasury + per-strategy ProtocolPosition |

| Stale program ID                                | Replaced by                                       |
| ----------------------------------------------- | ------------------------------------------------- |
| `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B` | `B7EUo8…`  — OLD_Erebor's source `declare_id!`, never deployed; `anchor keys sync` rotated to the existing devnet ID |
| `HLDVeTCx7mJeHApCpDptwbHd78iLCPYrFnVAymjrANp2` | `S4taBh…`  — OLD_Erebor's source `declare_id!` for mock_kamino, never deployed |

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

The 5 vaults in `app/src/lib/constants.ts` (round-5 USDC mint
`5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N`) likely have orphaned
strategies + AllowedActions on-chain.

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
| Test Token Mint  | `5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N` (6 dp, mint authority = wallet)                |
| Explorer         | https://explorer.solana.com/address/DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B?cluster=devnet |

### ProtocolConfig (Phase-4a)

Singleton PDA at seeds `["protocol_config"]`. Carves a constant 2 % cut
from every withdrawal's performance fee, routed to `treasury`'s underlying
ATA. The remainder of `vault.performance_fee_bps − protocol_fee_bps`
goes to the vault admin (curator). Reinitialise via
[scripts/init-protocol-config.ts](scripts/init-protocol-config.ts).

| Param             | Value                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| ProtocolConfig PDA| `FBLN6W67RHM84iHJLgGGBmwCmNaFhGjaz24yM6Ni1pPT`                                                |
| Governance        | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                |
| Treasury          | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` (deployer wallet, rotatable via `set_treasury`) |
| protocol_fee_bps  | `200` (2 %)                                                                                    |
| Init tx           | `5YYjwBEu5oAcLo7YA6VUy3mKTZHWRCT33dvnwrpntoCu6CazXnyc7yyX9hjUYczBwUddu9u32B6XvE5kLP3E9TA5`     |

## Devnet Vault Instances (current — Phase-3, round 5)

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
| Share Mint             | `["shares", vault_state]`                                                      |
| Reserve ATA            | ATA of `(vault_state, token_mint)`                                             |
| Strategy               | `["strategy", vault_state, strategy_id (u64 LE)]`                              |
| Strategy Token Account | `["strategy_token", vault_state, strategy_id (u64 LE)]`                        |
| AllowedAction          | `["allowed_action", strategy, target_program, discriminator (8 bytes)]`        |

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
solana program show DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B --url devnet

# Check wallet balance
solana balance -k ./id.json --url devnet

# Build + upgrade
PATH="$HOME/.cargo/bin:$PATH" anchor build
solana program extend DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B 100000 --url devnet
anchor upgrade target/deploy/my_project.so \
  --program-id DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B \
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
solana program dump DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B on-chain.so --url devnet
sha256sum on-chain.so target/deploy/my_project.so
```
