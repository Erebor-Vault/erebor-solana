use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<SetStrategyWeight>, weight_bps: u16) -> Result<()> {
    require!(weight_bps <= 10000, VaultError::WeightExceedsMax);
    ctx.accounts.strategy.target_weight_bps = weight_bps;
    msg!(
        "Strategy {} weight set to {} bps",
        ctx.accounts.strategy.strategy_id,
        weight_bps
    );
    Ok(())
}

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
