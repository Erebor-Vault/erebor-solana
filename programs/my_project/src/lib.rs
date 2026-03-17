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
declare_id!("6B8tT1EzLMKUZ5fF5H8cTs4We1vLabVeZtgCnB4Ccmnq");

// #[program] marks this module as the instruction entry point.
// Each pub fn becomes a callable instruction (like public functions in a Solidity contract).
// Anchor auto-generates the routing/dispatch logic.
#[program]
pub mod my_project {
    use super::*;

    // INSTRUCTION 1: Create a new counter PDA for the signer.
    // Context<Initialize> = Anchor validates all accounts in the Initialize struct
    // BEFORE this function runs. If any check fails, this code never executes.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // msg! logs to transaction logs (like console.log / Solidity events).
        // Visible in explorer or `solana logs`.
        msg!("Greetings from: {:?}", ctx.program_id);
        msg!("Signer {:?}", ctx.accounts.signer.key());

        // Set initial counter value. Anchor auto-serializes back to the account on return.
        ctx.accounts.counter.value = 0;
        // Store the PDA bump so we don't recalculate it in future instructions (saves compute).
        // A bump is a byte (0-255) that makes the PDA a valid off-curve point on ed25519.
        ctx.accounts.counter.bump = ctx.bumps.counter;

        Ok(())
    }

    // INSTRUCTION 2: Increment counter + transfer tokens from user to counter PDA.
    // The signer (user) authorizes the transfer since they own the source token account.
    pub fn increment(ctx: Context<Increment>, increment_by: u64) -> Result<()> {
        msg!(
            "Value incremented by {:?} for {:?}",
            increment_by,
            ctx.accounts.signer.key()
        );

        // Business logic check — like Solidity's require(balance >= amount, "insufficient")
        require!(
            ctx.accounts.source_token_account.amount >= increment_by,
            MyErrors::AmountTooSmall
        );

        // Update counter state
        ctx.accounts.counter.value += increment_by;

        // CPI (Cross-Program Invocation) = calling another on-chain program.
        // Like Solidity's IERC20(token).transferFrom(from, to, amount).
        // Here we call SPL Token's transfer instruction.
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.source_token_account.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            // The signer (user) is the authority — they signed the tx so they can authorize.
            authority: ctx.accounts.signer.to_account_info(),
        };

        // CpiContext bundles the target program + accounts (like building an external call in Solidity)
        let cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        // Execute the transfer. ? propagates errors (like revert in Solidity).
        anchor_spl::token::transfer(cpi_context, increment_by)?;

        Ok(())
    }

    // INSTRUCTION 3: Decrement counter + transfer tokens FROM the counter PDA back to user.
    // Key difference from increment: the PDA (not the user) owns the source tokens,
    // so we need PDA signing via seeds (with_signer) — the PDA has no private key,
    // so the runtime derives the address from seeds and verifies it matches.
    pub fn decrement(ctx: Context<Decrement>, decrement_by: u64) -> Result<()> {
        msg!(
            "Value decrement by {:?} for {:?}",
            decrement_by,
            ctx.accounts.signer.key()
        );

        require!(
            ctx.accounts.source_token_account.amount >= decrement_by,
            MyErrors::AmountTooSmall
        );

        ctx.accounts.counter.value -= decrement_by;

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.source_token_account.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            // The counter PDA is the authority here (it owns the source token account).
            // PDAs can't sign like normal wallets — we use with_signer() below.
            authority: ctx.accounts.counter.to_account_info(),
        };

        // PDA signing: reconstruct the seeds used to derive the PDA address.
        // The Solana runtime verifies these seeds produce the correct PDA,
        // effectively "proving" the program has authority over this account.
        // This is unique to Solana — in Solidity, contracts can call other contracts directly.
        let bump = ctx.accounts.counter.bump;
        let signer_key = ctx.accounts.signer.key();
        let bind_bump = &[bump];

        // Seeds must match exactly what was used in #[account(seeds=[...])]
        let seeds = &[&[b"counter", signer_key.as_ref(), bind_bump][..]];

        // with_signer(seeds) tells the runtime: "this PDA is signing this CPI"
        let cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts)
                .with_signer(seeds);

        anchor_spl::token::transfer(cpi_context, decrement_by)?;

        Ok(())
    }

    // ============================================================
    // VAULT INSTRUCTIONS (Phase 2)
    // ============================================================

    // VAULT INSTRUCTION 1: Create the vault infrastructure.
    // Creates 3 accounts in one transaction:
    //   1. VaultState PDA — the vault's config (like deploying a contract)
    //   2. Share Mint PDA — a new token that represents ownership of the vault
    //   3. Reserve ATA — the main token account where deposits land
    // Whoever calls this becomes the admin AND authority.
    // Similar to initialize() above but creates more accounts.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        msg!("Initializing vault for mint: {:?}", ctx.accounts.token_mint.key());

        // Populate the vault state — same pattern as setting counter.value and counter.bump
        let vault = &mut ctx.accounts.vault_state;
        vault.admin = ctx.accounts.admin.key();
        vault.authority = ctx.accounts.admin.key(); // defaults to admin, can be changed later
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.total_deposited = 0;
        vault.strategy_count = 0;
        vault.bump = ctx.bumps.vault_state;
        vault.share_mint_bump = ctx.bumps.share_mint;

        msg!("Vault initialized. Admin: {:?}", vault.admin);

        Ok(())
    }

    // VAULT INSTRUCTION 2: Deposit tokens and receive shares.
    // Similar to increment() — user sends tokens to the vault (like increment sends to counter PDA).
    // NEW: also mints share tokens to the user (proportional to their deposit).
    //
    // Share math:
    //   First deposit: shares = amount (1:1)
    //   After that:    shares = amount * total_shares / total_deposited
    //
    // Two CPIs:
    //   1. transfer_checked: user tokens → reserve (user signs, like increment)
    //   2. mint_to: share tokens → user (vault PDA signs, like decrement's with_signer pattern)
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
        // Same pattern as increment's transfer.
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.reserve_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(), // user signs (like increment)
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        // CPI 2: Mint share tokens to user.
        // The vault PDA is the mint authority — it signs using with_signer (like decrement).
        // This is the NEW part compared to increment — increment doesn't mint anything.
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

        // Update accounting — same pattern as counter.value += increment_by
        ctx.accounts.vault_state.total_deposited += amount;

        msg!("Deposited {} tokens, minted {} shares", amount, shares_to_mint);

        Ok(())
    }

    // VAULT INSTRUCTION 3: Burn shares and withdraw tokens.
    // Similar to decrement() — vault PDA sends tokens back to user (PDA signs via with_signer).
    // NEW: also burns the user's share tokens first.
    //
    // Withdrawal math:
    //   underlying = shares_to_burn * total_deposited / share_supply
    //
    // Two CPIs:
    //   1. burn: destroy user's shares (user signs — they're burning their own tokens)
    //   2. transfer: reserve → user (vault PDA signs, exactly like decrement)
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
        // User signs because they own the shares (like how user signs in increment).
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
        // Vault PDA signs — exactly the same pattern as decrement's with_signer.
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

        // Update accounting — same pattern as counter.value -= decrement_by
        ctx.accounts.vault_state.total_deposited -= underlying_amount;

        msg!("Burned {} shares, withdrew {} tokens", shares_to_burn, underlying_amount);

        Ok(())
    }

    // ============================================================
    // STRATEGY INSTRUCTIONS (Phase 3)
    // ============================================================

    // STRATEGY INSTRUCTION 1: Create a new strategy with a delegate.
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
        strategy.bump = ctx.bumps.strategy;

        // CPI: Approve the delegate on the strategy token account.
        // Same PDA signing pattern as decrement/withdraw — vault PDA signs.
        // u64::MAX = unlimited allowance. Risk is controlled by how much we allocate, not the approval.
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

    // STRATEGY INSTRUCTION 2: Move funds from reserve to a strategy's token account.
    // Same pattern as deposit's transfer (vault PDA signs to move tokens from reserve),
    // but destination is a strategy account instead of staying in reserve.
    // total_deposited does NOT change — funds are still in the vault system.
    pub fn allocate_to_strategy(ctx: Context<AllocateToStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // Vault PDA signs the transfer — same pattern as withdraw
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

    // STRATEGY INSTRUCTION 3: Pull funds back from a strategy to the reserve.
    // Reverse of allocate — same transfer pattern but strategy → reserve.
    pub fn deallocate_from_strategy(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // Vault PDA signs — it's the authority on both accounts
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

    // STRATEGY INSTRUCTION 4: Change which protocol can spend from a strategy.
    // Two CPIs: revoke old delegate, approve new one. Same PDA signing pattern.
    pub fn update_strategy_delegate(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

    // STRATEGY INSTRUCTION 5: Shut down a strategy permanently.
    // Revokes delegate, pulls all remaining funds back to reserve, marks inactive.
    pub fn deactivate_strategy(ctx: Context<DeactivateStrategy>) -> Result<()> {
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

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

        msg!("Strategy {} deactivated", ctx.accounts.strategy.strategy_id);

        Ok(())
    }
}

// Custom error codes for the counter (legacy).
#[error_code]
enum MyErrors {
    AmountTooSmall,
}

// ============================================================
// VAULT ERROR CODES (Phase 1)
// ============================================================
// Custom error codes for the vault program.
// Each variant gets a unique error code (starting after MyErrors).
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
}

// ============================================================
// ACCOUNT VALIDATION STRUCTS
// ============================================================
// #[derive(Accounts)] auto-generates deserialization + constraint checking.
// All checks run BEFORE the instruction handler. Failed check = transaction reverts.
// Think of these as Solidity modifiers applied to the function.

// Accounts for `initialize` — creates a new counter PDA
#[derive(Accounts)]
pub struct Initialize<'info> {
    // Signer<'info> = must have signed the transaction. mut = writable (pays for account creation).
    #[account(mut)]
    pub signer: Signer<'info>,

    // The counter PDA to create:
    // - init: allocate + assign ownership to this program
    // - payer = signer: signer pays the rent-exempt deposit
    // - space = 8 + struct_size: 8 bytes for Anchor's discriminator (type tag) + data
    // - seeds: deterministic address from ["counter", signer_pubkey]
    //   Each signer gets a unique counter (like mapping(address => Counter) in Solidity)
    // - bump: Anchor finds the canonical bump automatically
    #[account(
        init,
        payer = signer,
        space = 8 + Counter::INIT_SPACE,
        seeds=[b"counter", signer.key().to_bytes().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,

    // Required for account creation (init). Solana's built-in program for creating accounts.
    pub system_program: Program<'info, System>,
}

// Accounts for `increment` — user sends tokens TO the counter PDA
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    // Existing counter PDA. Same seeds as Initialize to find the same account.
    // bump = counter.bump: use stored bump instead of recalculating (saves ~1000 compute units).
    #[account(
        mut,
        seeds=[b"counter", signer.key().to_bytes().as_ref()],
        bump = counter.bump
    )]
    pub counter: Account<'info, Counter>,

    // User's ATA (Associated Token Account) for the given mint — source of tokens.
    // associated_token constraints verify this is the correct ATA for (signer, mint).
    // Like checking balanceOf[msg.sender] for a specific ERC-20.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = signer,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    // Counter PDA's ATA — destination for tokens. Owned by the PDA itself.
    // This is why decrement needs PDA signing: only the PDA can authorize transfers out.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = counter,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    // The token mint — defines which token (like an ERC-20 contract address).
    // Not mut because we're not minting/burning, just transferring.
    pub token_mint: InterfaceAccount<'info, Mint>,

    // SPL Token program that processes the transfer CPI.
    // Interface<TokenInterface> accepts both Token and Token-2022.
    pub token_program: Interface<'info, TokenInterface>,
}

// Accounts for `decrement` — counter PDA sends tokens BACK to the user.
// Mirror of Increment but source/destination are swapped:
// - source = counter PDA's ATA (authority = counter)
// - destination = user's ATA (authority = signer)
#[derive(Accounts)]
pub struct Decrement<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds=[b"counter", signer.key().to_bytes().as_ref()],
        bump = counter.bump
    )]
    pub counter: Account<'info, Counter>,

    // Source = counter PDA's token account (PDA is the authority).
    // The PDA will sign the transfer via with_signer() in the handler.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = counter,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    // Destination = user's token account (user is the authority).
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = signer,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================================
// VAULT ACCOUNT VALIDATION STRUCTS (Phase 2)
// ============================================================
// Same pattern as Initialize/Increment/Decrement above —
// each struct defines which accounts the instruction needs and what checks to run.

// Accounts for `initialize_vault` — creates the vault infrastructure.
// Compare to Initialize: same pattern (init + seeds + payer) but creates 3 accounts instead of 1.
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    // The admin who pays for account creation. Becomes vault admin + authority.
    // Same as `signer` in Initialize — must sign and is mut because they pay.
    #[account(mut)]
    pub admin: Signer<'info>,

    // The vault's main config PDA.
    // Same pattern as counter PDA: init + seeds + payer + space.
    // Seeds use token_mint so there's one vault per token type.
    #[account(
        init,
        payer = admin,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    // The underlying token (e.g. USDC). Already exists — we just reference it.
    // Not mut because we don't modify the mint itself.
    pub token_mint: InterfaceAccount<'info, Mint>,

    // The share token mint — created as a PDA owned by the vault.
    // mint::authority = vault_state means only the vault program can mint/burn shares.
    // mint::decimals matches the underlying token for consistent math.
    // This is NEW — the counter didn't have its own token.
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
    // Same concept as the counter PDA's ATA in Increment/Decrement,
    // but this one belongs to the vault instead of a counter.
    #[account(
        init,
        payer = admin,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    // Required programs — same as Initialize but with token + associated_token added.
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// Accounts for `deposit` — user sends tokens, receives shares.
// Combines patterns from Increment (user→PDA transfer) with NEW share minting.
#[derive(Accounts)]
pub struct Deposit<'info> {
    // The depositor — signs the token transfer (like signer in Increment).
    #[account(mut)]
    pub user: Signer<'info>,

    // The vault config — mut because we update total_deposited.
    // Seeds validated to ensure we're using the correct vault.
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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

    // User's token account (source) — same pattern as source_token_account in Increment.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    // The vault's reserve — same pattern as destination_token_account in Increment.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    // User's share token account — init_if_needed creates it if the user hasn't deposited before.
    // This is NEW — the counter didn't issue any tokens to the user.
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
// Combines patterns from Decrement (PDA→user transfer with PDA signing) with NEW share burning.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    // The withdrawer — signs the share burn.
    #[account(mut)]
    pub user: Signer<'info>,

    // The vault config — mut because we update total_deposited.
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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
    // Same pattern as destination_token_account in Decrement.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    // The vault's reserve — source of withdrawn tokens.
    // Same pattern as source_token_account in Decrement (PDA signs the transfer).
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
// STRATEGY ACCOUNT VALIDATION STRUCTS (Phase 3)
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
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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

// Accounts for `deactivate_strategy` — admin shuts down a strategy permanently.
#[derive(Accounts)]
pub struct DeactivateStrategy<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
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

// ============================================================
// LEGACY DATA ACCOUNTS
// ============================================================

// On-chain data stored in the counter PDA (legacy — kept for reference).
// #[account] adds an 8-byte discriminator (hash of "account:Counter") to prevent type confusion.
// #[derive(InitSpace)] auto-calculates size: u64 (8 bytes) + u8 (1 byte) = 9 bytes.
#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub value: u64, // the counter value
    pub bump: u8,   // stored PDA bump for efficient re-derivation
}

// ============================================================
// VAULT DATA ACCOUNTS (Phase 1)
// ============================================================
// These define the on-chain data layout for vault PDA accounts.
// Same pattern as Counter above — #[account] adds an 8-byte discriminator,
// #[derive(InitSpace)] auto-calculates byte size for space = 8 + Struct::INIT_SPACE.

/// VaultState — the main configuration account for a vault.
///
/// Seeds: ["vault", token_mint.key()]
/// One vault per token mint — a USDC vault and a USDT vault get separate PDAs.
///
/// This is like the counter's PDA but stores vault config instead of a simple value.
/// Same pattern: seeds derive a unique address, bump is stored for efficient re-derivation.
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

    /// Total underlying tokens in the vault (reserve + all strategies).
    /// This is the ACCOUNTING total — doesn't change when funds move to strategies.
    /// Only changes on deposit (+) and withdraw (-).
    /// Same concept as counter.value but tracks total vault assets.
    pub total_deposited: u64, // 8 bytes

    /// Auto-incrementing strategy ID counter (0, 1, 2, ...).
    /// Only goes up — deactivated strategies keep their IDs to prevent seed collisions.
    pub strategy_count: u64, // 8 bytes

    /// PDA bump — same pattern as counter.bump.
    /// Stored so we don't recalculate it every time we need PDA signing (~1000 CU saved).
    pub bump: u8, // 1 byte

    /// PDA bump for the share_mint account.
    pub share_mint_bump: u8, // 1 byte
}
// Total: 32*4 + 8*2 + 1*2 = 146 bytes
// On-chain space: 8 (discriminator) + 146 = 154 bytes

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

    /// PDA bump — same pattern as counter.bump and vault_state.bump.
    pub bump: u8, // 1 byte
}
// Total: 32*3 + 8*2 + 1*2 = 114 bytes
// On-chain space: 8 (discriminator) + 114 = 122 bytes
