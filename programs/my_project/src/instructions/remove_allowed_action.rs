use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{AllowedAction, StrategyAllocation, VaultState};

pub fn handler(ctx: Context<RemoveAllowedAction>) -> Result<()> {
    let action_id = ctx.accounts.allowed_action.action_id;
    ctx.accounts.allowed_action.is_active = false;

    msg!(
        "Allowed action {} deactivated for strategy {}",
        action_id,
        ctx.accounts.strategy.strategy_id
    );

    Ok(())
}

#[derive(Accounts)]
pub struct RemoveAllowedAction<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidStrategy,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        mut,
        seeds = [b"allowed_action", strategy.key().as_ref(), &allowed_action.action_id.to_le_bytes()],
        bump = allowed_action.bump,
        constraint = allowed_action.strategy == strategy.key() @ VaultError::InvalidStrategy,
        constraint = allowed_action.is_active @ VaultError::ActionNotActive,
    )]
    pub allowed_action: Account<'info, AllowedAction>,
}
