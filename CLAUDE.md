# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Solana program built with **Anchor 0.32.1** using Rust, with TypeScript tests via ts-mocha. Package manager is **bun**.

- Program ID: `6GsfdifntcFRQjFjCxsn3KszKd3fucPe5DMrwSpWRPpw`
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

- **`programs/my_project/src/lib.rs`** — Anchor program entry point (thin dispatcher).
- **`programs/my_project/src/state.rs`** — Account structs: VaultState, StrategyAllocation, AllowedAction.
- **`programs/my_project/src/errors.rs`** — VaultError enum.
- **`programs/my_project/src/instructions/`** — One file per instruction (handler + accounts struct).
- **`tests/`** — TypeScript integration tests using `@coral-xyz/anchor` client, Mocha, and Chai.
- **`target/types/`** — Auto-generated TypeScript IDL types (created by `anchor build`).
- **`app/`** — Next.js 16 frontend with React hooks for program interaction.
- **`agent/shared/`** — Shared agent code (types, vault-client PDA derivation).
- **`agent/lulo/`** — Lulo lending agent (Claude + execute_strategy_action).

## Key Patterns

- **Modular instructions**: each instruction lives in its own file under `instructions/`. Handler function + `#[derive(Accounts)]` struct co-located.
- **Action whitelisting**: strategies use per-strategy AllowedAction PDAs. Delegates call `execute_strategy_action` which validates against the whitelist and CPIs via `invoke_signed`.
- **Role model**: Admin (governance), Authority (operations), Delegate (action requester — no SPL spending authority).
- Anchor workspace pattern: tests access the program via `anchor.workspace.myProject`.
