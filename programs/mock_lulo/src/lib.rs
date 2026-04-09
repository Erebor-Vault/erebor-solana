// mock_lulo — A minimal mock lending protocol for devnet testing.
//
// Simulates a lending protocol (like Lulo/FlexLend) that the Erebor vault's
// AI agent can interact with via execute_strategy_action.
//
// Three instruction types:
//   initialize_treasury — creates the shared token treasury PDA per mint
//   initialize_position — creates a per-strategy position tracker
//   deposit(amount)     — moves tokens into treasury, tracks position
//   withdraw(amount)    — moves tokens out of treasury, updates position
//
// Position tracking (ERC-4626 totalAssets parity):
//   Each strategy gets a ProtocolPosition PDA that records how much it has
//   deposited. The vault program reads this during report_yield to compute
//   total_strategy_value = idle_balance + Σ(protocol_positions).
//   This matches ERC-4626's totalAssets() which includes external positions.
//
// PDA seeds:
//   Treasury:  ["treasury", token_mint]
//   Position:  ["position", strategy_token_account]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm");

#[program]
pub mod mock_lulo {
    use super::*;

    // Initialize the shared treasury for a given token mint.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        msg!(
            "Mock Lulo treasury initialized for mint {:?}",
            ctx.accounts.mint.key()
        );
        Ok(())
    }

    // Initialize a per-strategy position tracker.
    // Must be called once per strategy before deposit/withdraw.
    pub fn initialize_position(ctx: Context<InitializePosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        position.strategy_token_account = ctx.accounts.strategy_token_account.key();
        position.deposited_amount = 0;
        position.bump = ctx.bumps.position;
        msg!(
            "Position initialized for strategy token account {:?}",
            position.strategy_token_account
        );
        Ok(())
    }

    // Deposit: move tokens from strategy token account → treasury.
    // Updates the position to track the deposited principal.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, MockLuloError::ZeroAmount);

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

        // Track deposited principal in the position account
        ctx.accounts.position.deposited_amount = ctx
            .accounts
            .position
            .deposited_amount
            .checked_add(amount)
            .ok_or(MockLuloError::Overflow)?;

        msg!("Mock Lulo: deposited {} tokens", amount);
        Ok(())
    }

    // Withdraw: move tokens from treasury → strategy token account.
    // Updates the position to reflect the withdrawal.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, MockLuloError::ZeroAmount);
        require!(
            ctx.accounts.treasury.amount >= amount,
            MockLuloError::InsufficientTreasury
        );

        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.treasury],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        // Update position — clamp to zero if withdrawing more than deposited
        // (can happen when withdrawing accrued yield)
        ctx.accounts.position.deposited_amount = ctx
            .accounts
            .position
            .deposited_amount
            .saturating_sub(amount);

        msg!("Mock Lulo: withdrew {} tokens", amount);
        Ok(())
    }
}

// =============================================================================
// ACCOUNTS
// =============================================================================

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = treasury,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The strategy token account this position tracks.
    pub strategy_token_account: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ProtocolPosition::INIT_SPACE,
        seeds = [b"position", strategy_token_account.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, ProtocolPosition>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub strategy_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: The vault PDA that signs the transfer.
    pub vault_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    // Per-strategy position tracker — updated on every deposit.
    #[account(
        mut,
        seeds = [b"position", strategy_token_account.key().as_ref()],
        bump = position.bump,
        constraint = position.strategy_token_account == strategy_token_account.key() @ MockLuloError::InvalidPosition,
    )]
    pub position: Account<'info, ProtocolPosition>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub strategy_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: The vault PDA. Not used as signer for withdraw (treasury signs instead).
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    // Per-strategy position tracker — updated on every withdraw.
    #[account(
        mut,
        seeds = [b"position", strategy_token_account.key().as_ref()],
        bump = position.bump,
        constraint = position.strategy_token_account == strategy_token_account.key() @ MockLuloError::InvalidPosition,
    )]
    pub position: Account<'info, ProtocolPosition>,
}

// =============================================================================
// STATE — ProtocolPosition
// =============================================================================

/// Tracks a single strategy's deposited principal in this protocol.
/// The vault program reads this account to compute total strategy value
/// (ERC-4626 totalAssets equivalent: idle_balance + protocol_position).
///
/// Seeds: ["position", strategy_token_account]
#[account]
#[derive(InitSpace)]
pub struct ProtocolPosition {
    /// The strategy token account this position belongs to.
    pub strategy_token_account: Pubkey, // 32 bytes

    /// Principal deposited by this strategy (incremented on deposit, decremented on withdraw).
    pub deposited_amount: u64, // 8 bytes

    /// PDA bump.
    pub bump: u8, // 1 byte
}

// =============================================================================
// ERRORS
// =============================================================================

#[error_code]
pub enum MockLuloError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Treasury has insufficient tokens for withdrawal")]
    InsufficientTreasury,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Position does not match strategy token account")]
    InvalidPosition,
}
