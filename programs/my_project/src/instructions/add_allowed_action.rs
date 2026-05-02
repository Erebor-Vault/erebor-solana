use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, target_program: Pubkey, discriminator: [u8; 8])]
pub struct AddAllowedAction<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"strategy", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        init,
        payer = admin,
        space = 8 + AllowedAction::INIT_SPACE,
        seeds = [
            b"allowed_action",
            strategy.key().as_ref(),
            target_program.as_ref(),
            &discriminator,
        ],
        bump,
    )]
    pub allowed_action: Account<'info, AllowedAction>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AddAllowedAction>,
    strategy_id: u64,
    target_program: Pubkey,
    discriminator: [u8; 8],
    expected_recipient_index: u16,
    // Phase-4d: optional slot in remaining_accounts that must be a
    // mint pubkey. When set, execute_action requires the mint to be
    // on the protocol-level allow-list (an `AllowedToken` PDA).
    output_mint_index: Option<u16>,
    // Phase-5: per-action risk gates.
    loss_per_call_bps_cap: u16,
    cooldown_secs: u32,
) -> Result<()> {
    require!(
        loss_per_call_bps_cap <= MAX_LOSS_PER_CALL_BPS,
        VaultError::LossCapTooHigh
    );

    let allowed = &mut ctx.accounts.allowed_action;
    allowed.vault = ctx.accounts.vault_state.key();
    allowed.strategy = ctx.accounts.strategy.key();
    allowed.strategy_id = strategy_id;
    allowed.target_program = target_program;
    allowed.discriminator = discriminator;
    allowed.expected_recipient_index = expected_recipient_index;
    allowed.output_mint_index = output_mint_index;
    allowed.loss_per_call_bps_cap = loss_per_call_bps_cap;
    allowed.cooldown_secs = cooldown_secs;
    allowed.last_executed_at = 0;
    allowed.bump = ctx.bumps.allowed_action;
    allowed._reserved = [0; 32];

    emit!(AllowedActionAdded {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        target_program,
        discriminator,
        expected_recipient_index,
        output_mint_index,
        loss_per_call_bps_cap,
        cooldown_secs,
    });
    Ok(())
}
