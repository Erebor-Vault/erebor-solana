# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Solana program built with **Anchor 0.32.1** using Rust, with TypeScript tests via ts-mocha. Package manager is **bun**.

- Program ID: `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B`
- Rust toolchain: `1.89.0`
- Cluster: `devnet` (configured in Anchor.toml)

## Common Commands

### Build
```bash
anchor build
```

### Test (requires local validator)
```bash
anchor test
```

### Run a single test
```bash
bunx ts-mocha -p ./tsconfig.json -t 1000000 "tests/my_project.ts"
```

### Lint
```bash
bun run lint          # check formatting
bun run lint:fix      # fix formatting
```

### Deploy (localnet)
```bash
anchor deploy
```

## Architecture

- **`programs/my_project/src/lib.rs`** — Anchor program entry point. Contains instruction handlers and account structs.
- **`tests/`** — TypeScript integration tests using `@coral-xyz/anchor` client, Mocha, and Chai. Tests run against a local validator.
- **`target/types/`** — Auto-generated TypeScript IDL types (created by `anchor build`). Imported by tests.
- **`migrations/deploy.ts`** — Anchor migration/deploy script.

## Key Patterns

- Anchor workspace pattern: tests access the program via `anchor.workspace.myProject` after setting the provider with `anchor.AnchorProvider.env()`.
- Account validation structs (e.g., `Initialize`) use `#[derive(Accounts)]` and are paired with instruction handlers in the `#[program]` module.
