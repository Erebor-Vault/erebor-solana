// mock_lulo — A minimal mock lending protocol for devnet testing.
//
// Simulates a lending protocol (like Lulo/FlexLend) that the Erebor vault's
// AI agent can interact with via execute_strategy_action. This program exists
// so the full CPI flow can be tested end-to-end on devnet:
//
//   Agent signs tx → Vault validates whitelist → Vault CPIs to mock_lulo → tokens move
//
// Two instructions:
//   deposit(amount)  — transfers tokens FROM strategy token account TO mock treasury
//   withdraw(amount) — transfers tokens FROM mock treasury BACK TO strategy token account
//
// The vault PDA is the authority on the strategy token account and signs the
// CPI via invoke_signed. For withdraw, the mock_lulo treasury PDA signs the
// reverse transfer via its own invoke_signed.
//
// Treasury PDA seeds: ["treasury", token_mint]
// This gives each token mint its own treasury account.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("ENccKNWkndfdG16WQY3xchEKGoF3MwXqF5SWueesThXE");

#[program]
pub mod mock_lulo {
    use super::*;

    // Initialize the mock treasury for a given token mint.
    // Must be called once before deposit/withdraw can work.
    // Creates a PDA-owned token account that holds "lent" tokens.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        msg!(
            "Mock Lulo treasury initialized for mint {:?}",
            ctx.accounts.mint.key()
        );
        Ok(())
    }

    // Deposit: move tokens from strategy token account → mock treasury.
    // The vault PDA must sign this transaction (it's the authority on the
    // strategy token account). This happens automatically because the vault
    // program calls invoke_signed when routing through execute_strategy_action.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, MockLuloError::ZeroAmount);

        // Transfer tokens: strategy_token_account → treasury
        // Authority: vault PDA (passed as signer by the vault's invoke_signed)
        let cpi_accounts = Transfer {
            from: ctx.accounts.strategy_token_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, amount)?;

        msg!("Mock Lulo: deposited {} tokens", amount);
        Ok(())
    }

    // Withdraw: move tokens from mock treasury → strategy token account.
    // The treasury PDA is owned by the mock_lulo program, so mock_lulo
    // signs the transfer with its own PDA seeds.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, MockLuloError::ZeroAmount);
        require!(
            ctx.accounts.treasury.amount >= amount,
            MockLuloError::InsufficientTreasury
        );

        // Transfer tokens: treasury → strategy_token_account
        // Authority: treasury PDA (mock_lulo program signs via invoke_signed)
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.treasury],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(), // treasury PDA is its own authority
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        msg!("Mock Lulo: withdrew {} tokens", amount);
        Ok(())
    }
}

// --- Account structs ---

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: Account<'info, Mint>,

    // Treasury token account PDA — owned by this program.
    // Seeds: ["treasury", mint] so each token gets its own treasury.
    #[account(
        init,
        payer = payer,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = treasury, // self-referential: treasury PDA is its own authority
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    // Strategy's token account — vault PDA is authority (signs via invoke_signed).
    #[account(mut)]
    pub strategy_token_account: Account<'info, TokenAccount>,

    // Mock treasury — receives deposited tokens.
    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: The vault PDA that signs the transfer (authority on strategy_token_account).
    /// Validated by the SPL Token program during the transfer CPI.
    pub vault_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    // Strategy's token account — receives withdrawn tokens.
    #[account(mut)]
    pub strategy_token_account: Account<'info, TokenAccount>,

    // Mock treasury — sends tokens back. Treasury PDA signs via invoke_signed.
    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: The vault PDA. Not used as signer for withdraw (treasury signs instead),
    /// but included for consistency with the deposit instruction layout.
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

// --- Errors ---

#[error_code]
pub enum MockLuloError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Treasury has insufficient tokens for withdrawal")]
    InsufficientTreasury,
}
