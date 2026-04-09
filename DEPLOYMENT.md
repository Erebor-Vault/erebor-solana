# Deployment Info

## Programs (Devnet)

| Program        | Program ID                                     | IDL Account                                    |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| `my_project`   | `B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z` | `FAf4W4hYgddkZsb7HYis7cDjWswT6T7rvrhiNau6RGpq` |
| `mock_lulo`    | `3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm` | `3B36KpZCncdwvxrdM8BJDh1a3T2d4op4P1BtXpYTyRLf` |
| `mock_kamino`  | `S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK` | `62eKv1mCJt2k1pzFoduKj7Yz7ntsLprtsm2zENe3B25E` |

| Param             | Value                                          |
| ----------------- | ---------------------------------------------- |
| Upgrade Authority | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` |
| Anchor Version    | `0.32.1`                                       |
| Rust Toolchain    | `1.89.0`                                       |

## Devnet Deploy Transactions

| Program        | Latest Deploy Tx                                                                       |
| -------------- | -------------------------------------------------------------------------------------- |
| `my_project`   | `Bb8ju5h1RoopydAV5q8LTtiBmtYsuWU8yF1M78FDmbtLUPpweS928e9uNw1AsHMHNniphvXNVeTZq7BqCavZmhQ` |
| `mock_lulo`    | `2444xMHTP19uEuXqx95unX1J19UiRvjYqWkUwHmTpEa9MgoejctTwq8eMp6PPiobTqf2d1itgMN8iwKc5mjhgu4m` |
| `mock_kamino`  | `5sgrLinPAAJCyZqwdPguXx45kMLnTUHGWcyyeUt8fmrXqH4hKGgJNEoDheXWhcYd6a9EnDFmmKzkpsPvHTAds7cK` (upgrade — added ProtocolPosition adapter) |

## Explorer Links

- [my_project](https://explorer.solana.com/address/B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z?cluster=devnet)
- [mock_lulo](https://explorer.solana.com/address/3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm?cluster=devnet)
- [mock_kamino](https://explorer.solana.com/address/S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK?cluster=devnet)

## Stale / Closed Programs

> **Closed on devnet (2026-04-09)** — rent reclaimed, IDs burned forever:
> - `6GsfdifntcFRQjFjCxsn3KszKd3fucPe5DMrwSpWRPpw` (old `my_project`) — 3.69 SOL reclaimed
> - `ENccKNWkndfdG16WQY3xchEKGoF3MwXqF5SWueesThXE` (old `mock_lulo`) — 1.76 SOL reclaimed
> - `43FrWWHc13Fp4rsnb3XjDV5dfmWWoyLNzdSe1pqkLxn7` (`mock_jupiter`) — 2.15 SOL reclaimed
>   Closed because swaps are not used by any agent yet (hedges/rewards are
>   [TODO.md](agent/kamino_looper/TODO.md) deferred features). Must be redeployed
>   with a **new** keypair/program ID when hedges are implemented.
>
> All vault/strategy/obligation state from burned deployments is orphaned and
> must be re-initialized against the new program IDs via the setup scripts.

## Devnet Vault Instances

_Pending re-initialization via `scripts/create-strategies.ts` and `scripts/setup-kamino-strategy.ts`._

## Mainnet Deployment

Not yet deployed.

## PDA Derivation Seeds

All vault accounts are deterministic — derived from the program ID + seeds below.

| Account                | Seeds                                                   |
| ---------------------- | ------------------------------------------------------- |
| Vault State            | `["vault", token_mint, vault_id (u64 LE)]`              |
| Share Mint             | `["shares", vault_state]`                               |
| Reserve ATA            | ATA of `(vault_state, token_mint)`                      |
| Strategy               | `["strategy", vault_state, strategy_id (u64 LE)]`       |
| Strategy Token Account | `["strategy_token", vault_state, strategy_id (u64 LE)]` |

## Key Files

| File                                    | Description                           |
| --------------------------------------- | ------------------------------------- |
| `id.json`                               | Deploy wallet keypair (DO NOT commit) |
| `target/deploy/*-keypair.json`          | Program keypairs (DO NOT commit)      |
| `target/deploy/*.so`                    | Compiled program binaries             |
| `target/idl/*.json`                     | IDLs (interface definitions)          |
| `programs/*/src/lib.rs`                 | Program sources (`declare_id!`)       |

## Commands

```bash
# Check program on-chain
solana program show B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z --url devnet

# Check wallet balance
solana balance -k ./id.json --url devnet

# Deploy / upgrade a single program
anchor deploy --provider.cluster devnet --program-name my_project

# Recreate all on-chain state (vault, strategies, mints, oracles, obligations)
bun run scripts/create-strategies.ts        # Lulo side
bun run scripts/setup-kamino-strategy.ts    # Kamino side

# Verify binary hash
solana program dump B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z on-chain.so --url devnet
sha256sum on-chain.so target/deploy/my_project.so
```
