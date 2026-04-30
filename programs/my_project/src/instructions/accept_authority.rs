use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
}

pub fn handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let pending = ctx.accounts.vault_state.pending_authority;
    require!(
        pending != Pubkey::default() && pending == ctx.accounts.new_authority.key(),
        VaultError::NotPendingAuthority
    );

    let previous = ctx.accounts.vault_state.authority;
    ctx.accounts.vault_state.authority = pending;
    ctx.accounts.vault_state.pending_authority = Pubkey::default();

    emit!(AuthoritySet {
        vault: ctx.accounts.vault_state.key(),
        previous_authority: previous,
        new_authority: pending,
    });

    Ok(())
}
