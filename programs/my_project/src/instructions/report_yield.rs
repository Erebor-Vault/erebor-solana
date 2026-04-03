use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<ReportYield>) -> Result<()> {
    let strategy = &mut ctx.accounts.strategy;
    let actual_balance = ctx.accounts.strategy_token_account.amount;

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
