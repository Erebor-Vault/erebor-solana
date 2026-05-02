use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, kind: u8)]
pub struct SetAutoActionConfig<'info> {
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
        space = 8 + AutoActionConfig::INIT_SPACE,
        seeds = [b"auto_action", strategy.key().as_ref(), &[kind]],
        bump,
    )]
    pub auto_action_config: Account<'info, AutoActionConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SetAutoActionConfig>,
    strategy_id: u64,
    kind: u8,
    target_program: Pubkey,
    discriminator: [u8; 8],
    ix_data: Vec<u8>,
) -> Result<()> {
    require!(
        kind == AUTO_ACTION_KIND_DEPOSIT || kind == AUTO_ACTION_KIND_WITHDRAW,
        VaultError::InvalidAutoActionKind
    );
    require!(
        ix_data.len() <= MAX_AUTO_ACTION_IX_DATA_LEN,
        VaultError::AutoActionDataTooLarge
    );

    let ix_data_len = ix_data.len() as u32;

    let cfg = &mut ctx.accounts.auto_action_config;
    cfg.vault = ctx.accounts.vault_state.key();
    cfg.strategy = ctx.accounts.strategy.key();
    cfg.strategy_id = strategy_id;
    cfg.kind = kind;
    cfg.target_program = target_program;
    cfg.discriminator = discriminator;
    cfg.ix_data = ix_data;
    cfg.bump = ctx.bumps.auto_action_config;
    cfg._reserved = [0; 32];

    emit!(AutoActionConfigSet {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        kind,
        target_program,
        discriminator,
        ix_data_len,
    });
    Ok(())
}
