use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Revoke, TokenAccount, TokenInterface};

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

/// One-time migration instruction for existing strategies.
/// Revokes the SPL delegate and initializes action_count = 0.
/// After migration, admin can add allowed actions via add_allowed_action.
pub fn handler(ctx: Context<MigrateStrategy>) -> Result<()> {
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

    // Revoke existing SPL delegate on the strategy token account
    let revoke_accounts = Revoke {
        source: ctx.accounts.strategy_token_account.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        revoke_accounts,
        signer_seeds,
    );
    token_interface::revoke(cpi_ctx)?;

    // Initialize action_count (new field added in v2)
    ctx.accounts.strategy.action_count = 0;

    msg!(
        "Strategy {} migrated: SPL delegate revoked, action_count initialized",
        ctx.accounts.strategy.strategy_id
    );

    Ok(())
}

#[derive(Accounts)]
pub struct MigrateStrategy<'info> {
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
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
