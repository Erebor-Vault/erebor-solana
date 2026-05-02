use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, index: u8)]
pub struct RemoveValueSource<'info> {
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
        seeds = [b"value_source", strategy.key().as_ref(), &[index]],
        bump = value_source.bump,
        constraint = value_source.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = value_source.strategy == strategy.key() @ VaultError::InvalidMint,
    )]
    pub value_source: Account<'info, ValueSource>,
}

pub fn handler(
    ctx: Context<RemoveValueSource>,
    strategy_id: u64,
    index: u8,
) -> Result<()> {
    emit!(ValueSourceRemoved {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        index,
    });
    Ok(())
}
