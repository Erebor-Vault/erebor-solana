use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

/// Report yield for a strategy, including tokens deployed to external protocols.
///
/// Total strategy value = strategy_token_account.amount + Σ(protocol_positions)
///
/// Protocol positions are passed as remaining_accounts. Each must be a
/// ProtocolPosition-like account with the layout:
///   [8-byte discriminator][32-byte strategy_token_account][8-byte deposited_amount]
///
/// The instruction verifies each position's strategy_token_account matches
/// this strategy's token account. This is the Solana equivalent of ERC-4626's
/// totalAssets() — it includes both idle funds and funds deployed externally.
///
/// Backward compatible: if no remaining_accounts are passed, it works exactly
/// as before (only reads strategy token account balance).
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ReportYield<'info>>,
) -> Result<()> {
    let strategy = &mut ctx.accounts.strategy;
    let idle_balance = ctx.accounts.strategy_token_account.amount;

    // Sum external protocol positions from remaining_accounts.
    // Each remaining account is expected to be a ProtocolPosition PDA with:
    //   bytes 8..40:  strategy_token_account (Pubkey)
    //   bytes 40..48: deposited_amount (u64 LE)
    let mut external_value: u64 = 0;

    for acc in ctx.remaining_accounts.iter() {
        let data = acc.try_borrow_data()?;

        // Must be at least 48 bytes: 8 discriminator + 32 pubkey + 8 u64
        if data.len() < 48 {
            continue;
        }

        // Verify the position belongs to this strategy's token account
        let position_strategy_token = Pubkey::try_from(&data[8..40])
            .map_err(|_| error!(VaultError::InvalidPositionAccount))?;
        require!(
            position_strategy_token == strategy.token_account,
            VaultError::InvalidPositionAccount
        );

        // Read deposited_amount (bytes 40..48, little-endian u64)
        let deposited = u64::from_le_bytes(
            data[40..48]
                .try_into()
                .map_err(|_| error!(VaultError::InvalidPositionAccount))?,
        );

        external_value = external_value
            .checked_add(deposited)
            .ok_or(VaultError::InsufficientBalance)?;
    }

    // Total strategy value = idle (in strategy token account) + external (in protocols)
    let total_value = idle_balance
        .checked_add(external_value)
        .ok_or(VaultError::InsufficientBalance)?;

    // Yield = total value - what we last tracked
    let yield_amount = total_value
        .checked_sub(strategy.allocated_amount)
        .ok_or(VaultError::InsufficientBalance)?;

    if yield_amount > 0 {
        ctx.accounts.vault_state.total_deposited += yield_amount;
        strategy.allocated_amount = total_value;

        msg!(
            "Reported yield of {} for strategy {} (idle: {}, external: {}, total: {})",
            yield_amount,
            strategy.strategy_id,
            idle_balance,
            external_value,
            total_value
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct ReportYield<'info> {
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
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    // Protocol position accounts are passed as remaining_accounts
}
