use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
    ctx.accounts.strategy.delegate = ctx.accounts.new_delegate.key();

    msg!(
        "Strategy {} delegate updated to {:?}",
        ctx.accounts.strategy.strategy_id,
        ctx.accounts.strategy.delegate
    );

    Ok(())
}

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

    /// CHECK: New delegate address.
    pub new_delegate: UncheckedAccount<'info>,
}
