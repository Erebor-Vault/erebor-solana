use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, kind: u8)]
pub struct ClearAutoActionConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"strategy", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        mut,
        close = admin,
        seeds = [b"auto_action", strategy.key().as_ref(), &[kind]],
        bump = auto_action_config.bump,
        constraint = auto_action_config.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = auto_action_config.strategy == strategy.key() @ VaultError::InvalidMint,
    )]
    pub auto_action_config: Account<'info, AutoActionConfig>,
}

pub fn handler(
    ctx: Context<ClearAutoActionConfig>,
    strategy_id: u64,
    kind: u8,
) -> Result<()> {
    emit!(AutoActionConfigCleared {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        kind,
    });
    Ok(())
}
