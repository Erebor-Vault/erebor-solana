use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SetPerformanceFeeBps<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<SetPerformanceFeeBps>, new_bps: u16) -> Result<()> {
    require!(new_bps <= MAX_PERFORMANCE_FEE_BPS, VaultError::FeeExceedsMax);
    // The total fee floor is the protocol cut — admin cannot set the
    // total below it (would mean a negative curator share).
    require!(
        new_bps >= ctx.accounts.protocol_config.protocol_fee_bps,
        VaultError::PerformanceFeeBelowProtocolFee
    );
    let previous = ctx.accounts.vault_state.performance_fee_bps;
    ctx.accounts.vault_state.performance_fee_bps = new_bps;
    emit!(PerformanceFeeSet {
        vault: ctx.accounts.vault_state.key(),
        previous_bps: previous,
        new_bps,
    });
    Ok(())
}
