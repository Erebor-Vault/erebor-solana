# Deployment Info

## Program

| Param | Value |
|-------|-------|
| Program ID | `4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik` |
| Upgrade Authority | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` |
| ProgramData Address | `2HuUPDJTisL1ML9sQSouqy6tyA8KZmALzKhDAg3gJoB4` |
| IDL Account | `7R5RVcWo5zQJDvftFaK5qJcFE3wbuJNwKgJkF8876FPd` |
| Anchor Version | `0.32.1` |
| Rust Toolchain | `1.89.0` |

## Devnet Deployment

| Param | Value |
|-------|-------|
| Cluster | `devnet` |
| RPC URL | `https://api.devnet.solana.com` |
| Deploy Slot | `450902152` |
| Deploy Tx | `3EdVN5ahwJmc2Xaf38MA5KZWxn46MW9T1Jjd8XQdLfrN9NzMmGjmQYhZX4JrFnawqSBgZgkpKHLgsYaaUL3kwUox` |
| Upgrade Tx | `4ATwQqBu7ezMXrbueApgPGEH5t3Uu1G97g1f1EBp2owBWmzHmWG4qd3Lz9fB3n6grRfPaCTyvJkPRNC4Si6UT8wo` |
| Explorer | https://explorer.solana.com/address/4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik?cluster=devnet |

## Devnet Vault Instance

| Param | Value |
|-------|-------|
| Token Mint | `6zrRz3TtZqfZuHmpzC5ZCVM99HoZ6wq6ptNN6d5nwTBR` |
| Vault PDA | `EjZqUvR8wYtdnUDW7MtWx5eW6ouLFMCXFJHjmDLw3Ltb` |
| Share Mint | `kvfAnTG7cJ9jJFmYcrgbr61nBTvqxZBticEeV8GUfJp` |
| Reserve ATA | `3YqAFdaz2bvayw3f3HVF9HqZZLFCNpCH3wwHuKVcC2Ke` |
| Vault Admin | `8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv` |
| Vault Authority | `8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv` |
| Tokens Minted | 1000 (6 decimals) |
| Strategies | 5 (75% allocated, 25% reserve) |
| Explorer | https://explorer.solana.com/address/EjZqUvR8wYtdnUDW7MtWx5eW6ouLFMCXFJHjmDLw3Ltb?cluster=devnet |

## Devnet Strategies (AI Agent Wallets)

| # | Name | Delegate (AI Agent Wallet) | Weight |
|---|------|---------------------------|--------|
| 0 | AI Lending Agent (Kamino) | `AX6XKgKnQ22cWAezZNo5zhb88Cdny86uwqsjjNegpoSu` | 25% |
| 1 | AI Yield Agent (Drift) | `GK9oD2anqDYkSVWheEtN77Y8MtbXVoPxYSWKow6v1Vtv` | 20% |
| 2 | AI LP Agent (Raydium) | `8L4fEQL2MR97yopfRqsTcp3zxYWBsab72aF8UYHjD5st` | 15% |
| 3 | AI Staking Agent (MarginFi) | `5xEy9F7xwB5eruRGj95FrYdsYSPETXAs4Rd6RCeB87SM` | 10% |
| 4 | AI Arbitrage Agent (Jupiter) | `EqW3Qmw7sKxNjTzNGjNooXX3jfWbKQ8mNnTFXP34kF66` | 5% |

### Strategy PDAs

| # | Strategy PDA | Token Account |
|---|--------------|---------------|
| 0 | `FRzX3Y3sgurtL7Drz4uUwwnDRjLpJWScFwjd6efcuXSG` | `HhQCMKQJzrtVnjA6Mbs4syAH6KQ1nTGZqyRiiMJs5Ewg` |
| 1 | `4nejigdVhxfEH92cAFesr8tAMPC4CdZNttmQYoSPeH2z` | `EHGhb8ZhvpKb31gcgScbppmDvDsnj2xann1sNRqvvbDY` |
| 2 | `Dr4QZKquzogPv3kvjuaCqDEGBpr9MiuBeQvGKgTqVgic` | `62iDQh2vDZni8FdrNqAngjCRPy5DBEfFJ9UWo1GTGDmR` |
| 3 | `Cqhjmvj17CzKzPFKSJdraN5NeYV8KDjczoQPjc41WVi7` | `2Ctf85a8xBGuGQDbKRm2fPBbS5uTbmZ5o3aowJQp6my3` |
| 4 | `CN83NjKAtxSBNU821XQ2TFKzkVkZSJbgK5yAJuYnWWvL` | `FnwtuWh7XU21quBAmYvaYV7u1sbXHbGPTE6y31qBeFWr` |

## Mainnet Deployment

Not yet deployed.

## PDA Derivation Seeds

All vault accounts are deterministic — derived from the program ID + seeds below.

| Account | Seeds |
|---------|-------|
| Vault State | `["vault", token_mint]` |
| Share Mint | `["shares", vault_state]` |
| Reserve ATA | ATA of `(vault_state, token_mint)` |
| Strategy | `["strategy", vault_state, strategy_id (u64 LE)]` |
| Strategy Token Account | `["strategy_token", vault_state, strategy_id (u64 LE)]` |

## Key Files

| File | Description |
|------|-------------|
| `id.json` | Deploy wallet keypair (DO NOT commit) |
| `target/deploy/my_project-keypair.json` | Program keypair |
| `target/deploy/my_project.so` | Compiled program binary |
| `target/idl/my_project.json` | IDL (interface definition) |
| `programs/my_project/src/lib.rs` | Program source (`declare_id!`) |

## Commands

```bash
# Check program on-chain
solana program show 4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik --url devnet -k ./id.json

# Check wallet balance
solana balance -k ./id.json --url devnet

# Deploy / upgrade
bun run deploy:devnet
bun run deploy:mainnet

# Initialize vault for a token mint
bunx ts-node scripts/init-vault.ts --cluster devnet --mint <TOKEN_MINT_ADDRESS>

# Mint tokens to a wallet, init vault, and transfer admin/authority
npx ts-mocha scripts/mint-to-wallet.ts

# Verify binary hash
solana program dump 4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik on-chain.so --url devnet -k ./id.json
sha256sum on-chain.so target/deploy/my_project.so
```
