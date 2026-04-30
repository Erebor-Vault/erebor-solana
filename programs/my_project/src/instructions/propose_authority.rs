use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ProposeAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}

pub fn handler(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.vault_state.pending_authority = new_authority;
    emit!(AuthorityProposed {
        vault: ctx.accounts.vault_state.key(),
        current_authority: ctx.accounts.vault_state.authority,
        pending_authority: new_authority,
    });
    Ok(())
}
