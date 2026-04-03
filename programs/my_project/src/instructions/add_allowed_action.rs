use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{AllowedAction, StrategyAllocation, VaultState};

pub fn handler(
    ctx: Context<AddAllowedAction>,
    target_program: Pubkey,
    discriminator: [u8; 8],
) -> Result<()> {
    let action = &mut ctx.accounts.allowed_action;
    action.strategy = ctx.accounts.strategy.key();
    action.target_program = target_program;
    action.discriminator = discriminator;
    action.action_id = ctx.accounts.strategy.action_count;
    action.is_active = true;
    action.bump = ctx.bumps.allowed_action;

    ctx.accounts.strategy.action_count += 1;

    msg!(
        "Allowed action {} added for strategy {}: program {:?}",
        action.action_id,
        ctx.accounts.strategy.strategy_id,
        target_program
    );

    Ok(())
}

#[derive(Accounts)]
pub struct AddAllowedAction<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidStrategy,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        init,
        payer = admin,
        space = 8 + AllowedAction::INIT_SPACE,
        seeds = [b"allowed_action", strategy.key().as_ref(), &strategy.action_count.to_le_bytes()],
        bump,
    )]
    pub allowed_action: Account<'info, AllowedAction>,

    pub system_program: Program<'info, System>,
}
