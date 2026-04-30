use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ReportLoss<'info> {
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
    )]
    pub strategy: Account<'info, StrategyAllocation>,
}

/// Authority reports a realized loss on a strategy. Decrements both
/// `strategy.allocated_amount` and `vault_state.total_deposited` by the
/// loss. Reverts if the loss exceeds either tracked total. Audit #6.
pub fn handler(ctx: Context<ReportLoss>, loss_amount: u64) -> Result<()> {
    require!(loss_amount > 0, VaultError::ZeroAmount);

    let strategy = &mut ctx.accounts.strategy;
    require!(
        loss_amount <= strategy.allocated_amount,
        VaultError::LossExceedsDeposited
    );
    require!(
        loss_amount <= ctx.accounts.vault_state.total_deposited,
        VaultError::LossExceedsDeposited
    );

    strategy.allocated_amount = strategy
        .allocated_amount
        .checked_sub(loss_amount)
        .ok_or(VaultError::MathOverflow)?;
    let new_total = ctx
        .accounts
        .vault_state
        .total_deposited
        .checked_sub(loss_amount)
        .ok_or(VaultError::MathOverflow)?;
    ctx.accounts.vault_state.total_deposited = new_total;

    emit!(LossReported {
        vault: ctx.accounts.vault_state.key(),
        strategy: strategy.key(),
        strategy_id: strategy.strategy_id,
        amount: loss_amount,
        new_total_deposited: new_total,
    });

    Ok(())
}
