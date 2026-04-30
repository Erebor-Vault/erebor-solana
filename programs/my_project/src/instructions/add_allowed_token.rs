use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct AddAllowedToken<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
        constraint = protocol_config.governance == governance.key() @ VaultError::UnauthorizedGovernance,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = governance,
        space = 8 + AllowedToken::INIT_SPACE,
        seeds = [b"allowed_token", mint.as_ref()],
        bump,
    )]
    pub allowed_token: Account<'info, AllowedToken>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddAllowedToken>, mint: Pubkey) -> Result<()> {
    let token = &mut ctx.accounts.allowed_token;
    token.mint = mint;
    token.bump = ctx.bumps.allowed_token;
    emit!(AllowedTokenAdded { mint });
    Ok(())
}
