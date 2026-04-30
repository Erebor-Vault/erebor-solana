use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SetStrategyWeight<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
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

pub fn handler(ctx: Context<SetStrategyWeight>, weight_bps: u16) -> Result<()> {
    require!(weight_bps <= MAX_TOTAL_ACTIVE_WEIGHT_BPS, VaultError::WeightExceedsMax);

    let prior_weight = ctx.accounts.strategy.target_weight_bps;
    // Audit #18: enforce sum ≤ 10_000 across active strategies.
    let new_total = ctx
        .accounts
        .vault_state
        .total_active_weight_bps
        .checked_sub(prior_weight)
        .ok_or(VaultError::MathOverflow)?
        .checked_add(weight_bps)
        .ok_or(VaultError::MathOverflow)?;
    require!(
        new_total <= MAX_TOTAL_ACTIVE_WEIGHT_BPS,
        VaultError::WeightSumExceedsMax
    );

    ctx.accounts.strategy.target_weight_bps = weight_bps;
    ctx.accounts.vault_state.total_active_weight_bps = new_total;

    emit!(StrategyWeightSet {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id: ctx.accounts.strategy.strategy_id,
        weight_bps,
    });
    Ok(())
}
