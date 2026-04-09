# Erebor

**One vault to hold them all.**

Erebor is a non-custodial multi-strategy vault on Solana that lets AI agents manage yield on behalf of depositors. Users deposit USDC, receive tokenized share tokens, and a professional curator selects and monitors autonomous AI agents that earn yield across Solana DeFi — all through Solana's native SPL delegate mechanism.

Think of it as an ERC-4626-style vault designed specifically for AI agent strategies.

> Named after the legendary dwarven treasury under the Lonely Mountain — one impenetrable home for AI-managed capital.

**Live app:** https://ereborvault.netlify.app/

**Explorer:** [View on Solana Explorer](https://explorer.solana.com/address/B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z?cluster=devnet)

## The problem

AI agents that trade and lend in DeFi are fragmented. Each runs on a different platform, in its own wallet, with its own rules. If you want to use three agents, you need to independently research each one's audit status, code quality, track record, and wallet security — then manage three separate wallets with no portfolio-level view, no rebalancing, and no way to spread risk.

## How Erebor solves it

Erebor introduces a vault layer between users and AI agents. A professional curator (the admin) reviews and approves agents, creates strategy slots for each one, sets allocation weights, and monitors performance. Users simply deposit, receive shares, and withdraw — they never interact with agents directly.

The vault cannot prevent bad trades. But it limits the blast radius — max loss from a rogue agent equals only that strategy's allocation — enables diversification across multiple agents, and shifts the research burden from every individual user to one professional curator.

---

## How it works

```
User deposits USDC
      ↓
Vault mints proportional share tokens (SPL)
      ↓
Admin creates strategies, each delegated to an AI agent's keypair
      ↓
Admin sets target weights in basis points (e.g. 4000 = 40%)
      ↓
Authority calls rebalance_strategy → funds auto-distribute per weights
      ↓
Agents earn yield autonomously (lending via Lulo → Kamino, Drift, MarginFi)
      ↓
User burns shares to withdraw proportional assets + earned yield
```

Share tokens are standard SPL tokens — use them as collateral in lending protocols, LP in DEXs, or just hold. Value appreciates automatically as agents earn yield.

### Share math

```
First deposit:   shares = amount                              (1:1)
Subsequent:      shares = amount * total_shares / total_deposited
Withdrawal:      tokens = shares * total_deposited / total_shares
```

### Why multi-strategy?

On Solana, each SPL token account can only have **one delegate** at a time. To give N agents spending authority, Erebor creates N separate token accounts — one per strategy. The vault PDA owns all of them.

---

## Architecture

```
                    ┌──────────────────┐
                    │      Users       │
                    │ deposit/withdraw │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Vault State PDA │
                    │  admin, authority│
                    │  total_deposited │
                    │  strategy_count  │
                    └──┬─────┬─────┬───┘
                       │     │     │
              ┌────────┘     │     └────────┐
              │              │              │
       ┌──────▼──────┐ ┌────▼────┐ ┌───────▼───────┐
       │ Share Mint  │ │ Reserve │ │  Strategies   │
       │    PDA      │ │   ATA   │ │ ┌───────────┐ │
       │ (receipts)  │ │(deposits│ │ │ Strategy 0│ │
       └─────────────┘ │land here│ │ │ Agent A   │ │
                        └─────────┘ │ ├───────────┤ │
                                    │ │ Strategy 1│ │
                                    │ │ Agent B   │ │
                                    │ ├───────────┤ │
                                    │ │ Strategy N│ │
                                    │ │ Agent N   │ │
                                    │ └───────────┘ │
                                    └───────────────┘
```

### Roles

| Role | Who | Permissions |
|------|-----|-------------|
| **Admin** | Set at vault init | Create/deactivate strategies, change delegates, set weights, manage action whitelists |
| **Authority** | Defaults to admin | Allocate/deallocate between reserve and strategies, rebalance, execute whitelisted actions |
| **Delegate** | AI agent keypair | Request whitelisted actions via `execute_strategy_action` (no direct token spending) |
| **User** | Anyone | Deposit, withdraw by burning shares |

---

## Three perspectives

### For users

1. Choose a vault with a trusted curator
2. Deposit USDC — one transaction
3. Receive tokenized SPL share tokens (your % of the vault)
4. Withdraw anytime — burn shares, get proportional assets + yield

### For curators (admin)

The curator role is similar to how Gauntlet curates Morpho vaults or Steakhouse Financial manages Kamino strategies — one person does the research so all depositors don't have to.

1. **Review agents** using a checklist (code & audit, track record, key security)
2. **Create strategies** — `create_strategy(agent_pubkey)`
3. **Set proportions** — `set_strategy_weight(bps)`, e.g. 4000 = 40%
4. **Monitor and act** — track performance, permanently shut down bad agents

### For agents

An AI agent interacts with the vault through the `execute_strategy_action` instruction. The agent requests the vault to CPI into an external protocol — the vault validates the action against a per-strategy whitelist and signs the CPI with its PDA.

**What agents can do:** request whitelisted actions on their assigned strategy (e.g., deposit into Lulo, withdraw from Kamino).

**What agents cannot do:** call non-whitelisted instructions, touch the reserve, access other strategies, mint shares, directly spend from the strategy token account, or modify vault state.

---

## Program instructions

| Instruction | Description | Signer |
|---|---|---|
| `initialize_vault` | Create vault state + share mint + reserve ATA | Admin |
| `deposit(amount)` | Transfer tokens to reserve, mint proportional shares | User |
| `withdraw(shares_to_burn)` | Burn shares, receive proportional tokens | User |
| `create_strategy` | Create strategy PDA + token account, register delegate | Admin |
| `allocate_to_strategy(amount)` | Move tokens: reserve → strategy | Authority |
| `deallocate_from_strategy(amount)` | Move tokens: strategy → reserve | Authority |
| `set_strategy_weight(weight_bps)` | Set target allocation weight (basis points, 0–10000) | Admin |
| `rebalance_strategy` | Move funds to/from strategy to match target weight | Anyone |
| `update_strategy_delegate` | Change the delegate address | Admin |
| `deactivate_strategy` | Return funds, mark permanently inactive | Admin |
| `add_allowed_action(program, discriminator)` | Whitelist a (program, instruction) pair for a strategy | Admin |
| `remove_allowed_action` | Deactivate a whitelisted action | Admin |
| `execute_strategy_action(instruction_data)` | CPI into external protocol via vault PDA (whitelist-checked) | Delegate or Authority |
| `migrate_strategy` | One-time: revoke old SPL delegate, init action_count | Admin |
| `transfer_admin(new_admin)` | Transfer admin role | Admin |
| `set_authority(new_authority)` | Change operational authority | Admin |

---

## Security model

**On-chain guarantees (enforced by Anchor):**

- Vault PDA owns all token accounts — no single keypair holds funds
- Admin/Authority separation — governance and operations are independent roles
- **Action whitelisting** — delegates can only call admin-approved (program, instruction) pairs via CPI
- **No direct spending** — delegates have no SPL token authority; all token movement goes through the vault program
- Delegate sandboxing — each agent scoped to its own strategy's whitelisted actions
- Deactivation is permanent — once a strategy is shut down, it can never be reactivated
- Authority can force-withdraw from external protocols if delegate goes offline
- Anchor constraints validate all accounts before instruction execution

**Honest limitation:** The vault validates *which* programs/instructions can be called, but not *amounts* or *economic soundness*. Max loss equals one strategy's allocation. The curator is responsible for choosing reliable agents and appropriate whitelists.

---

## Tech stack

| Component | Technology | Version |
|---|---|---|
| Program | Rust + Anchor | 0.32.1 |
| Rust | stable | 1.89.0 |
| Tests | TypeScript + ts-mocha + Chai | — |
| Frontend | Next.js + React + Tailwind | 16 / 19 / 4 |
| AI Agent | Solana Agent Kit + Anthropic Claude | 2.0 |
| Package manager | Bun | — |

## Project structure

```
erebor/
├── programs/my_project/src/
│   ├── lib.rs                    # Entry point (thin dispatcher)
│   ├── state.rs                  # VaultState, StrategyAllocation, AllowedAction
│   ├── errors.rs                 # VaultError enum
│   └── instructions/             # One file per instruction
│       ├── initialize_vault.rs
│       ├── deposit.rs / withdraw.rs
│       ├── create_strategy.rs / deactivate_strategy.rs
│       ├── allocate_to_strategy.rs / deallocate_from_strategy.rs
│       ├── add_allowed_action.rs / remove_allowed_action.rs
│       ├── execute_strategy_action.rs   # Core CPI routing
│       ├── migrate_strategy.rs
│       └── ...
├── tests/
│   └── my_project.ts             # Integration tests (47 tests)
├── app/                          # Next.js frontend
│   └── src/
│       ├── app/                  # Pages (home, admin)
│       ├── components/           # UI components
│       ├── hooks/                # React hooks
│       └── lib/                  # Helpers, constants, IDL
├── agent/                        # AI agent (Claude + Solana Agent Kit)
├── scripts/                      # Deploy, init, and crank scripts
└── Anchor.toml
```

## Getting started

### Prerequisites

- Rust 1.89.0 — `rustup install 1.89.0`
- Solana CLI — `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
- Anchor 0.32.1 — `avm install 0.32.1 && avm use 0.32.1`
- Bun — `curl -fsSL https://bun.sh/install | bash`

### Build and test

```bash
bun install
anchor build
anchor test
```

### Run frontend

```bash
cd app
bun install
bun run dev              # http://localhost:3000
```

### Run AI agent

```bash
cd agent
cp .env.example .env     # Fill in your keys
bun install
bun run start
```

## Deployment

| | |
|---|---|
| Program ID (devnet) | `B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z` |
| Upgrade Authority | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` |
| Cluster | devnet |
| Frontend | https://ereborvault.netlify.app/ |
| Explorer | [View on Solana Explorer](https://explorer.solana.com/address/B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z?cluster=devnet) |
| Mock Lulo | `3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm` |
| Mock Kamino | `S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK` |
| Mock Jupiter | `43FrWWHc13Fp4rsnb3XjDV5dfmWWoyLNzdSe1pqkLxn7` |

## Roadmap

- [ ] Example AI agent integration (Claude + Solana Agent Kit + Lulo)
- [ ] Auto-rebalance crank (periodic weight enforcement)
- [x] Policy cage contracts (action whitelisting per strategy)
- [ ] Per-action parameter constraints (max amount, cooldown)
- [ ] Velocity controls (max capital moved per time window)
- [ ] Drawdown circuit breakers (auto-deactivate at threshold)
- [ ] On-chain decision event emissions
- [ ] Mainnet deployment

## Error codes

| Error | When |
|---|---|
| `InsufficientBalance` | Source account doesn't have enough tokens |
| `InsufficientReserve` | Reserve can't cover withdrawal (funds in strategies) |
| `StrategyInactive` | Trying to use a deactivated strategy |
| `UnauthorizedAdmin` | Signer is not the vault admin |
| `UnauthorizedAuthority` | Signer is not the vault authority |
| `InvalidMint` | Token mint mismatch |
| `ZeroAmount` | Amount must be > 0 |
| `WeightExceedsMax` | Weight exceeds 10000 bps |
| `InsufficientReserveForRebalance` | Reserve can't cover rebalance allocation |
| `UnauthorizedCaller` | Signer is neither the strategy's delegate nor the vault authority |
| `ActionNotAllowed` | (program, discriminator) not in strategy's whitelist |
| `ActionNotActive` | AllowedAction has been deactivated |
| `InvalidStrategy` | Strategy reference mismatch |
| `InvalidInstructionData` | Instruction data too short or malformed |

## License

Licensed under the [Business Source License 1.1](LICENSE.md). After the change date (2028-03-30), this software converts to Apache 2.0.
