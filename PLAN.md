# Vault Program with Multi-Strategy Delegation

---

## What is this program? (Plain English)

Imagine a **savings account** that holds USDC:
- Users **deposit** USDC and get "receipt tokens" (shares) back — like getting a certificate saying "you own X% of this vault"
- Users can **withdraw** by returning their shares and getting their USDC back (plus any profit earned)
- The vault admin can **lend out** parts of the USDC to different DeFi protocols (strategies) to earn yield
- Each strategy is like a separate pocket — the admin puts money in, and a specific protocol is allowed to use that pocket's funds

**The key trick**: On Solana, a token account can only grant spending permission to ONE external address at a time. So instead of one big pool with multiple spenders, we create **separate token accounts** — one per strategy — each granting permission to a different protocol. The vault program controls all of them.

**Real-world analogy**: Think of it like a company treasury:
- The **vault** = the company's bank
- **Shares** = stock in the company (own more shares = own more of the treasury)
- **Reserve** = cash in the main checking account
- **Strategies** = separate investment accounts, each managed by a different fund manager (delegate)
- **Admin** = the CFO who decides which fund managers to trust
- **Authority** = the treasurer who moves cash between accounts

---

## Implementation Checklist

Everything lives in a single file: `programs/my_project/src/lib.rs`

### Phase 1: Data structures & errors (top of lib.rs)
- [ ] 1.1 Add imports: `anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, MintTo, Burn, TransferChecked, Approve, Revoke}`, `anchor_spl::associated_token::AssociatedToken`
- [ ] 1.2 Add `#[error_code] enum VaultError` (InsufficientBalance, InsufficientReserve, MathOverflow, StrategyInactive, UnauthorizedAdmin, UnauthorizedAuthority, InvalidMint, ZeroAmount)
- [ ] 1.3 Add `#[account] #[derive(InitSpace)] pub struct VaultState` (admin, authority, token_mint, share_mint, total_deposited, strategy_count, bump, share_mint_bump)
- [ ] 1.4 Add `#[account] #[derive(InitSpace)] pub struct StrategyAllocation` (vault, strategy_id, delegate, allocated_amount, token_account, is_active, bump)
- [ ] 1.5 `anchor build` — verify structs compile

### Phase 2: Core vault instructions + tests
- [ ] 2.1 Add `initialize_vault` instruction + `#[derive(Accounts)] pub struct InitializeVault`
  - Accounts: admin (signer+payer), vault_state (init, seeds=["vault", token_mint]), token_mint, share_mint (init, seeds=["shares", vault_state], mint::authority=vault_state, mint::decimals=token_mint.decimals), reserve_ata (init, associated_token for vault_state), system_program, token_program, associated_token_program
  - Handler: populate all VaultState fields, set authority=admin, total_deposited=0, strategy_count=0, store bumps
- [ ] 2.2 Add `deposit(amount: u64)` instruction + `#[derive(Accounts)] pub struct Deposit`
  - Accounts: user (signer), vault_state (mut, seeds), token_mint, share_mint (mut), user_token_account (mut, ATA for user), reserve_ata (mut, ATA for vault_state), user_share_account (mut, init_if_needed), programs
  - Handler: calculate shares (1:1 if first, else amount*supply/total_deposited), CPI transfer_checked user→reserve (user signs), CPI mint_to shares→user (vault PDA signs), update total_deposited
  - Use checked_mul/checked_div for all arithmetic
- [ ] 2.3 Add `withdraw(shares_to_burn: u64)` instruction + `#[derive(Accounts)] pub struct Withdraw`
  - Accounts: user (signer), vault_state (mut), token_mint, share_mint (mut), user_token_account (mut), reserve_ata (mut), user_share_account (mut), token_program
  - Handler: calculate underlying (shares*total_deposited/supply), require reserve >= underlying, CPI burn shares (user signs), CPI transfer_checked reserve→user (vault PDA signs), update total_deposited
- [ ] 2.4 `anchor build` — verify core instructions compile
- [ ] 2.5 **Tests for Phase 2** — write in `tests/my_project.ts`:
  - [ ] Test setup: create USDC-like mint (6 decimals), generate keypairs (admin, user1, user2), airdrop SOL
  - [ ] Test `initialize_vault`:
    - Call initialize_vault, fetch VaultState — assert admin, authority, token_mint, share_mint, total_deposited==0, strategy_count==0
    - Verify share_mint has vault PDA as mint authority and correct decimals
    - Verify reserve_ata exists and is owned by vault PDA
    - Verify calling initialize_vault again with same mint fails (PDA already exists)
  - [ ] Test `deposit`:
    - Mint 10_000_000 tokens (10.0) to user1's ATA
    - First deposit of 5_000_000 — assert user receives 5_000_000 shares (1:1), total_deposited==5_000_000
    - Second deposit of 2_000_000 — assert shares = 2_000_000 * 5_000_000 / 5_000_000 = 2_000_000 (ratio still 1:1)
    - Verify reserve_ata balance == 7_000_000
    - Verify deposit of 0 fails with ZeroAmount
    - Verify deposit exceeding user balance fails
  - [ ] Test `withdraw`:
    - User1 burns 3_000_000 shares — assert receives 3_000_000 underlying, total_deposited decreases
    - Verify user token balance increased, reserve balance decreased
    - Verify share account balance decreased
    - Verify withdraw of 0 shares fails with ZeroAmount
    - Verify withdraw more shares than owned fails
  - [ ] `anchor test` — Phase 2 tests pass

### Phase 3: Strategy instructions + tests
- [ ] 3.1 Add `create_strategy` instruction + `#[derive(Accounts)] pub struct CreateStrategy`
  - Accounts: admin (signer+payer, constraint admin==vault_state.admin), vault_state (mut), strategy (init, seeds=["strategy", vault_state, strategy_count]), token_mint, strategy_token_account (init, seeds=["strategy_token", vault_state, strategy_count], token::authority=vault_state), delegate (UncheckedAccount), system_program, token_program
  - Handler: populate StrategyAllocation fields, CPI approve delegate with u64::MAX (vault PDA signs), increment strategy_count
- [ ] 3.2 Add `allocate_to_strategy(amount: u64)` instruction + `#[derive(Accounts)] pub struct AllocateToStrategy`
  - Accounts: authority (signer, constraint authority==vault_state.authority), vault_state, strategy (mut, constraint vault match + is_active), token_mint, reserve_ata (mut), strategy_token_account (mut, constraint matches strategy.token_account), token_program
  - Handler: require amount>0 + reserve>=amount, CPI transfer_checked reserve→strategy (vault PDA signs), update allocated_amount
- [ ] 3.3 Add `deallocate_from_strategy(amount: u64)` instruction + `#[derive(Accounts)] pub struct DeallocateFromStrategy`
  - Accounts: same pattern as allocate but reversed direction
  - Handler: require amount>0 + strategy has enough, CPI transfer_checked strategy→reserve (vault PDA signs), update allocated_amount
- [ ] 3.4 Add `update_strategy_delegate` instruction + `#[derive(Accounts)] pub struct UpdateStrategyDelegate`
  - Accounts: admin (signer, constraint admin==vault_state.admin), vault_state, strategy (mut, constraint is_active), strategy_token_account (mut), new_delegate (UncheckedAccount), token_program
  - Handler: CPI revoke (vault PDA signs), CPI approve new_delegate u64::MAX (vault PDA signs), update strategy.delegate
- [ ] 3.5 Add `deactivate_strategy` instruction + `#[derive(Accounts)] pub struct DeactivateStrategy`
  - Accounts: admin (signer), vault_state (mut), strategy (mut, constraint is_active), token_mint, strategy_token_account (mut), reserve_ata (mut), token_program
  - Handler: CPI revoke (vault PDA signs), if remaining>0 CPI transfer_checked strategy→reserve (vault PDA signs), set is_active=false + allocated_amount=0
- [ ] 3.6 `anchor build` — full program compiles
- [ ] 3.7 **Tests for Phase 3** — add to `tests/my_project.ts`:
  - [ ] Test `create_strategy`:
    - Generate protocolA keypair as delegate
    - Admin calls create_strategy with protocolA as delegate
    - Fetch StrategyAllocation — assert vault, strategy_id==0, delegate==protocolA, allocated_amount==0, is_active==true
    - Fetch VaultState — assert strategy_count==1
    - Derive strategy_token_account PDA, verify it exists and has vault PDA as authority
    - Create second strategy with protocolB — assert strategy_id==1, strategy_count==2
    - Verify non-admin (user1) calling create_strategy fails with UnauthorizedAdmin
  - [ ] Test `allocate_to_strategy`:
    - Ensure reserve has funds from previous deposit tests (or deposit first)
    - Authority allocates 2_000_000 to strategy 0
    - Fetch strategy — assert allocated_amount==2_000_000
    - Verify reserve_ata balance decreased by 2_000_000
    - Verify strategy_token_account balance increased by 2_000_000
    - Verify total_deposited did NOT change (funds still in vault system)
    - Verify allocating more than reserve balance fails with InsufficientReserve
    - Verify non-authority calling allocate fails with UnauthorizedAuthority
    - Verify allocating 0 fails with ZeroAmount
  - [ ] Test `deallocate_from_strategy`:
    - Authority deallocates 1_000_000 from strategy 0
    - Fetch strategy — assert allocated_amount==1_000_000 (was 2M, removed 1M)
    - Verify reserve_ata balance increased by 1_000_000
    - Verify strategy_token_account balance decreased by 1_000_000
    - Verify deallocating more than allocated fails with InsufficientBalance
  - [ ] Test `update_strategy_delegate`:
    - Generate protocolC keypair as new delegate
    - Admin updates strategy 0 delegate from protocolA to protocolC
    - Fetch strategy — assert delegate==protocolC
    - Verify non-admin cannot update delegate
    - Verify cannot update delegate on inactive strategy (test after deactivate)
  - [ ] Test `deactivate_strategy`:
    - Strategy 0 still has 1_000_000 allocated
    - Admin deactivates strategy 0
    - Fetch strategy — assert is_active==false, allocated_amount==0
    - Verify strategy_token_account balance==0 (funds returned to reserve)
    - Verify reserve_ata increased by 1_000_000
    - Verify allocating to inactive strategy fails with StrategyInactive
  - [ ] `anchor test` — Phase 3 tests pass

### Phase 4: End-to-end integration tests
- [ ] 4.1 **E2E test: full lifecycle**
  - Fresh vault init → user1 deposits 5M → user2 deposits 3M
  - Verify share ratios: user1 has 5M shares, user2 has 3M shares, total_deposited==8M
  - Admin creates strategy with protocolA delegate
  - Authority allocates 4M to strategy
  - Reserve now has 4M, strategy has 4M, total_deposited still 8M
  - Authority deallocates 2M back to reserve
  - Reserve now has 6M, strategy has 2M
  - User1 withdraws all shares (5M shares) — receives 5M underlying (5M * 8M / 8M)
  - Verify reserve decreased, total_deposited decreased
  - User2 withdraws remaining shares
  - Verify vault is empty
- [ ] 4.2 **E2E test: share price changes with yield**
  - User1 deposits 1M tokens, gets 1M shares
  - Simulate yield: admin/authority increases total_deposited (or send tokens directly to reserve)
  - User2 deposits 1M tokens — should get fewer shares (share price increased)
  - User1 withdraws — should get more than 1M tokens (profit from yield)
- [ ] 4.3 **E2E test: multiple strategies**
  - Create 3 strategies with different delegates
  - Allocate different amounts to each
  - Deallocate from one, deactivate another
  - Verify all balances and state are consistent
- [ ] 4.4 **Error case tests** (can be in a separate describe block):
  - Deposit with zero amount → ZeroAmount
  - Withdraw with zero shares → ZeroAmount
  - Withdraw when reserve insufficient (funds in strategy) → InsufficientReserve
  - Non-admin create_strategy → UnauthorizedAdmin
  - Non-authority allocate → UnauthorizedAuthority
  - Allocate to inactive strategy → StrategyInactive
  - Update delegate on inactive strategy → StrategyInactive
  - Deallocate more than allocated → InsufficientBalance
  - Deposit with wrong token mint → fails (Anchor constraint)
- [ ] 4.5 `anchor test` — all tests pass

### Phase 5: Cleanup
- [ ] 5.1 Remove old `lib copy.rs` backup file
- [ ] 5.2 Update CLAUDE.md with new project description
- [ ] 5.3 Final `anchor build` + `anchor test`

---

## Context & Problem

**In simple words**: Users put their USDC into a shared pot. The pot gives them "receipt tokens" (shares). The vault admin can lend parts of the pot to different DeFi protocols to earn interest. When users want their USDC back, they return their receipts and get their share of the pot (including any profits earned).

**Core features**:
- Share tokens (mint on deposit, burn on withdraw) — so users get proportional ownership
- Multiple strategy token accounts with delegates — so external protocols can use vault funds
- Admin/authority role separation — so governance and operations are independent

**The 4 things this vault does**:

1. **Accepts deposits** — users send USDC, get shares back (like buying into a mutual fund)
2. **Issues share tokens** — each share = a proportional piece of the vault's total assets
3. **Delegates funds to strategies** — admin sends portions of the vault's USDC to different protocols (Aave-like lending, liquidity pools, etc.) to earn yield
4. **Works around Solana's 1-delegate limitation** — since each token account can only approve ONE spender, we create a separate account per strategy, each with its own approved spender

### Why this architecture?

On Solana, each token account can only have **one delegate** at a time (unlike ERC-20 where you can approve unlimited spenders). To allow multiple protocols to access vault funds, we create **separate token accounts** — one per strategy — each with its own delegate set to a different protocol. The vault PDA owns all these accounts and controls fund flow between them.

**Think of it like this**: You can't give 3 people a key to the same safe. But you CAN create 3 safes, give one key each, and control how much money goes into each safe.

### Solidity analogy

```
ERC-4626 Vault Contract          →  VaultState PDA
vault.deposit(amount)            →  deposit instruction
vault.withdraw(shares)           →  withdraw instruction
vault.totalAssets()              →  vault_state.total_deposited
vault shares (ERC-20)            →  Share Mint PDA (SPL Token)
approve(strategy, amount)        →  create_strategy + approve CPI
strategy.invest(amount)          →  allocate_to_strategy instruction
```

---

## Architecture Overview

**In simple words**: The vault has one "brain" (VaultState PDA) that controls three types of things:
1. A **share token printer** — creates/destroys receipt tokens when users deposit/withdraw
2. A **main cash register** (Reserve ATA) — where all deposits land and withdrawals come from
3. **Strategy pockets** (one per strategy) — separate accounts that hold funds being used by external protocols

```
                    ┌─────────────────────────────────────┐
                    │         VaultState PDA               │
                    │  seeds: ["vault", token_mint]        │
                    │                                      │
                    │  admin: who manages strategies       │
                    │  authority: who moves funds           │
                    │  token_mint: accepted token (USDC)   │
                    │  share_mint: vault share token       │
                    │  total_deposited: total assets       │
                    │  strategy_count: next strategy ID    │
                    └──────────┬───────────────────────────┘
                               │ owns (is authority/mint_authority of)
              ┌────────────────┼────────────────────┐
              │                │                    │
              ▼                ▼                    ▼
    ┌──────────────┐  ┌──────────────┐    ┌──────────────────┐
    │  Share Mint   │  │  Reserve ATA │    │  Strategy Token  │
    │  PDA          │  │              │    │  Accounts (N)    │
    │               │  │  Main pool   │    │                  │
    │  Minted on    │  │  for deposit │    │  Each has 1      │
    │  deposit,     │  │  & withdraw  │    │  delegate set to │
    │  burned on    │  │              │    │  an external     │
    │  withdraw     │  │  Owned by    │    │  protocol        │
    │               │  │  vault PDA   │    │                  │
    └──────────────┘  └──────────────┘    └──────────────────┘
```

### Fund flow

**In simple words**: Money flows like this:
- **Deposit**: User's wallet → main cash register. Vault prints shares for the user.
- **Withdraw**: User gives shares back (burned). Main cash register → user's wallet.
- **Allocate**: Admin moves money from cash register → strategy pocket.
- **Deallocate**: Admin moves money from strategy pocket → back to cash register.
- **Protocol uses funds**: The approved protocol takes money from the strategy pocket to invest it.

```
USER DEPOSITS:
  User Token Account ──transfer──▶ Reserve ATA
  Share Mint ──mint_to──▶ User Share Account

USER WITHDRAWS:
  User Share Account ──burn──▶ Share Mint
  Reserve ATA ──transfer──▶ User Token Account  (vault PDA signs)

ALLOCATE TO STRATEGY:
  Reserve ATA ──transfer──▶ Strategy Token Account  (vault PDA signs)

DEALLOCATE FROM STRATEGY:
  Strategy Token Account ──transfer──▶ Reserve ATA  (vault PDA signs)

EXTERNAL PROTOCOL USES FUNDS:
  Strategy Token Account ──transfer──▶ Protocol  (delegate signs, NOT our program)
```

---

## Roles & Permissions

**In simple words**: There are 4 types of people who interact with the vault:
- **Admin** = the boss. Decides which protocols to trust, can shut down strategies.
- **Authority** = the money mover. Decides how much to send to each strategy. Could be a bot.
- **User** = anyone. Can deposit money and withdraw it later.
- **Delegate** = external protocol (like a lending platform). Can only spend from its assigned pocket.

| Role | Who | Can do |
|---|---|---|
| **Admin** | Set at init, stored in vault_state.admin | Create/deactivate strategies, change delegates, manage vault settings |
| **Authority** | Set at init (defaults to admin), stored in vault_state.authority | Allocate/deallocate funds between reserve and strategies. Could be a multisig or bot in production |
| **User** | Anyone | Deposit tokens (get shares), withdraw tokens (burn shares) |
| **Delegate** | External protocol address | Spend tokens from their assigned strategy token account (set via SPL `approve`) |

### Why separate admin and authority?

- **Admin** = governance/management decisions (which strategies exist, which protocols are trusted)
- **Authority** = operational decisions (how much to allocate where, rebalancing)
- In production, admin might be a DAO/multisig, authority might be an automated bot

---

## File Structure

Everything in a single file:

```
programs/my_project/src/
└── lib.rs    — Everything: imports, declare_id!, #[program] module with all 8 instructions,
                all #[derive(Accounts)] structs, data account structs, error enum
```

**Layout within `lib.rs`** (top to bottom):
1. Imports (`use anchor_lang::prelude::*`, `use anchor_spl::...`)
2. `declare_id!(...)`
3. `#[program] pub mod my_project { ... }` — all 8 instruction handlers
4. `#[error_code] enum VaultError { ... }`
5. `#[derive(Accounts)] pub struct InitializeVault { ... }` — one struct per instruction
6. `#[derive(Accounts)] pub struct Deposit { ... }`
7. ... (all 8 account validation structs)
8. `#[account] pub struct VaultState { ... }` — data accounts at the bottom
9. `#[account] pub struct StrategyAllocation { ... }`

---

## Data Accounts (PDAs)

**In simple words**: These are the "database records" stored on-chain. Each one is a PDA (Program Derived Address) — an account whose address is deterministically computed from seeds (like a hash). The program "owns" these accounts and only it can modify them.

- **VaultState** = the vault's configuration file. Stores who the admin is, which token it accepts, how much has been deposited total, etc.
- **StrategyAllocation** = one record per strategy. Stores which protocol is the delegate, how much money has been sent to it, and whether the strategy is still active.

### VaultState

**Seeds**: `["vault", token_mint.key()]`
**Why these seeds**: One vault per token mint. If you want a USDC vault and a USDT vault, they get separate VaultState PDAs automatically.

```rust
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub admin: Pubkey,          // 32 bytes — manages strategies and delegates
    pub authority: Pubkey,      // 32 bytes — operational: allocate/deallocate funds
    pub token_mint: Pubkey,     // 32 bytes — the accepted deposit token (e.g. USDC mint address)
    pub share_mint: Pubkey,     // 32 bytes — address of the share token mint PDA
    pub total_deposited: u64,   // 8 bytes  — total underlying tokens in the vault system
                                //            (reserve + all strategies combined)
    pub strategy_count: u64,    // 8 bytes  — auto-incrementing ID for next strategy
    pub bump: u8,               // 1 byte   — PDA bump for vault_state
    pub share_mint_bump: u8,    // 1 byte   — PDA bump for share_mint
}
// Total: 32*4 + 8*2 + 1*2 = 146 bytes
// On-chain space: 8 (discriminator) + 146 = 154 bytes
```

**Key design decisions**:
- `total_deposited` tracks the accounting total, NOT the actual reserve balance. When funds move to strategies, `total_deposited` stays the same (the funds are still "in the vault"). It only changes on user deposit/withdraw.
- `strategy_count` only increments, never decrements. Deactivated strategies keep their IDs. This prevents seed collision.

### StrategyAllocation

**Seeds**: `["strategy", vault_state.key(), &strategy_id.to_le_bytes()]`
**Why these seeds**: Each strategy is uniquely identified by its vault + sequential ID.

```rust
#[account]
#[derive(InitSpace)]
pub struct StrategyAllocation {
    pub vault: Pubkey,          // 32 bytes — back-reference to which vault this belongs to
    pub strategy_id: u64,       // 8 bytes  — unique sequential ID (0, 1, 2, ...)
    pub delegate: Pubkey,       // 32 bytes — the external protocol address that can spend
    pub allocated_amount: u64,  // 8 bytes  — how many tokens are currently allocated here
    pub token_account: Pubkey,  // 32 bytes — the PDA token account holding strategy funds
    pub is_active: bool,        // 1 byte   — false = deactivated, can't allocate more
    pub bump: u8,               // 1 byte   — PDA bump
}
// Total: 32*3 + 8*2 + 1*2 = 114 bytes
// On-chain space: 8 (discriminator) + 114 = 122 bytes
```

### Strategy Token Account (not a data account, but a PDA token account)

**Seeds**: `["strategy_token", vault_state.key(), &strategy_id.to_le_bytes()]`
**Authority**: vault_state PDA
**Delegate**: set to the external protocol via `spl_token::approve`

This is a regular SPL Token account (not an Anchor data account), but created as a PDA so its address is deterministic. The vault PDA is the **owner/authority**, and the **delegate** is the external protocol that can spend from it.

---

## Instructions — Detailed Breakdown

**In simple words**: Instructions are the "buttons" users can press. Each instruction is a function that takes specific accounts, validates them, and does something. Think of them as API endpoints — each one has required parameters and permissions.

### Step 1: Create state structs + errors

**In simple words**: Before building any buttons, we define what data we need to store (the structs) and what can go wrong (the errors). Like designing a database schema and error codes before writing business logic.

The error enum covers all failure modes:
```rust
#[error_code]
pub enum VaultError {
    InsufficientBalance,    // source account doesn't have enough tokens
    InsufficientReserve,    // reserve doesn't have enough for withdrawal
    MathOverflow,           // checked arithmetic failed
    StrategyInactive,       // trying to use a deactivated strategy
    UnauthorizedAdmin,      // signer is not the vault admin
    UnauthorizedAuthority,  // signer is not the vault authority
    InvalidMint,            // wrong token mint passed
    ZeroAmount,             // amount must be > 0
}
```

---

### Step 2: `initialize_vault`

**In simple words**: This is the "deploy" button. It creates everything the vault needs to operate: the config account, the share token, and the main cash register. Whoever calls this becomes the admin. You only call this once per token type.

**Purpose**: Set up the entire vault infrastructure in one transaction.

**Who can call**: Anyone (becomes the admin).

**What it creates** (3 accounts in one tx):

1. **VaultState PDA** — the main config account
   - `seeds = ["vault", token_mint.key()]`
   - Stores admin, authority, mint references, counters

2. **Share Mint PDA** — a new SPL Token mint for vault shares
   - `seeds = ["shares", vault_state.key()]`
   - `mint::authority = vault_state` — only the vault program can mint/burn shares
   - `mint::decimals = token_mint.decimals` — match the underlying token's decimals

3. **Reserve ATA** — the main token account holding deposited funds
   - Standard Associated Token Account
   - `associated_token::authority = vault_state` — owned by the vault PDA
   - This is where user deposits go and withdrawals come from

**Account struct**:
```rust
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,                              // pays for everything

    #[account(init, payer = admin, seeds = ["vault", token_mint], bump)]
    pub vault_state: Account<'info, VaultState>,           // new vault config

    pub token_mint: InterfaceAccount<'info, Mint>,         // e.g. USDC (already exists)

    #[account(init, payer = admin, seeds = ["shares", vault_state], bump,
              mint::decimals = token_mint.decimals, mint::authority = vault_state)]
    pub share_mint: InterfaceAccount<'info, Mint>,         // new share token

    #[account(init, payer = admin, associated_token::mint = token_mint,
              associated_token::authority = vault_state)]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>, // new reserve

    pub system_program, token_program, associated_token_program  // required programs
}
```

**Handler logic**:
1. Populate all VaultState fields
2. Set `authority = admin` initially (can be changed later if needed)
3. Set `total_deposited = 0`, `strategy_count = 0`
4. Store both bumps for future PDA signing

---

### Step 3: `deposit(amount: u64)`

**In simple words**: User puts USDC into the vault and gets share tokens back. The number of shares they get depends on the current "exchange rate" — if the vault has already earned profit, each share is worth more, so the user gets fewer shares per USDC. First depositor always gets 1 share per 1 token.

**Purpose**: User deposits underlying tokens and receives proportional share tokens.

**Who can call**: Any user with tokens.

**Share calculation** (the core ERC-4626 math):
```
If first deposit (share_supply == 0):
    shares_to_mint = amount                    // 1:1 ratio

Otherwise:
    shares_to_mint = amount × share_supply     // proportional to existing ratio
                     ─────────────────────
                       total_deposited
```

**Example**:
- Vault has 1000 USDC deposited, 1000 shares outstanding
- User deposits 500 USDC
- Shares = 500 × 1000 / 1000 = 500 shares minted
- Now: 1500 USDC, 1500 shares (each share still worth 1 USDC)

**Example with yield**:
- Vault has 1000 USDC deposited, 1000 shares, but strategies earned 200 USDC (total_deposited updated to 1200)
- User deposits 600 USDC
- Shares = 600 × 1000 / 1200 = 500 shares
- Now: 1800 USDC, 1500 shares (each share worth 1.2 USDC)

**Two CPIs in this instruction**:
1. `transfer_checked`: user tokens → reserve ATA (user signs, standard transfer)
2. `mint_to`: share mint → user's share ATA (vault PDA signs via `with_signer`)

**Account struct**:
```rust
pub struct Deposit<'info> {
    pub user: Signer<'info>,                    // depositor
    pub vault_state: Account<'info, VaultState>, // mut, to update total_deposited
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub share_mint: InterfaceAccount<'info, Mint>, // mut, supply changes
    pub user_token_account: InterfaceAccount<'info, TokenAccount>, // mut, source
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,        // mut, destination
    pub user_share_account: InterfaceAccount<'info, TokenAccount>, // mut, init_if_needed
    // programs...
}
```

**Why `init_if_needed` on user_share_account**: The user might not have a share token ATA yet (first deposit). `init_if_needed` creates it automatically if missing.

---

### Step 4: `withdraw(shares_to_burn: u64)`

**In simple words**: User gives their share tokens back ("burns" them — they're destroyed). The vault calculates what percentage of the total those shares represent and sends them that percentage of the vault's assets in USDC. If the vault earned profit, the user gets more USDC back than they deposited.

**Important**: If too much money is locked in strategies, the user can't withdraw until the authority moves funds back to the reserve. This is by design — keeps things simple.

**Purpose**: User burns share tokens and receives proportional underlying tokens.

**Who can call**: Any user holding share tokens.

**Underlying calculation**:
```
underlying_amount = shares_to_burn × total_deposited
                    ─────────────────────────────────
                           share_supply
```

**Critical constraint**: `reserve_ata.amount >= underlying_amount`. If too many funds are allocated to strategies, the withdrawal fails with `InsufficientReserve`. The authority must deallocate from strategies first. This is a deliberate design choice — simpler and safer than auto-deallocating in the same transaction.

**Two CPIs**:
1. `burn`: burn shares from user's share ATA (user signs, they're burning their own tokens)
2. `transfer_checked`: reserve ATA → user token ATA (vault PDA signs)

**Order matters**: Burn FIRST, then transfer. If transfer fails after burn, the transaction reverts atomically (Solana transactions are all-or-nothing).

---

### Step 5: `create_strategy(delegate: Pubkey)`

**In simple words**: The admin says "I want to let Protocol X use some of our vault's funds." This creates:
1. A metadata record tracking this strategy (how much is allocated, who the delegate is)
2. A brand new token account (a "pocket") that only Protocol X is allowed to spend from

The protocol can't take money yet — the pocket is empty. The authority needs to "allocate" funds to it first.

**Purpose**: Admin sets up a new strategy — creates the metadata account AND the token account, then approves a delegate.

**Who can call**: Admin only (constraint checks `admin.key() == vault_state.admin`).

**What it creates** (2 accounts):
1. **StrategyAllocation PDA** — metadata about this strategy
   - `seeds = ["strategy", vault_state.key(), &strategy_count.to_le_bytes()]`

2. **Strategy Token Account PDA** — holds tokens allocated to this strategy
   - `seeds = ["strategy_token", vault_state.key(), &strategy_count.to_le_bytes()]`
   - `token::authority = vault_state` — vault PDA owns this account
   - After creation, delegate is set via `approve` CPI

**The approve CPI** — the key to multi-delegation:
```rust
// After creating the token account, approve the external protocol as delegate
let approve_accounts = Approve {
    to: strategy_token_account,         // the new token account
    delegate: delegate_address,          // Protocol A, B, C, etc.
    authority: vault_state,              // vault PDA is the owner
};
// Approve u64::MAX — the delegate can spend up to the full balance
// Risk is controlled by only funding the account with the intended allocation
token_interface::approve(cpi_ctx_with_signer, u64::MAX)?;
```

**Why u64::MAX for approve amount?** The delegate can only spend what's actually in the account. We control risk by how much we `allocate_to_strategy`, not by the approval amount. This avoids needing to re-approve after every partial spend.

**After creation**: `vault_state.strategy_count += 1` (next strategy gets ID = count)

---

### Step 6: `allocate_to_strategy(amount: u64)`

**In simple words**: The authority moves money from the main cash register into a strategy's pocket. Now the approved protocol can use those funds. The vault's total assets don't change — the money just moved from one internal account to another.

**Purpose**: Move funds from the reserve to a specific strategy's token account, making them available for the delegate to use.

**Who can call**: Authority only.

**What happens**:
1. Validate: strategy is active, reserve has enough
2. CPI `transfer_checked`: reserve ATA → strategy token account (vault PDA signs)
3. Update `strategy.allocated_amount += amount`
4. **`total_deposited` does NOT change** — the funds are still in the vault system, just moved to a different account

**Why vault PDA signs**: The vault PDA is the authority on BOTH the reserve ATA and the strategy token account. It signs via `with_signer(seeds)` using the vault PDA seeds.

**After allocation**: The delegate (external protocol) can now spend up to `strategy_token_account.amount` from this account using their own transaction signing.

---

### Step 7: `deallocate_from_strategy(amount: u64)`

**In simple words**: The authority pulls money back from a strategy pocket to the main cash register. Used when: users want to withdraw and the register is low, or the admin wants to rebalance. The protocol must have returned the funds first — you can't pull money that's already been lent out.

**Purpose**: Pull funds back from a strategy to the reserve. Used for rebalancing or preparing for user withdrawals.

**Who can call**: Authority only.

**What happens**:
1. Validate: strategy token account has enough, strategy.allocated_amount >= amount
2. CPI `transfer_checked`: strategy token account → reserve ATA (vault PDA signs)
3. Update `strategy.allocated_amount -= amount`

**Important caveat**: If the delegate (protocol) has already spent the tokens (sent them elsewhere for yield), this will fail due to insufficient balance. The protocol must return the funds before deallocation. This is expected behavior — yield strategies return funds, then authority deallocates.

---

### Step 8: `update_strategy_delegate(new_delegate: Pubkey)`

**In simple words**: The admin changes which protocol is allowed to spend from a strategy pocket. First removes permission from the old protocol (revoke), then grants it to the new one (approve). Like changing the lock on a safe and giving the new key to a different fund manager.

**Purpose**: Change which external protocol can spend from a strategy's token account.

**Who can call**: Admin only.

**What happens** (two CPIs):
1. `revoke`: Remove the current delegate from the strategy token account (vault PDA signs)
2. `approve`: Set the new delegate with u64::MAX allowance (vault PDA signs)
3. Update `strategy.delegate = new_delegate`

**Why revoke then approve**: Solana's SPL Token only allows one delegate at a time. You must revoke the old one before setting a new one. Both operations require the token account authority (vault PDA) to sign.

---

### Step 9: `deactivate_strategy`

**In simple words**: The admin shuts down a strategy completely. Takes back the key from the protocol (revoke), moves any remaining money back to the cash register, and marks it as permanently closed. You can't reopen it — create a new one instead.

**Purpose**: Shut down a strategy — revoke delegate, pull all remaining funds back to reserve, mark as inactive.

**Who can call**: Admin only.

**What happens**:
1. `revoke`: Remove delegate access (vault PDA signs)
2. If any tokens remain in the strategy token account, `transfer_checked` all of them back to reserve (vault PDA signs)
3. Set `strategy.is_active = false`
4. Set `strategy.allocated_amount = 0`

**After deactivation**: The strategy can no longer receive allocations. The token account still exists but has no delegate and no funds. The StrategyAllocation PDA remains on-chain (it's not closed) to preserve the ID sequence.

---

### Step 10: Evolve `lib.rs`

All vault instructions, account structs, data structs, and errors live in one file:

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, MintTo, Burn, TransferChecked, Approve, Revoke},
};

declare_id!("6B8tT1EzLMKUZ5fF5H8cTs4We1vLabVeZtgCnB4Ccmnq");

#[program]
pub mod my_project {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> { /* ... */ }
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> { /* ... */ }
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> { /* ... */ }
    pub fn create_strategy(ctx: Context<CreateStrategy>) -> Result<()> { /* ... */ }
    pub fn allocate_to_strategy(ctx: Context<AllocateToStrategy>, amount: u64) -> Result<()> { /* ... */ }
    pub fn deallocate_from_strategy(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> { /* ... */ }
    pub fn update_strategy_delegate(ctx: Context<UpdateStrategyDelegate>) -> Result<()> { /* ... */ }
    pub fn deactivate_strategy(ctx: Context<DeactivateStrategy>) -> Result<()> { /* ... */ }
}

#[error_code]
enum VaultError { /* ... */ }

// Account validation structs (one per instruction)
#[derive(Accounts)] pub struct InitializeVault<'info> { /* ... */ }
#[derive(Accounts)] pub struct Deposit<'info> { /* ... */ }
// ... etc

// Data account structs
#[account] #[derive(InitSpace)] pub struct VaultState { /* ... */ }
#[account] #[derive(InitSpace)] pub struct StrategyAllocation { /* ... */ }
```

---

## Key CPI Operations Reference

**In simple words**: CPI = Cross-Program Invocation = our program calling another program. Since Solana programs can't hold tokens directly, we need to call the SPL Token program to move tokens around. Each CPI needs someone to "authorize" it — either the user (who signed the transaction) or the vault PDA (which proves authority via its seeds).

| CPI | Used in | Who signs | Purpose |
|---|---|---|---|
| `transfer_checked` | deposit | User | User tokens → reserve |
| `mint_to` | deposit | Vault PDA | Mint shares to user |
| `burn` | withdraw | User | Burn user's shares |
| `transfer_checked` | withdraw | Vault PDA | Reserve → user tokens |
| `approve` | create_strategy | Vault PDA | Set delegate on strategy token account |
| `transfer_checked` | allocate | Vault PDA | Reserve → strategy token account |
| `transfer_checked` | deallocate | Vault PDA | Strategy token account → reserve |
| `revoke` | update_delegate, deactivate | Vault PDA | Remove delegate access |
| `transfer_checked` | deactivate | Vault PDA | Strategy → reserve (remaining funds) |

**PDA signing pattern** (used in all vault PDA-signed CPIs):
```rust
let token_mint_key = vault_state.token_mint;
let bump = vault_state.bump;
let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];
let cpi_ctx = CpiContext::new_with_signer(token_program, accounts, signer_seeds);
```

---

## Share Token Math — Edge Cases

**In simple words**: Share math is just "what percentage of the vault do you own?" If there are 1000 shares and you have 100, you own 10% of the vault. When you withdraw, you get 10% of everything in the vault — including any profits earned. Integer math means tiny rounding always favors the vault (you might get 0.000001 less), which prevents exploits.

| Scenario | Handling |
|---|---|
| First deposit (supply = 0) | shares = amount (1:1 ratio, no division) |
| Division by zero | Impossible after first deposit (total_deposited > 0) |
| Rounding on deposit | Integer truncation → user gets slightly fewer shares (vault benefits) |
| Rounding on withdraw | Integer truncation → user gets slightly less underlying (vault benefits) |
| Overflow | All arithmetic uses `checked_mul`/`checked_div` → returns `MathOverflow` error |
| Inflation attack (ERC-4626 classic) | Mitigated by first-deposit 1:1 ratio. For production, consider minting initial "dead shares" |

---

## Files to Modify

| File | Action |
|---|---|
| `programs/my_project/src/lib.rs` | All vault instructions, account structs, data structs, and errors in one file |
| `programs/my_project/Cargo.toml` | No changes needed (anchor-spl 0.32.1 has everything) |
| `tests/my_project.ts` | Full rewrite with vault test suites |

---

## Test Plan

### Setup (before all tests)
- Create underlying token mint (6 decimals, simulating USDC)
- Generate keypairs: admin, authority, user1, user2, protocolA, protocolB
- Airdrop SOL to all keypairs

### Test Groups

**1. Vault Initialization**
- Successfully initializes vault with correct state fields
- Share mint has vault PDA as authority and correct decimals
- Reserve ATA is owned by vault PDA
- Fails if called twice with same token_mint (PDA already exists)

**2. Deposits**
- First deposit gives 1:1 shares
- Second deposit gives proportional shares
- Fails with zero amount
- Fails with insufficient user balance
- `total_deposited` updates correctly after each deposit

**3. Withdrawals**
- Burns shares, returns correct proportional underlying
- Full withdrawal (burn all shares)
- Fails if user has no shares
- Fails if reserve has insufficient balance (funds in strategies)

**4. Strategy Management**
- Admin creates strategy with delegate → strategy_count increments
- Non-admin cannot create strategy → `UnauthorizedAdmin` error
- Strategy token account has correct delegate after creation

**5. Allocation/Deallocation**
- Authority allocates from reserve to strategy → balances change, allocated_amount updates
- Authority deallocates from strategy to reserve → balances change back
- Non-authority cannot allocate → `UnauthorizedAuthority` error
- Fails if reserve insufficient for allocation

**6. Delegate Management**
- Update delegate on active strategy → old delegate revoked, new approved
- Cannot update delegate on inactive strategy → `StrategyInactive` error

**7. Strategy Deactivation**
- Deactivate pulls remaining funds back to reserve
- Strategy marked as inactive
- Cannot allocate to inactive strategy

**8. End-to-End Integration**
- Full flow: init → deposit → create strategy → allocate → deallocate → withdraw
- Multiple users deposit, verify share ratios
- Simulate yield by increasing total_deposited, verify withdrawal amounts

### Verification Commands
```bash
anchor build          # after each instruction is added
anchor test           # full end-to-end run
```
