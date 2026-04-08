# Deployment Info

## Program

| Param               | Value                                          |
| ------------------- | ---------------------------------------------- |
| Program ID          | `6GsfdifntcFRQjFjCxsn3KszKd3fucPe5DMrwSpWRPpw` |
| Upgrade Authority   | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` |
| IDL Account         | `J6C4UHKsHKPSQuztZsnkBhaZgwcLwjBKDN3wHTmHuWzP` |
| Mock Lulo Program   | `ENccKNWkndfdG16WQY3xchEKGoF3MwXqF5SWueesThXE` |
| Mock Lulo IDL       | `BpvQgGGr7QdGeaAygiZbJKSEMsFveBSXUy69jAmCP8ie` |
| Anchor Version      | `0.32.1`                                       |
| Rust Toolchain      | `1.89.0`                                       |

## Devnet Deployment

| Param       | Value                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Cluster     | `devnet`                                                                                        |
| RPC URL     | `https://api.devnet.solana.com`                                                                 |
| Deploy Tx   | `5G96dLciee8e9NQzFWwb2gmGvVNkyHNFCtXouZBut7i4LZGRX4NKqn8WHzhpofoFkbv7xWppWooVueWpRmGYYPpY`      |
| Mock Lulo Tx| `43haXYu1wejR4HjEFng7ix4zbiZ1tfBWvEQQh2NnAjURLCyeG3fRS6T5oTt6vZKLsYpt4UafZNTh48nCvPoPxbRJ`      |
| Explorer    | https://explorer.solana.com/address/6GsfdifntcFRQjFjCxsn3KszKd3fucPe5DMrwSpWRPpw?cluster=devnet |

## Devnet Vault Instances

> **Note:** Vaults from the previous deployment (program `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B`) are no longer valid.
> All vaults must be re-initialized against the new program ID.
>
> To initialize:
> ```bash
> bunx ts-node scripts/init-vault.ts --cluster devnet --mint <TOKEN_MINT_ADDRESS>
> ```

_Pending re-initialization._

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
| `target/deploy/my_project-keypair.json` | Program keypair                       |
| `target/deploy/my_project.so`           | Compiled program binary               |
| `target/idl/my_project.json`            | IDL (interface definition)            |
| `programs/my_project/src/lib.rs`        | Program source (`declare_id!`)        |

## Commands

```bash
# Check program on-chain
solana program show 6GsfdifntcFRQjFjCxsn3KszKd3fucPe5DMrwSpWRPpw --url devnet

# Check wallet balance
solana balance -k ./id.json --url devnet

# Deploy / upgrade
anchor deploy --provider.cluster devnet

# Initialize vault for a token mint
npx ts-node scripts/init-vault.ts --cluster devnet --mint <TOKEN_MINT_ADDRESS>

# Create vault and transfer admin
npx ts-node scripts/create-vault.ts

# Verify binary hash
solana program dump 6GsfdifntcFRQjFjCxsn3KszKd3fucPe5DMrwSpWRPpw on-chain.so --url devnet
sha256sum on-chain.so target/deploy/my_project.so
```
