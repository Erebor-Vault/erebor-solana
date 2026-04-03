use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::VaultState;

pub fn handler(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.vault_state.authority = new_authority;
    msg!("Authority set to {:?}", new_authority);
    Ok(())
}

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}
