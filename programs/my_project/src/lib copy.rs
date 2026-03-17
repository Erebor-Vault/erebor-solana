// Import all common Anchor types: Context, Result, Account, Signer, msg!, etc.
use anchor_lang::prelude::*;
// Import SPL Token interface types — using token_interface (not token) to support
// both the classic Token program AND Token-2022 (token extensions).
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

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
}

// Custom error codes — show up in transaction logs and can be matched client-side.
// Like Solidity's custom errors: error InsufficientBalance();
#[error_code]
enum MyErrors {
    AmountTooSmall,
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

// On-chain data stored in the counter PDA.
// #[account] adds an 8-byte discriminator (hash of "account:Counter") to prevent type confusion.
// #[derive(InitSpace)] auto-calculates size: u64 (8 bytes) + u8 (1 byte) = 9 bytes.
#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub value: u64, // the counter value
    pub bump: u8,   // stored PDA bump for efficient re-derivation
}
