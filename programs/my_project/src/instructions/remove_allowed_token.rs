use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct RemoveAllowedToken<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
        constraint = protocol_config.governance == governance.key() @ VaultError::UnauthorizedGovernance,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        close = governance,
        seeds = [b"allowed_token", mint.as_ref()],
        bump = allowed_token.bump,
    )]
    pub allowed_token: Account<'info, AllowedToken>,
}

pub fn handler(ctx: Context<RemoveAllowedToken>, _mint: Pubkey) -> Result<()> {
    emit!(AllowedTokenRemoved {
        mint: ctx.accounts.allowed_token.mint,
    });
    Ok(())
}
