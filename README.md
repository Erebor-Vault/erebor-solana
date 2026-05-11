# Erebor

**One vault to hold them all.**

Erebor is a non-custodial multi-strategy vault on Solana that lets AI agents manage yield on behalf of depositors. Users deposit USDC, receive tokenized share tokens, and a professional curator selects and monitors autonomous AI agents that earn yield across Solana DeFi — all through Solana's native SPL delegate mechanism.

Think of it as an ERC-4626-style vault designed specifically for AI agent strategies.

> Named after the legendary dwarven treasury under the Lonely Mountain — one impenetrable home for AI-managed capital.

**Live app:** https://erebor-gold.vercel.app/

**Explorer:** [View on Solana Explorer](https://explorer.solana.com/address/DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B?cluster=devnet)

## Documentation index

The structured spec set lives at the repo root. Read in this order:

1. [docs/OVERVIEW.md](docs/OVERVIEW.md) — high-level pitch + architecture
   explainer.
2. [docs/SOLANA_VAULT_SPEC.md](docs/SOLANA_VAULT_SPEC.md) — build spec (partly
   aspirational; see status section at the top).
3. [CLAUDE.md](CLAUDE.md) — contributor guide (commands +
   invariants).
4. [docs/FRONTEND.md](docs/FRONTEND.md) — current dashboard snapshot.
5. [docs/FRONTEND_PLAN.md](docs/FRONTEND_PLAN.md) — forward-looking frontend
   roadmap.
6. [docs/MISMATCHES.md](docs/MISMATCHES.md) — every place the spec diverges
   from what's actually shipped today.

Other top-level docs: [docs/PLAN.md](docs/PLAN.md) (historical implementation
checklist), [docs/AI_PLAN.md](docs/AI_PLAN.md) (AI agent design),
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (live program + per-vault PDAs).

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
| **Admin** | Set at vault init | Create/deactivate strategies, change delegates, set weights |
| **Authority** | Defaults to admin | Allocate/deallocate between reserve and strategies, rebalance |
| **Delegate** | AI agent keypair | Spend from assigned strategy token account |
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

An AI agent sees exactly one thing: its assigned strategy token account. The vault PDA owns this account; the agent is just the delegate with spending permission.

**What agents can do:** spend tokens from their assigned strategy account via delegate authority.

**What agents cannot do:** touch the reserve, access other strategies, mint shares, or modify vault state.

---

## Program instructions

| Instruction | Description | Signer |
|---|---|---|
| `initialize_vault` | Create vault state + share mint + reserve ATA | Admin |
| `deposit(amount)` | Transfer tokens to reserve, mint proportional shares | User |
| `withdraw(shares_to_burn)` | Burn shares, receive proportional tokens | User |
| `create_strategy` | Create strategy PDA + token account, approve delegate | Admin |
| `allocate_to_strategy(amount)` | Move tokens: reserve → strategy | Authority |
| `deallocate_from_strategy(amount)` | Move tokens: strategy → reserve | Authority |
| `set_strategy_weight(weight_bps)` | Set target allocation weight (basis points, 0–10000) | Admin |
| `rebalance_strategy` | Move funds to/from strategy to match target weight | Authority |
| `update_strategy_delegate` | Revoke old delegate, approve new one | Admin |
| `deactivate_strategy` | Revoke delegate, return funds, mark permanently inactive | Admin |

---

## Security model

**On-chain guarantees (enforced by Anchor):**

- Vault PDA owns all token accounts — no single keypair holds funds
- Admin/Authority separation — governance and operations are independent roles
- Delegate sandboxing — each agent scoped to its own token account only
- Deactivation is permanent — once a strategy is shut down, it can never be reactivated
- Anchor constraints validate all accounts before instruction execution

**Honest limitation:** The vault cannot cryptographically prevent bad trades or downstream protocol exploits. Max loss equals one strategy's allocation. The curator is responsible for choosing reliable agents.

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
│   └── lib.rs                    # Anchor program
├── tests/
│   └── my_project.ts             # Integration tests
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
| Program ID (devnet) | `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B` |
| Upgrade Authority | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn` |
| Cluster | devnet |
| Frontend | https://erebor-gold.vercel.app/ |
| Explorer | [View on Solana Explorer](https://explorer.solana.com/address/DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B?cluster=devnet) |

## Roadmap

- [ ] Example AI agent integration (Claude + Solana Agent Kit + Lulo)
- [ ] Auto-rebalance crank (periodic weight enforcement)
- [ ] Policy cage contracts (token + protocol allowlists)
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

## License

Licensed under the [Business Source License 1.1](LICENSE.md). After the change date (2028-03-30), this software converts to Apache 2.0.
