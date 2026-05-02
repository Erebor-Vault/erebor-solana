use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct RemoveVaultAllowedToken<'info> {
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
        close = admin,
        seeds = [b"vault_allowed_token", vault_state.key().as_ref(), mint.as_ref()],
        bump = vault_allowed_token.bump,
        constraint = vault_allowed_token.vault == vault_state.key() @ VaultError::AccountMismatch,
        constraint = vault_allowed_token.mint == mint @ VaultError::AccountMismatch,
    )]
    pub vault_allowed_token: Account<'info, VaultAllowedToken>,
}

pub fn handler(ctx: Context<RemoveVaultAllowedToken>, _mint: Pubkey) -> Result<()> {
    emit!(VaultAllowedTokenRemoved {
        vault: ctx.accounts.vault_state.key(),
        mint: ctx.accounts.vault_allowed_token.mint,
    });
    Ok(())
}
