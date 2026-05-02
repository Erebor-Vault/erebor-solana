use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, index: u8)]
pub struct AddValueSource<'info> {
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
        space = 8 + ValueSource::INIT_SPACE,
        seeds = [b"value_source", strategy.key().as_ref(), &[index]],
        bump,
    )]
    pub value_source: Account<'info, ValueSource>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AddValueSource>,
    strategy_id: u64,
    index: u8,
    kind: u8,
    target_account: Pubkey,
    offset: u32,
    scale_num: u64,
    scale_den: u64,
) -> Result<()> {
    require!(
        index < MAX_VALUE_SOURCES_PER_STRATEGY,
        VaultError::ValueSourceIndexOutOfBounds
    );
    require!(
        kind == VALUE_SOURCE_KIND_SPL_ATA_BALANCE || kind == VALUE_SOURCE_KIND_ACCOUNT_U64,
        VaultError::InvalidValueSourceKind
    );
    require!(scale_den > 0, VaultError::InvalidValueSourceScale);

    let vs = &mut ctx.accounts.value_source;
    vs.vault = ctx.accounts.vault_state.key();
    vs.strategy = ctx.accounts.strategy.key();
    vs.strategy_id = strategy_id;
    vs.index = index;
    vs.kind = kind;
    vs.target_account = target_account;
    vs.offset = offset;
    vs.scale_num = scale_num;
    vs.scale_den = scale_den;
    vs.bump = ctx.bumps.value_source;
    vs._reserved = [0; 32];

    emit!(ValueSourceAdded {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        index,
        kind,
        target_account,
        offset,
        scale_num,
        scale_den,
    });
    Ok(())
}
