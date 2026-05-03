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
    let now = Clock::get()?.unix_timestamp;

    // Strategy ATA's idle balance — already-allocated funds not deployed
    // externally yet.
    let mut total_value: u128 = ctx.accounts.strategy_token_account.amount as u128;

    // Pass 1: pre-scan all `SplAtaBalance` sources, caching their raw u64
    // balance keyed by the VS `index`. Pyth sources in pass 2 read from
    // this cache.
    let mut balance_by_index: [Option<u64>; MAX_VALUE_SOURCES_PER_STRATEGY as usize] =
        [None; MAX_VALUE_SOURCES_PER_STRATEGY as usize];

    for chunk in ctx.remaining_accounts.chunks_exact(2) {
        let vs_ai = &chunk[0];
        let target_ai = &chunk[1];
        let Some(vs) = try_load_program_pda::<ValueSource>(vs_ai)? else {
            continue;
        };
        if vs.kind != VALUE_SOURCE_KIND_SPL_ATA_BALANCE {
            continue;
        }
        require!(vs.strategy == strategy_key, VaultError::AccountMismatch);
        require!(
            target_ai.key() == vs.target_account,
            VaultError::ValueSourceTargetMismatch
        );
        require!(
            vs.target_account != strategy_ata_key,
            VaultError::ValueSourceTargetIsStrategyAta
        );
        let data = target_ai.try_borrow_data()?;
        require!(
            data.len() >= SPL_TOKEN_AMOUNT_OFFSET + 8,
            VaultError::ValueSourceTargetTooSmall
        );
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&data[SPL_TOKEN_AMOUNT_OFFSET..SPL_TOKEN_AMOUNT_OFFSET + 8]);
        balance_by_index[vs.index as usize] = Some(u64::from_le_bytes(buf));

        // Also fold into total_value with its own scale.
        let raw = u64::from_le_bytes(buf) as u128;
        let contribution = raw
            .checked_mul(vs.scale_num as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vs.scale_den as u128)
            .ok_or(VaultError::MathOverflow)?;
        total_value = total_value
            .checked_add(contribution)
            .ok_or(VaultError::MathOverflow)?;
    }

    // Pass 2: evaluate AccountU64 + PythPriceFeed sources.
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
        require!(
            vs.target_account != strategy_ata_key,
            VaultError::ValueSourceTargetIsStrategyAta
        );

        let contribution: u128 = match vs.kind {
            VALUE_SOURCE_KIND_SPL_ATA_BALANCE => continue, // already counted in pass 1
            VALUE_SOURCE_KIND_ACCOUNT_U64 => {
                let off = vs.offset as usize;
                let data = target_ai.try_borrow_data()?;
                require!(
                    data.len() >= off.checked_add(8).ok_or(VaultError::MathOverflow)?,
                    VaultError::ValueSourceTargetTooSmall
                );
                let mut buf = [0u8; 8];
                buf.copy_from_slice(&data[off..off + 8]);
                let raw = u64::from_le_bytes(buf) as u128;
                raw.checked_mul(vs.scale_num as u128)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(vs.scale_den as u128)
                    .ok_or(VaultError::MathOverflow)?
            }
            VALUE_SOURCE_KIND_PYTH_PRICE_FEED => {
                // Resolve the sibling balance source.
                require!(
                    vs.mint_balance_source_index < MAX_VALUE_SOURCES_PER_STRATEGY
                        && vs.mint_balance_source_index != vs.index,
                    VaultError::ValueSourcePythBadIndex
                );
                let balance = balance_by_index[vs.mint_balance_source_index as usize]
                    .ok_or(error!(VaultError::ValueSourcePythBalanceSourceMissing))?;

                let data = target_ai.try_borrow_data()?;
                require!(
                    data.len() >= PYTH_MIN_ACCOUNT_LEN,
                    VaultError::ValueSourceTargetTooSmall
                );

                let mut price_buf = [0u8; 8];
                price_buf.copy_from_slice(&data[PYTH_PRICE_OFFSET..PYTH_PRICE_OFFSET + 8]);
                let price = i64::from_le_bytes(price_buf);
                require!(price >= 0, VaultError::ValueSourcePythNegativePrice);

                let mut expo_buf = [0u8; 4];
                expo_buf.copy_from_slice(&data[PYTH_EXPO_OFFSET..PYTH_EXPO_OFFSET + 4]);
                let expo = i32::from_le_bytes(expo_buf);

                let mut pt_buf = [0u8; 8];
                pt_buf.copy_from_slice(
                    &data[PYTH_PUBLISH_TIME_OFFSET..PYTH_PUBLISH_TIME_OFFSET + 8],
                );
                let publish_time = i64::from_le_bytes(pt_buf);

                let age = now.checked_sub(publish_time).unwrap_or(i64::MAX);
                require!(
                    age >= 0 && (age as u64) <= vs.max_staleness_secs as u64,
                    VaultError::ValueSourcePythStale
                );

                // contribution = balance × price × 10^expo, with scale.
                let mut value: u128 = (balance as u128)
                    .checked_mul(price as u128)
                    .ok_or(VaultError::MathOverflow)?;
                if expo < 0 {
                    let factor = 10u128
                        .checked_pow((-expo) as u32)
                        .ok_or(VaultError::MathOverflow)?;
                    value = value.checked_div(factor).ok_or(VaultError::MathOverflow)?;
                } else if expo > 0 {
                    let factor = 10u128
                        .checked_pow(expo as u32)
                        .ok_or(VaultError::MathOverflow)?;
                    value = value.checked_mul(factor).ok_or(VaultError::MathOverflow)?;
                }
                value
                    .checked_mul(vs.scale_num as u128)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(vs.scale_den as u128)
                    .ok_or(VaultError::MathOverflow)?
            }
            _ => return err!(VaultError::InvalidValueSourceKind),
        };

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
