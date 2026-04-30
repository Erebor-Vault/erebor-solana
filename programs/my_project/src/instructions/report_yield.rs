use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

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

    /// Audit #14: pin the ATA's mint to the vault's underlying mint.
    #[account(
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
        constraint = strategy_token_account.mint == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,
}

pub fn handler(ctx: Context<ReportYield>) -> Result<()> {
    // Audit #20.
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let strategy = &mut ctx.accounts.strategy;
    let actual_balance = ctx.accounts.strategy_token_account.amount;

    let yield_amount = actual_balance
        .checked_sub(strategy.allocated_amount)
        .ok_or(VaultError::MathOverflow)?;

    if yield_amount > 0 {
        ctx.accounts.vault_state.total_deposited = ctx
            .accounts
            .vault_state
            .total_deposited
            .checked_add(yield_amount)
            .ok_or(VaultError::MathOverflow)?;
        strategy.allocated_amount = actual_balance;

        emit!(YieldReported {
            vault: ctx.accounts.vault_state.key(),
            strategy: strategy.key(),
            strategy_id: strategy.strategy_id,
            yield_amount,
            new_total_deposited: ctx.accounts.vault_state.total_deposited,
        });
    }

    Ok(())
}
