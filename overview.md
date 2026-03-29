# Sol-Vault — Solana Yield Vault with Multi-Strategy Delegation

## What is Sol-Vault?

Sol-Vault is a Solana program that implements a **yield-optimized vault** — users deposit tokens (e.g., USDC), receive proportional share tokens, and the vault admin can delegate portions of the funds to external DeFi protocols (lending, LPing) via **strategies** to earn yield.

Think of it like an **ERC-4626 vault on Solana**, with a multi-strategy delegation layer on top.

### How it works

1. **Users deposit** tokens and receive vault shares (receipt tokens representing their % ownership)
2. **Admin creates strategies** — each strategy is a separate token account with a delegate (external protocol) approved to spend from it
3. **Admin sets target weights** — each strategy gets a target allocation in basis points (e.g., 5000 = 50%)
4. **Authority rebalances** — calls `rebalance_strategy` to automatically move funds to match target weights
5. **Users withdraw** by burning shares — they receive their proportional share of total assets (including any yield earned)

### Why the multi-strategy pattern?

On Solana, each token account can only have **one delegate** at a time. To allow multiple protocols access to vault funds, we create **separate token accounts** per strategy — each with its own approved delegate. The vault PDA owns all of them and controls fund flow.

---

## Architecture

```
                    +------------------+
                    |   Users          |
                    |  deposit/withdraw|
                    +--------+---------+
                             |
                    +--------v---------+
                    |    Vault State   |  PDA: ["vault", token_mint]
                    |  (admin, auth,   |
                    |   total_deposited|
                    |   strategy_count)|
                    +---+----+----+----+
                        |    |    |
               +--------+   |    +--------+
               |             |             |
        +------v------+ +---v---+ +-------v-------+
        | Reserve ATA | | Share | | Strategy 0    |
        | (deposits   | | Mint  | | delegate: 0xA |
        |  land here) | | PDA   | | token_account |
        +-------------+ +-------+ +-------+-------+
                                           |
                                   +-------v-------+
                                   | Strategy 1    |
                                   | delegate: 0xB |
                                   | token_account |
                                   +---------------+
```

### Roles

| Role          | Who                     | Can do                                                   |
| ------------- | ----------------------- | -------------------------------------------------------- |
| **Admin**     | Set at vault init       | Create/deactivate strategies, change delegates           |
| **Authority** | Defaults to admin       | Allocate/deallocate funds between reserve and strategies |
| **User**      | Anyone                  | Deposit tokens, withdraw by burning shares               |
| **Delegate**  | External protocol/agent | Spend tokens from its assigned strategy token account    |

---

## Program Instructions

### Vault Operations

| Instruction                | Description                                          | Signer |
| -------------------------- | ---------------------------------------------------- | ------ |
| `initialize_vault`         | Create vault state + share mint + reserve ATA        | Admin  |
| `deposit(amount)`          | Transfer tokens to reserve, mint proportional shares | User   |
| `withdraw(shares_to_burn)` | Burn shares, receive proportional underlying tokens  | User   |

### Strategy Operations

| Instruction                        | Description                                              | Signer    |
| ---------------------------------- | -------------------------------------------------------- | --------- |
| `create_strategy`                  | Create strategy PDA + token account, approve delegate    | Admin     |
| `allocate_to_strategy(amount)`     | Move tokens: reserve -> strategy token account           | Authority |
| `deallocate_from_strategy(amount)` | Move tokens: strategy token account -> reserve           | Authority |
| `update_strategy_delegate`         | Revoke old delegate, approve new one                     | Admin     |
| `deactivate_strategy`              | Revoke delegate, return funds, mark inactive (permanent) | Admin     |

### Rebalancing Operations

| Instruction                       | Description                                                         | Signer    |
| --------------------------------- | ------------------------------------------------------------------- | --------- |
| `set_strategy_weight(weight_bps)` | Set target allocation weight for a strategy (basis points, 0–10000) | Admin     |
| `rebalance_strategy`              | Move funds to/from strategy to match its target weight              | Authority |

**How rebalancing works:**

Each strategy has a `target_weight_bps` field (basis points, where 10000 = 100%). When `rebalance_strategy` is called, the program calculates the target allocation:

```
target = total_deposited * target_weight_bps / 10000
```

If the strategy holds less than the target, tokens move from reserve → strategy. If it holds more, tokens move strategy → reserve. Weights across all strategies do **not** need to sum to 10000 — the remainder stays in the reserve as a liquidity buffer.

> **Tip:** When rebalancing multiple strategies, process deallocations before allocations to ensure the reserve has sufficient funds.

### Share Math

```
First deposit:  shares = amount                              (1:1)
Subsequent:     shares = amount * total_shares / total_deposited
Withdrawal:     underlying = shares * total_deposited / total_shares
```

If the vault earns yield (total_deposited grows), existing shares become worth more — new depositors get fewer shares per token, and withdrawers get more tokens per share.

---

## On-Chain Accounts

### VaultState (154 bytes)

| Field             | Type   | Description                                             |
| ----------------- | ------ | ------------------------------------------------------- |
| `admin`           | Pubkey | Can manage strategies                                   |
| `authority`       | Pubkey | Can allocate/deallocate funds                           |
| `token_mint`      | Pubkey | Accepted deposit token (e.g., USDC)                     |
| `share_mint`      | Pubkey | Vault's share token mint                                |
| `vault_id`        | u64    | Unique vault ID — allows multiple vaults per token mint |
| `total_deposited` | u64    | Total assets under management                           |
| `strategy_count`  | u64    | Auto-incrementing strategy ID                           |
| `bump`            | u8     | PDA bump                                                |
| `share_mint_bump` | u8     | Share mint PDA bump                                     |

### StrategyAllocation (116 bytes)

| Field               | Type   | Description                                                                      |
| ------------------- | ------ | -------------------------------------------------------------------------------- |
| `vault`             | Pubkey | Back-reference to VaultState                                                     |
| `strategy_id`       | u64    | Unique sequential ID                                                             |
| `delegate`          | Pubkey | Approved external spender                                                        |
| `allocated_amount`  | u64    | Tokens currently in strategy                                                     |
| `token_account`     | Pubkey | Strategy's token account PDA                                                     |
| `is_active`         | bool   | Once false, permanently disabled                                                 |
| `target_weight_bps` | u16    | Target allocation weight in basis points (0–10000). Used by `rebalance_strategy` |
| `bump`              | u8     | PDA bump                                                                         |

### PDA Seeds

| Account                | Seeds                                                   |
| ---------------------- | ------------------------------------------------------- |
| Vault State            | `["vault", token_mint, vault_id (u64 LE)]`              |
| Share Mint             | `["shares", vault_state]`                               |
| Reserve ATA            | ATA of `(vault_state, token_mint)`                      |
| Strategy               | `["strategy", vault_state, strategy_id (u64 LE)]`       |
| Strategy Token Account | `["strategy_token", vault_state, strategy_id (u64 LE)]` |

---

## Project Structure

```
sol-vault/
├── programs/my_project/src/
│   └── lib.rs                   # Anchor program (all instructions + accounts + errors)
├── tests/
│   └── my_project.ts            # Integration tests (Mocha + Chai)
├── scripts/
│   ├── deploy.sh                # Deploy to devnet/mainnet
│   ├── init-vault.ts            # Initialize vault for a token mint
│   ├── setup-devnet.ts          # Devnet setup helper
│   └── crank-yield.ts           # Yield harvesting script
├── app/                         # Next.js frontend
│   └── src/
│       ├── app/                 # Pages (home, admin dashboard)
│       ├── components/          # UI (deposit/withdraw forms, strategy management)
│       ├── hooks/               # React hooks (useDeposit, useWithdraw, useStrategies...)
│       └── lib/                 # Constants, PDA helpers, IDL, formatters
├── agent/                       # AI agent (Claude + Solana Agent Kit)
│   ├── .env.example             # Agent config template
│   └── src/                     # Agent source (to be implemented)
├── Anchor.toml                  # Anchor workspace config
├── DEPLOYMENT.md                # Deployment info & devnet details
└── AI_PLAN.md                   # AI agent implementation plan
```

---

## Tech Stack

| Component       | Technology                          | Version     |
| --------------- | ----------------------------------- | ----------- |
| Program         | Rust + Anchor                       | 0.32.1      |
| Rust toolchain  | stable                              | 1.89.0      |
| Tests           | TypeScript + ts-mocha + Chai        | -           |
| Frontend        | Next.js + React + Tailwind          | 16 / 19 / 4 |
| Package manager | Bun                                 | -           |
| AI Agent        | Solana Agent Kit + Anthropic Claude | 2.0         |

---

## Getting Started

### Prerequisites

- Rust 1.89.0 (`rustup install 1.89.0`)
- Solana CLI (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- Anchor 0.32.1 (`cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install 0.32.1 && avm use 0.32.1`)
- Bun (`curl -fsSL https://bun.sh/install | bash`)

### Build & Test

```bash
bun install              # Install root dependencies
anchor build             # Build the Solana program
anchor test              # Run tests on local validator
```

### Deploy

```bash
bun run deploy:devnet    # Deploy to devnet
bun run deploy:mainnet   # Deploy to mainnet (requires confirmation)
```

### Run Frontend

```bash
cd app
bun install
bun run dev              # http://localhost:3000
```

### Run AI Agent

```bash
cd agent
cp .env.example .env     # Fill in your keys
bun install
bun run start
```

---

## Deployment Info

| Param               | Value                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Program ID (devnet) | `DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B`                                                                             |
| Upgrade Authority   | `4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn`                                                                             |
| Anchor              | 0.32.1                                                                                                                     |
| Cluster             | devnet (mainnet not yet deployed)                                                                                          |
| Explorer            | [View on Solana Explorer](https://explorer.solana.com/address/DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B?cluster=devnet) |

---

## AI Agent Integration

The vault's delegate pattern enables autonomous AI agents to manage strategy funds. An agent's wallet keypair is set as the delegate on a strategy — it receives SPL token spending authority and can autonomously lend funds via Lulo (Solana's lending aggregator routing to Kamino, Drift, MarginFi).

**Flow:**

1. Admin calls `create_strategy(agent_pubkey)` — agent becomes delegate
2. Authority calls `allocate_to_strategy(amount)` — tokens move to strategy account
3. Agent detects balance, transfers to own ATA (using delegate authority), lends via Lulo
4. Agent monitors yields, Claude LLM decides: LEND / WITHDRAW / REBALANCE / HOLD
5. On withdrawal signal, agent pulls from Lulo and returns tokens to strategy account
6. Authority calls `deallocate_from_strategy` to move funds back to reserve

See [AI_PLAN.md](AI_PLAN.md) for full implementation details.

---

## Error Codes

| Error                             | When                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `InsufficientBalance`             | Source token account doesn't have enough                         |
| `InsufficientReserve`             | Reserve can't cover withdrawal (funds in strategies)             |
| `StrategyInactive`                | Trying to use a deactivated strategy                             |
| `UnauthorizedAdmin`               | Signer is not the vault admin                                    |
| `UnauthorizedAuthority`           | Signer is not the vault authority                                |
| `InvalidMint`                     | Token mint mismatch                                              |
| `ZeroAmount`                      | Deposit/withdraw amount must be > 0                              |
| `WeightExceedsMax`                | Strategy weight exceeds 10000 basis points (100%)                |
| `InsufficientReserveForRebalance` | Reserve doesn't have enough tokens to cover rebalance allocation |

---

## Security Model

- **Vault PDA** owns all token accounts (reserve + strategies) — no single keypair holds funds
- **Admin/Authority separation** — governance (admin) and operations (authority) are independent roles
- **Delegate pattern** — strategies get spending permission but can't modify vault state, mint shares, or access other strategies
- **Deactivation is permanent** — once a strategy is deactivated, it can never be reactivated (prevents delegate abuse)
- **Anchor constraints** — all account validation happens before instruction execution via `#[derive(Accounts)]` structs

Page 1:
I would like to present you Erebor. The vault infrastructure for funds management with AI agents on Solana. Let me show you why this matters.

Page 2:
AI agents are fragmented - each runs on separate platform with own different rules
Hard to review and trust - users need to independently review each agent and decide to give them their funds or not
AI agents today run on different platforms — ElizaOS, Alamanak, Cod3x, custom bots — each in its own wallet, it’s difficult to track all of them if you want to build a real portfolio of AI agents

Erebor solves this. You get a pre-reviewed pack of trusted agents — a curator already did the research, testing, and approval. Your deposit is automatically diversified across multiple agents with admin-set weights. Yield compounds automatically, and rebalancing keeps allocations on targets.

Page 3:
The AI agents sector went from practically nothing to $39 billion peak market cap in 18 months.

On the right — key protocols like Almanak, Cod3x — perp trading agents, I have strong connections with them and see partnership potential. ElizaOS has 50,000+ deployed agents.

Bottom line: 77% of all agent transaction volume happens on Solana. These agents are managing real money and they need a safe, structured home for that capital.

Page 4:
From the user's perspective,. Choose a vault with a manager you trust. Deposit USDC in one transaction. Receive tokenized SPL share tokens representing your percentage of the vault, you can use them as collateral in other lending protocols. Withdraw anytime by burning shares — you get your proportional assets including all yield earned by all agents in the vault.

Page 5:
The admin acts like a fund manager — they do the research so thousands of depositors don't have to. Same model as Morpho's curators or Kamino's risk managers.

The vault can't prevent bad trades. But it limits the damage — if one agent loses everything, only its allocation percentage is affected.

Page 6:
From the agent's owner perspective, it only sees it’s assigned strategy token account.
Agent’s owner must provide to the admin list of information, so no black-box agents allowed.

Page 7:
Architecture overview. Users deposit/withdraw through the Vault State PDA. Below it: Share Mint issues receipt tokens, Reserve ATA holds deposits, Strategies container holds one token account per agent.

Solana constraint: each SPL token account can only have one delegate — so each agents need separate accounts. Each strategy stores target_weight_bps; rebalance_strategy automatically distributes funds. Unallocated percentage stays in the reserve as a withdrawal buffer.
