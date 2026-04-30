use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, target_program: Pubkey, discriminator: [u8; 8])]
pub struct RemoveAllowedAction<'info> {
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
        seeds = [
            b"allowed_action",
            strategy.key().as_ref(),
            target_program.as_ref(),
            &discriminator,
        ],
        bump = allowed_action.bump,
        constraint = allowed_action.vault == vault_state.key() @ VaultError::ActionNotAllowed,
        constraint = allowed_action.strategy == strategy.key() @ VaultError::ActionNotAllowed,
    )]
    pub allowed_action: Account<'info, AllowedAction>,
}

pub fn handler(
    ctx: Context<RemoveAllowedAction>,
    _strategy_id: u64,
    target_program: Pubkey,
    discriminator: [u8; 8],
) -> Result<()> {
    emit!(AllowedActionRemoved {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id: ctx.accounts.strategy.strategy_id,
        target_program,
        discriminator,
    });
    Ok(())
}
