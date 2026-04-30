use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
}

pub fn handler(ctx: Context<AcceptAdmin>) -> Result<()> {
    let pending = ctx.accounts.vault_state.pending_admin;
    require!(
        pending != Pubkey::default() && pending == ctx.accounts.new_admin.key(),
        VaultError::NotPendingAdmin
    );

    let previous = ctx.accounts.vault_state.admin;
    ctx.accounts.vault_state.admin = pending;
    ctx.accounts.vault_state.pending_admin = Pubkey::default();

    emit!(AdminTransferred {
        vault: ctx.accounts.vault_state.key(),
        previous_admin: previous,
        new_admin: pending,
    });

    Ok(())
}
