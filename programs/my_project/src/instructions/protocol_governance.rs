use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ProtocolGovernanceOnly<'info> {
    pub governance: Signer<'info>,

    #[account(
        mut,
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
        constraint = protocol_config.governance == governance.key() @ VaultError::UnauthorizedGovernance,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

pub fn set_treasury_handler(
    ctx: Context<ProtocolGovernanceOnly>,
    new_treasury: Pubkey,
) -> Result<()> {
    let previous = ctx.accounts.protocol_config.treasury;
    ctx.accounts.protocol_config.treasury = new_treasury;
    emit!(TreasurySet { previous, new_treasury });
    Ok(())
}

pub fn set_protocol_fee_bps_handler(
    ctx: Context<ProtocolGovernanceOnly>,
    new_bps: u16,
) -> Result<()> {
    require!(new_bps <= MAX_PERFORMANCE_FEE_BPS, VaultError::FeeExceedsMax);
    let previous = ctx.accounts.protocol_config.protocol_fee_bps;
    ctx.accounts.protocol_config.protocol_fee_bps = new_bps;
    emit!(ProtocolFeeBpsSet { previous_bps: previous, new_bps });
    Ok(())
}

pub fn set_governance_handler(
    ctx: Context<ProtocolGovernanceOnly>,
    new_governance: Pubkey,
) -> Result<()> {
    let previous = ctx.accounts.protocol_config.governance;
    ctx.accounts.protocol_config.governance = new_governance;
    emit!(GovernanceSet { previous, new_governance });
    Ok(())
}
