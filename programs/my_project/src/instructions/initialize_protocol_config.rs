use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeProtocolConfig<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        init,
        payer = governance,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [b"protocol_config"],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeProtocolConfig>,
    treasury: Pubkey,
    protocol_fee_bps: u16,
) -> Result<()> {
    require!(
        protocol_fee_bps <= MAX_PERFORMANCE_FEE_BPS,
        VaultError::FeeExceedsMax
    );
    let cfg = &mut ctx.accounts.protocol_config;
    cfg.governance = ctx.accounts.governance.key();
    cfg.treasury = treasury;
    cfg.protocol_fee_bps = protocol_fee_bps;
    cfg.bump = ctx.bumps.protocol_config;

    emit!(ProtocolConfigInitialized {
        governance: cfg.governance,
        treasury,
        protocol_fee_bps,
    });
    Ok(())
}
