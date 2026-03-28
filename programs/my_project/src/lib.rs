// Import all common Anchor types: Context, Result, Account, Signer, msg!, etc.
use anchor_lang::prelude::*;

// Import SPL Token interface types — using token_interface (not token) to support
// both the classic Token program AND Token-2022 (token extensions).
//
// CPI struct types for vault operations (will be used in Phase 2 & 3):
// - MintTo: mint share tokens on deposit
// - Burn: burn share tokens on withdraw
// - TransferChecked: move tokens between accounts (with decimal verification)
// - Approve: set a delegate (allowance) on a strategy token account
// - Revoke: remove a delegate from a strategy token account
use anchor_spl::token_interface::{
    self, Approve, Burn, Mint, MintTo, Revoke, TokenAccount, TokenInterface,
};

// Associated Token Account program — creates deterministic token accounts
// derived from (wallet, mint). Needed for init of reserve ATA in initialize_vault.
use anchor_spl::associated_token::AssociatedToken;

// Unique on-chain address of this program (like a contract address in Solidity).
// Anchor verifies at runtime that the executing program matches this ID.
declare_id!("4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik");

#[program]
pub mod my_project {
    use super::*;

    // ============================================================
    // VAULT INSTRUCTIONS
    // ============================================================

    // Create the vault infrastructure.
    // Creates 3 accounts in one transaction:
    //   1. VaultState PDA — the vault's config
    //   2. Share Mint PDA — a new token that represents ownership of the vault
    //   3. Reserve ATA — the main token account where deposits land
    // Whoever calls this becomes the admin AND authority.
    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_id: u64) -> Result<()> {
        msg!("Initializing vault for mint: {:?}", ctx.accounts.token_mint.key());

        // Populate the vault state
        let vault = &mut ctx.accounts.vault_state;
        vault.admin = ctx.accounts.admin.key();
        vault.authority = ctx.accounts.admin.key(); // defaults to admin, can be changed later
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.vault_id = vault_id;
        vault.total_deposited = 0;
        vault.strategy_count = 0;
        vault.bump = ctx.bumps.vault_state;
        vault.share_mint_bump = ctx.bumps.share_mint;

        msg!("Vault initialized. Admin: {:?}", vault.admin);

        Ok(())
    }

    // Deposit tokens and receive shares.
    //
    // Share math:
    //   First deposit: shares = amount (1:1)
    //   After that:    shares = amount * total_shares / total_deposited
    //
    // Two CPIs:
    //   1. transfer: user tokens → reserve
    //   2. mint_to: share tokens → user (vault PDA signs)
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let share_supply = ctx.accounts.share_mint.supply;
        let total_deposited = ctx.accounts.vault_state.total_deposited;

        // Calculate how many shares to mint.
        // First deposit = 1:1 (no existing shares to calculate ratio against).
        // After that = proportional: you get shares based on current "exchange rate".
        // Example: vault has 1000 USDC and 1000 shares. You deposit 500 USDC.
        //          shares = 500 * 1000 / 1000 = 500 shares (each share = 1 USDC).
        // Example with yield: vault has 1200 USDC and 1000 shares (earned 200 profit).
        //          shares = 500 * 1000 / 1200 = 416 shares (each share = 1.2 USDC).
        let shares_to_mint = if share_supply == 0 {
            amount
        } else {
            amount * share_supply / total_deposited
        };

        // CPI 1: Transfer tokens from user → reserve ATA.
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.reserve_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        // CPI 2: Mint share tokens to user.
        // The vault PDA is the mint authority — it signs using with_signer.
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        let mint_accounts = MintTo {
            mint: ctx.accounts.share_mint.to_account_info(),
            to: ctx.accounts.user_share_token.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(), // vault PDA signs
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_accounts,
            signer_seeds,
        );
        token_interface::mint_to(cpi_ctx, shares_to_mint)?;

        // Update accounting
        ctx.accounts.vault_state.total_deposited += amount;

        msg!("Deposited {} tokens, minted {} shares", amount, shares_to_mint);

        Ok(())
    }

    // Burn shares and withdraw tokens.
    //
    // Withdrawal math:
    //   underlying = shares_to_burn * total_deposited / share_supply
    //
    // Two CPIs:
    //   1. burn: destroy user's shares (user signs)
    //   2. transfer: reserve → user (vault PDA signs)
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
        require!(shares_to_burn > 0, VaultError::ZeroAmount);

        let share_supply = ctx.accounts.share_mint.supply;
        let total_deposited = ctx.accounts.vault_state.total_deposited;

        // Calculate how many underlying tokens the shares are worth.
        // Example: you have 500 shares, vault has 1200 USDC and 1000 total shares.
        //          underlying = 500 * 1200 / 1000 = 600 USDC (you earned 100 profit!)
        let underlying_amount = shares_to_burn * total_deposited / share_supply;

        // Check that the reserve has enough tokens.
        // If too many funds are in strategies, this fails — authority must deallocate first.
        require!(
            ctx.accounts.reserve_ata.amount >= underlying_amount,
            VaultError::InsufficientReserve
        );

        // CPI 1: Burn the user's share tokens.
        // User signs because they own the shares.
        let burn_accounts = Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(), // user signs
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            burn_accounts,
        );
        token_interface::burn(cpi_ctx, shares_to_burn)?;

        // CPI 2: Transfer underlying tokens from reserve → user.
        // Vault PDA signs via with_signer.
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(), // vault PDA signs
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, underlying_amount)?;

        // Update accounting
        ctx.accounts.vault_state.total_deposited -= underlying_amount;

        msg!("Burned {} shares, withdrew {} tokens", shares_to_burn, underlying_amount);

        Ok(())
    }

    // ============================================================
    // STRATEGY INSTRUCTIONS
    // ============================================================

    // Create a new strategy with a delegate.
    // Admin creates a "pocket" (strategy token account) and approves an external protocol
    // (delegate) to spend from it. No funds are moved yet — that's allocate_to_strategy.
    //
    // Creates 2 accounts:
    //   1. StrategyAllocation PDA — metadata (who's the delegate, how much allocated, etc.)
    //   2. Strategy Token Account PDA — holds tokens for this strategy, vault PDA is authority
    //
    // Then does 1 CPI:
    //   approve: sets the delegate on the strategy token account (vault PDA signs)
    pub fn create_strategy(ctx: Context<CreateStrategy>) -> Result<()> {
        // Populate strategy metadata
        let strategy = &mut ctx.accounts.strategy;
        strategy.vault = ctx.accounts.vault_state.key();
        strategy.strategy_id = ctx.accounts.vault_state.strategy_count;
        strategy.delegate = ctx.accounts.delegate.key();
        strategy.allocated_amount = 0;
        strategy.token_account = ctx.accounts.strategy_token_account.key();
        strategy.is_active = true;
        strategy.target_weight_bps = 0;
        strategy.bump = ctx.bumps.strategy;

        // CPI: Approve the delegate on the strategy token account.
        // Vault PDA signs.
        // u64::MAX = unlimited allowance. Risk is controlled by how much we allocate, not the approval.
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        let approve_accounts = Approve {
            to: ctx.accounts.strategy_token_account.to_account_info(),
            delegate: ctx.accounts.delegate.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            approve_accounts,
            signer_seeds,
        );
        token_interface::approve(cpi_ctx, u64::MAX)?;

        // Increment strategy counter so next strategy gets a unique ID
        ctx.accounts.vault_state.strategy_count += 1;

        msg!(
            "Strategy {} created with delegate {:?}",
            strategy.strategy_id,
            strategy.delegate
        );

        Ok(())
    }

    // Move funds from reserve to a strategy's token account.
    // total_deposited does NOT change — funds are still in the vault system.
    pub fn allocate_to_strategy(ctx: Context<AllocateToStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // Vault PDA signs the transfer — same pattern as withdraw
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        // Track how much is in this strategy
        ctx.accounts.strategy.allocated_amount += amount;

        msg!("Allocated {} to strategy {}", amount, ctx.accounts.strategy.strategy_id);

        Ok(())
    }

    // Pull funds back from a strategy to the reserve.
    pub fn deallocate_from_strategy(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // Vault PDA signs — it's the authority on both accounts
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.strategy_token_account.to_account_info(),
            to: ctx.accounts.reserve_ata.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        ctx.accounts.strategy.allocated_amount -= amount;

        msg!("Deallocated {} from strategy {}", amount, ctx.accounts.strategy.strategy_id);

        Ok(())
    }

    // Change which protocol can spend from a strategy.
    // Two CPIs: revoke old delegate, approve new one. Same PDA signing pattern.
    pub fn update_strategy_delegate(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        // Revoke old delegate
        let revoke_accounts = Revoke {
            source: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            revoke_accounts,
            signer_seeds,
        );
        token_interface::revoke(cpi_ctx)?;

        // Approve new delegate
        let approve_accounts = Approve {
            to: ctx.accounts.strategy_token_account.to_account_info(),
            delegate: ctx.accounts.new_delegate.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            approve_accounts,
            signer_seeds,
        );
        token_interface::approve(cpi_ctx, u64::MAX)?;

        // Update the stored delegate
        ctx.accounts.strategy.delegate = ctx.accounts.new_delegate.key();

        msg!(
            "Strategy {} delegate updated to {:?}",
            ctx.accounts.strategy.strategy_id,
            ctx.accounts.strategy.delegate
        );

        Ok(())
    }

    // Report yield earned by a strategy.
    // Reads the actual token balance of the strategy token account, compares it
    // to the tracked allocated_amount. Any surplus is yield — updates both
    // allocated_amount and total_deposited so share price reflects the profit.
    pub fn report_yield(ctx: Context<ReportYield>) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        let actual_balance = ctx.accounts.strategy_token_account.amount;

        // Yield = actual balance - what we last tracked
        let yield_amount = actual_balance
            .checked_sub(strategy.allocated_amount)
            .ok_or(VaultError::InsufficientBalance)?;

        if yield_amount > 0 {
            ctx.accounts.vault_state.total_deposited += yield_amount;
            strategy.allocated_amount = actual_balance;

            msg!(
                "Reported yield of {} for strategy {}",
                yield_amount,
                strategy.strategy_id
            );
        }

        Ok(())
    }

    // Shut down a strategy permanently.
    // Revokes delegate, pulls all remaining funds back to reserve, marks inactive.
    pub fn deactivate_strategy(ctx: Context<DeactivateStrategy>) -> Result<()> {
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        // Revoke delegate access
        let revoke_accounts = Revoke {
            source: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            revoke_accounts,
            signer_seeds,
        );
        token_interface::revoke(cpi_ctx)?;

        // If there are remaining tokens, transfer them back to reserve
        let remaining = ctx.accounts.strategy_token_account.amount;
        if remaining > 0 {
            let cpi_accounts = anchor_spl::token::Transfer {
                from: ctx.accounts.strategy_token_account.to_account_info(),
                to: ctx.accounts.reserve_ata.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, remaining)?;
        }

        // Mark as permanently inactive
        ctx.accounts.strategy.is_active = false;
        ctx.accounts.strategy.allocated_amount = 0;
        ctx.accounts.strategy.target_weight_bps = 0;

        msg!("Strategy {} deactivated", ctx.accounts.strategy.strategy_id);

        Ok(())
    }

    // ============================================================
    // ADMIN MANAGEMENT INSTRUCTIONS
    // ============================================================

    // Transfer admin role to a new address. Only current admin can call.
    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.vault_state.admin = new_admin;
        msg!("Admin transferred to {:?}", new_admin);
        Ok(())
    }

    // Change the authority (operational role) to a new address. Only admin can call.
    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.vault_state.authority = new_authority;
        msg!("Authority set to {:?}", new_authority);
        Ok(())
    }

    // ============================================================
    // AUTOMATED REBALANCING INSTRUCTIONS
    // ============================================================

    // Set target allocation weight for a strategy (admin only).
    // weight_bps is in basis points: 5000 = 50% of total_deposited.
    // Weights across all strategies do NOT need to sum to 10000 — the remainder stays in reserve.
    pub fn set_strategy_weight(ctx: Context<SetStrategyWeight>, weight_bps: u16) -> Result<()> {
        require!(weight_bps <= 10000, VaultError::WeightExceedsMax);
        ctx.accounts.strategy.target_weight_bps = weight_bps;
        msg!(
            "Strategy {} weight set to {} bps",
            ctx.accounts.strategy.strategy_id,
            weight_bps
        );
        Ok(())
    }

    // Rebalance a single strategy to match its target weight.
    // Calculates: target = total_deposited * target_weight_bps / 10000
    // Then allocates or deallocates the difference. Authority signs.
    // Backend should process deallocations before allocations to ensure reserve has funds.
    pub fn rebalance_strategy(ctx: Context<RebalanceStrategy>) -> Result<()> {
        // Read all needed values upfront to avoid borrow conflicts
        let strategy_id = ctx.accounts.strategy.strategy_id;
        let weight_bps = ctx.accounts.strategy.target_weight_bps;
        let current = ctx.accounts.strategy.allocated_amount;
        let total_deposited = ctx.accounts.vault_state.total_deposited;
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
        let bump = ctx.accounts.vault_state.bump;

        // u128 intermediate to prevent overflow on large deposits
        let target_amount = (total_deposited as u128)
            .checked_mul(weight_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64;

        if target_amount == current {
            msg!("Strategy {} already at target", strategy_id);
            return Ok(());
        }

        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

        if target_amount > current {
            // Allocate more: reserve → strategy
            let delta = target_amount - current;
            require!(
                ctx.accounts.reserve_ata.amount >= delta,
                VaultError::InsufficientReserveForRebalance
            );

            let cpi_accounts = anchor_spl::token::Transfer {
                from: ctx.accounts.reserve_ata.to_account_info(),
                to: ctx.accounts.strategy_token_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, delta)?;

            ctx.accounts.strategy.allocated_amount = target_amount;
            msg!("Rebalanced strategy {}: allocated {} more", strategy_id, delta);
        } else {
            // Deallocate: strategy → reserve
            let delta = current - target_amount;

            let cpi_accounts = anchor_spl::token::Transfer {
                from: ctx.accounts.strategy_token_account.to_account_info(),
                to: ctx.accounts.reserve_ata.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, delta)?;

            ctx.accounts.strategy.allocated_amount = target_amount;
            msg!("Rebalanced strategy {}: deallocated {}", strategy_id, delta);
        }

        Ok(())
    }
}

// ============================================================
// ERROR CODES
// ============================================================
// Custom error codes for the vault program.
// These show up in transaction logs and can be matched client-side.
// Usage: require!(condition, VaultError::SomeError)
// Usage in constraints: constraint = ... @ VaultError::SomeError
#[error_code]
pub enum VaultError {
    // Source token account doesn't have enough tokens.
    #[msg("Insufficient balance in source account")]
    InsufficientBalance,

    // Reserve ATA doesn't have enough for withdrawal.
    // Happens when too many funds are in strategies — authority must deallocate first.
    #[msg("Insufficient reserve for withdrawal")]
    InsufficientReserve,

    // Trying to use a deactivated strategy. Once deactivated, it's permanent.
    #[msg("Strategy is not active")]
    StrategyInactive,

    // Signer is not the vault admin.
    // Admin-only: create_strategy, update_strategy_delegate, deactivate_strategy.
    #[msg("Unauthorized: not admin")]
    UnauthorizedAdmin,

    // Signer is not the vault authority.
    // Authority-only: allocate_to_strategy, deallocate_from_strategy.
    #[msg("Unauthorized: not authority")]
    UnauthorizedAuthority,

    // Token mint doesn't match what's stored in vault state.
    #[msg("Invalid token mint")]
    InvalidMint,

    // Deposit/withdraw amount must be > 0.
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    // Strategy weight exceeds maximum of 10000 basis points (100%).
    #[msg("Weight exceeds maximum of 10000 basis points")]
    WeightExceedsMax,

    // Reserve doesn't have enough tokens to cover the rebalance allocation.
    #[msg("Insufficient reserve for rebalance allocation")]
    InsufficientReserveForRebalance,
}

// ============================================================
// ACCOUNT VALIDATION STRUCTS
// ============================================================

// Accounts for `initialize_vault` — creates the vault infrastructure.
#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVault<'info> {
    // The admin who pays for account creation. Becomes vault admin + authority.
    #[account(mut)]
    pub admin: Signer<'info>,

    // The vault's main config PDA.
    // Seeds use token_mint + vault_id so multiple vaults can exist per token type.
    #[account(
        init,
        payer = admin,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", token_mint.key().as_ref(), &vault_id.to_le_bytes()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    // The underlying token (e.g. USDC). Already exists — we just reference it.
    // Not mut because we don't modify the mint itself.
    pub token_mint: InterfaceAccount<'info, Mint>,

    // The share token mint — created as a PDA owned by the vault.
    // mint::authority = vault_state means only the vault program can mint/burn shares.
    // mint::decimals matches the underlying token for consistent math.
    #[account(
        init,
        payer = admin,
        seeds = [b"shares", vault_state.key().as_ref()],
        bump,
        mint::decimals = token_mint.decimals,
        mint::authority = vault_state,
        mint::token_program = token_program,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    // The main reserve token account — where all deposits land.
    // Owned by the vault PDA (associated_token::authority = vault_state).
    #[account(
        init,
        payer = admin,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    // Required programs.
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// Accounts for `deposit` — user sends tokens, receives shares.
#[derive(Accounts)]
pub struct Deposit<'info> {
    // The depositor — signs the token transfer.
    #[account(mut)]
    pub user: Signer<'info>,

    // The vault config — mut because we update total_deposited.
    // Seeds validated to ensure we're using the correct vault.
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    // The underlying token mint — constraint ensures it matches the vault's token.
    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    // The share token mint — mut because supply changes when we mint shares.
    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    // User's token account (source of deposit tokens).
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    // The vault's reserve — destination for deposited tokens.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    // User's share token account — init_if_needed creates it if the user hasn't deposited before.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_share_token: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// Accounts for `withdraw` — user burns shares, receives tokens.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    // The withdrawer — signs the share burn.
    #[account(mut)]
    pub user: Signer<'info>,

    // The vault config — mut because we update total_deposited.
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    // The underlying token mint.
    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    // The share mint — mut because supply changes when we burn shares.
    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    // User's underlying token account — receives withdrawn tokens.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    // The vault's reserve — source of withdrawn tokens (vault PDA signs).
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    // User's share token account — shares are burned from here.
    #[account(
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_share_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================================
// STRATEGY ACCOUNT VALIDATION STRUCTS
// ============================================================

// Accounts for `create_strategy` — admin creates a new strategy + token account + sets delegate.
// Creates 2 new accounts (strategy PDA + strategy token account PDA).
#[derive(Accounts)]
pub struct CreateStrategy<'info> {
    // Admin must sign — constraint checks they match vault_state.admin
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    // New strategy metadata PDA — seeds include strategy_count for unique ID
    #[account(
        init,
        payer = admin,
        space = 8 + StrategyAllocation::INIT_SPACE,
        seeds = [b"strategy", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    // The underlying token mint — must match the vault's token
    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    // New token account for this strategy — owned by vault PDA.
    // This is the "pocket" that the delegate can spend from.
    #[account(
        init,
        payer = admin,
        seeds = [b"strategy_token", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = vault_state,
        token::token_program = token_program,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: The external protocol address to approve as delegate. Just a pubkey, no validation needed.
    pub delegate: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

// Accounts for `allocate_to_strategy` — authority moves funds from reserve → strategy.
#[derive(Accounts)]
pub struct AllocateToStrategy<'info> {
    // Authority must sign — the operational role that moves funds
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    // Reserve — source of funds
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    // Strategy token account — destination
    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

// Accounts for `deallocate_from_strategy` — authority moves funds from strategy → reserve.
// Same as AllocateToStrategy but transfer goes the other direction.
#[derive(Accounts)]
pub struct DeallocateFromStrategy<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

// Accounts for `update_strategy_delegate` — admin changes which protocol can spend.
#[derive(Accounts)]
pub struct UpdateStrategyDelegate<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: New delegate address. Just a pubkey, no validation needed.
    pub new_delegate: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

// Accounts for `report_yield` — authority reports yield earned by a strategy.
// Compares actual token balance to tracked allocated_amount and updates accounting.
#[derive(Accounts)]
pub struct ReportYield<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,
}

// Accounts for `deactivate_strategy` — admin shuts down a strategy permanently.
#[derive(Accounts)]
pub struct DeactivateStrategy<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

// Accounts for `transfer_admin` — current admin transfers admin role.
#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}

// Accounts for `set_authority` — admin changes the operational authority.
#[derive(Accounts)]
pub struct SetAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}

// Accounts for `set_strategy_weight` — admin sets target allocation weight.
#[derive(Accounts)]
pub struct SetStrategyWeight<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,
}

// Accounts for `rebalance_strategy` — authority rebalances a strategy to its target weight.
// Same accounts as AllocateToStrategy since rebalance may move funds in either direction.
#[derive(Accounts)]
pub struct RebalanceStrategy<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================================
// DATA ACCOUNTS
// ============================================================

/// VaultState — the main configuration account for a vault.
///
/// Seeds: ["vault", token_mint.key()]
/// One vault per token mint — a USDC vault and a USDT vault get separate PDAs.
///
/// Seeds derive a unique address, bump is stored for efficient re-derivation.
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    /// The admin — can create/deactivate strategies and change delegates.
    /// Set to whoever calls initialize_vault. Like Ownable's owner in Solidity.
    pub admin: Pubkey, // 32 bytes

    /// The operational authority — can allocate/deallocate funds between reserve and strategies.
    /// Separated from admin so a bot can rebalance without admin privileges.
    pub authority: Pubkey, // 32 bytes

    /// The accepted deposit token mint (e.g. USDC).
    /// The vault only accepts this token — like a single-asset ERC-4626 vault.
    pub token_mint: Pubkey, // 32 bytes

    /// The vault's share token mint (created as a PDA during initialize_vault).
    /// Only this program can mint/burn shares (vault PDA = mint authority).
    pub share_mint: Pubkey, // 32 bytes

    /// Unique vault ID — allows multiple vaults for the same token mint.
    /// Included in the PDA seeds: ["vault", token_mint, vault_id].
    pub vault_id: u64, // 8 bytes

    /// Total underlying tokens in the vault (reserve + all strategies).
    /// This is the ACCOUNTING total — doesn't change when funds move to strategies.
    /// Only changes on deposit (+) and withdraw (-).
    /// Tracks total vault assets.
    pub total_deposited: u64, // 8 bytes

    /// Auto-incrementing strategy ID counter (0, 1, 2, ...).
    /// Only goes up — deactivated strategies keep their IDs to prevent seed collisions.
    pub strategy_count: u64, // 8 bytes

    /// PDA bump. Stored so we don't recalculate it every time we need PDA signing.
    pub bump: u8, // 1 byte

    /// PDA bump for the share_mint account.
    pub share_mint_bump: u8, // 1 byte
}
// Total: 32*4 + 8*3 + 1*2 = 154 bytes
// On-chain space: 8 (discriminator) + 154 = 162 bytes

/// StrategyAllocation — metadata for a single strategy.
///
/// Seeds: ["strategy", vault_state.key(), &strategy_id.to_le_bytes()]
/// Each strategy = one "pocket" where the vault can delegate tokens to an external protocol.
///
/// This is the workaround for Solana's 1-delegate-per-account limitation:
/// instead of one account with multiple delegates (impossible),
/// we create multiple accounts each with one delegate.
///
/// Think of it like: you can't give 3 people a key to the same safe,
/// but you CAN create 3 safes and give one key each.
#[account]
#[derive(InitSpace)]
pub struct StrategyAllocation {
    /// Back-reference to the VaultState this strategy belongs to.
    pub vault: Pubkey, // 32 bytes

    /// Unique sequential ID (0, 1, 2, ...). Part of the PDA seeds.
    pub strategy_id: u64, // 8 bytes

    /// The external protocol address approved as delegate on this strategy's token account.
    /// This protocol can spend tokens up to the account balance.
    /// Like calling IERC20.approve(protocol, amount) in Solidity.
    pub delegate: Pubkey, // 32 bytes

    /// How many tokens are currently allocated to this strategy.
    /// Tracked separately because the delegate might have spent some.
    pub allocated_amount: u64, // 8 bytes

    /// The PDA token account holding this strategy's tokens.
    /// Seeds: ["strategy_token", vault_state, strategy_id].
    /// Owned by vault PDA, with delegate set to the external protocol.
    pub token_account: Pubkey, // 32 bytes

    /// Whether this strategy is active. Once deactivated, it's permanent.
    pub is_active: bool, // 1 byte

    /// Target allocation weight in basis points (0-10000). E.g., 5000 = 50% of total_deposited.
    /// Used by rebalance_strategy to automatically calculate target allocation.
    /// Weights across all strategies do NOT need to sum to 10000 — the remainder stays in reserve.
    pub target_weight_bps: u16, // 2 bytes

    /// PDA bump.
    pub bump: u8, // 1 byte
}
// Total: 32*3 + 8*2 + 2 + 1*2 = 116 bytes
// On-chain space: 8 (discriminator) + 116 = 124 bytes
