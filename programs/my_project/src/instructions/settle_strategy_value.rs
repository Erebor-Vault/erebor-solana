use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::try_load_program_pda;
use crate::state::*;

/// Phase-5: walk the registered `ValueSource` PDAs for a strategy and
/// settle `strategy.allocated_amount` (and `vault.total_deposited`) to the
/// computed live total. Authority-only and pause-gated, like
/// `report_yield` / `report_loss`.
///
/// Caller passes `[value_source_pda, target_account]` pairs in
/// `remaining_accounts`; the strategy ATA's idle balance is added
/// automatically (so a curator registers VSs only for *external* deployed
/// positions — Lulo cTokens, Kamino reserve shares, etc.).
#[derive(Accounts)]
#[instruction(strategy_id: u64)]
pub struct SettleStrategyValue<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"strategy", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleStrategyValue<'info>>,
    _strategy_id: u64,
) -> Result<()> {
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let strategy_key = ctx.accounts.strategy.key();
    let strategy_ata_key = ctx.accounts.strategy.token_account;

    // Start with the strategy ATA's idle balance — the part of the
    // allocation that hasn't been deployed externally yet.
    let mut total_value: u128 = ctx.accounts.strategy_token_account.amount as u128;

    // Walk [value_source_pda, target_account] pairs.
    for chunk in ctx.remaining_accounts.chunks_exact(2) {
        let vs_ai = &chunk[0];
        let target_ai = &chunk[1];

        let Some(vs) = try_load_program_pda::<ValueSource>(vs_ai)? else {
            continue;
        };
        require!(vs.strategy == strategy_key, VaultError::AccountMismatch);
        require!(
            target_ai.key() == vs.target_account,
            VaultError::ValueSourceTargetMismatch
        );
        // The strategy's own ATA is already counted via
        // `strategy_token_account.amount` above; double-counting it via a
        // VS pointing at the same account would inflate the settle.
        require!(
            vs.target_account != strategy_ata_key,
            VaultError::ValueSourceTargetIsStrategyAta
        );

        let off: usize = match vs.kind {
            VALUE_SOURCE_KIND_SPL_ATA_BALANCE => SPL_TOKEN_AMOUNT_OFFSET,
            VALUE_SOURCE_KIND_ACCOUNT_U64 => vs.offset as usize,
            _ => return err!(VaultError::InvalidValueSourceKind),
        };

        let raw: u64 = {
            let data = target_ai.try_borrow_data()?;
            require!(
                data.len() >= off.checked_add(8).ok_or(VaultError::MathOverflow)?,
                VaultError::ValueSourceTargetTooSmall
            );
            let mut buf = [0u8; 8];
            buf.copy_from_slice(&data[off..off + 8]);
            u64::from_le_bytes(buf)
        };

        let contribution: u128 = (raw as u128)
            .checked_mul(vs.scale_num as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vs.scale_den as u128)
            .ok_or(VaultError::MathOverflow)?;
        total_value = total_value
            .checked_add(contribution)
            .ok_or(VaultError::MathOverflow)?;
    }

    let computed_value: u64 = total_value
        .try_into()
        .map_err(|_| error!(VaultError::MathOverflow))?;

    let prev_allocated = ctx.accounts.strategy.allocated_amount;
    let delta_signed: i64 = if computed_value >= prev_allocated {
        let delta = computed_value
            .checked_sub(prev_allocated)
            .ok_or(VaultError::MathOverflow)?;
        ctx.accounts.strategy.allocated_amount = computed_value;
        ctx.accounts.vault_state.total_deposited = ctx
            .accounts
            .vault_state
            .total_deposited
            .checked_add(delta)
            .ok_or(VaultError::MathOverflow)?;
        delta as i64
    } else {
        let loss = prev_allocated
            .checked_sub(computed_value)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            loss <= ctx.accounts.vault_state.total_deposited,
            VaultError::LossExceedsDeposited
        );
        ctx.accounts.strategy.allocated_amount = computed_value;
        ctx.accounts.vault_state.total_deposited = ctx
            .accounts
            .vault_state
            .total_deposited
            .checked_sub(loss)
            .ok_or(VaultError::MathOverflow)?;
        -(loss as i64)
    };

    emit!(StrategyValueSettled {
        vault: ctx.accounts.vault_state.key(),
        strategy: strategy_key,
        strategy_id: ctx.accounts.strategy.strategy_id,
        previous_allocated: prev_allocated,
        computed_value,
        delta_signed,
    });

    Ok(())
}
