use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::*;
use crate::events::*;
use crate::state::*;

/// Phase-5: explicit signed-delta rebalance. Authority hands the program
/// a `delta: i64` and the program moves exactly that much between reserve
/// and the strategy ATA. Positive = push reserve → strategy (in-leg);
/// negative = pull strategy → reserve (out-leg). Companion to
/// `rebalance_strategy`, which is weight-driven.
#[derive(Accounts)]
pub struct RebalanceWithDelta<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer for reserve ATA (in-leg).
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump = vault_state.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA (out-leg).
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy.strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<RebalanceWithDelta>, delta: i64) -> Result<()> {
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);
    require!(delta != 0, VaultError::ZeroAmount);

    let strategy_id = ctx.accounts.strategy.strategy_id;
    let current = ctx.accounts.strategy.allocated_amount;
    let vault_state_key = ctx.accounts.vault_state.key();
    let vault_auth_bump = ctx.accounts.vault_state.vault_authority_bump;
    let strategy_id_le = strategy_id.to_le_bytes();
    let strat_auth_bump = ctx.accounts.strategy.authority_bump;

    let new_allocated: u64 = if delta > 0 {
        let abs = delta as u64;
        let new = current.checked_add(abs).ok_or(VaultError::DeltaOutOfRange)?;

        require!(
            ctx.accounts.reserve_ata.amount >= abs,
            VaultError::InsufficientReserveForRebalance
        );

        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            vault_state_key.as_ref(),
            std::slice::from_ref(&vault_auth_bump),
        ]];
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, abs)?;
        new
    } else {
        // delta < 0; convert with care to avoid overflow on i64::MIN.
        let abs = delta
            .checked_neg()
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(VaultError::DeltaOutOfRange)?;
        let new = current.checked_sub(abs).ok_or(VaultError::DeltaOutOfRange)?;

        let signer_seeds: &[&[&[u8]]] = &[&[
            b"strategy_authority",
            vault_state_key.as_ref(),
            strategy_id_le.as_ref(),
            std::slice::from_ref(&strat_auth_bump),
        ]];
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.strategy_token_account.to_account_info(),
            to: ctx.accounts.reserve_ata.to_account_info(),
            authority: ctx.accounts.strategy_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, abs)?;
        new
    };

    ctx.accounts.strategy.allocated_amount = new_allocated;
    emit!(Rebalanced {
        vault: vault_state_key,
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        delta_signed: delta,
        new_allocated,
    });

    Ok(())
}
