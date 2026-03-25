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
| Explorer | https://explorer.solana.com/address/4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik?cluster=devnet |

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

# Verify binary hash
solana program dump 4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik on-chain.so --url devnet -k ./id.json
sha256sum on-chain.so target/deploy/my_project.so
```
