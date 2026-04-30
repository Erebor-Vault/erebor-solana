use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RebalanceStrategy<'info> {
    /// Audit #5: rebalance is now authority-only.
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

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
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

/// Rebalance is now authority-only (audit #5). The two transfer legs sign
/// as different PDAs: in-leg (reserve → strategy) signs as
/// `vault_authority`; out-leg signs as `strategy_authority[i]`.
pub fn handler(ctx: Context<RebalanceStrategy>) -> Result<()> {
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let strategy_id = ctx.accounts.strategy.strategy_id;
    let weight_bps = ctx.accounts.strategy.target_weight_bps;
    let current = ctx.accounts.strategy.allocated_amount;
    let total_deposited = ctx.accounts.vault_state.total_deposited;
    let vault_state_key = ctx.accounts.vault_state.key();
    let vault_auth_bump = ctx.accounts.vault_state.vault_authority_bump;
    let strategy_id_le = strategy_id.to_le_bytes();
    let strat_auth_bump = ctx.accounts.strategy.authority_bump;

    let target_amount: u64 = (total_deposited as u128)
        .checked_mul(weight_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)?
        .try_into()
        .map_err(|_| error!(VaultError::MathOverflow))?;

    if target_amount == current {
        return Ok(());
    }

    if target_amount > current {
        let delta = target_amount.checked_sub(current).ok_or(VaultError::MathOverflow)?;
        require!(
            ctx.accounts.reserve_ata.amount >= delta,
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
        anchor_spl::token::transfer(cpi_ctx, delta)?;

        ctx.accounts.strategy.allocated_amount = target_amount;
        emit!(Rebalanced {
            vault: vault_state_key,
            strategy: ctx.accounts.strategy.key(),
            strategy_id,
            delta_signed: delta as i64,
            new_allocated: target_amount,
        });
    } else {
        let delta = current.checked_sub(target_amount).ok_or(VaultError::MathOverflow)?;

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
        anchor_spl::token::transfer(cpi_ctx, delta)?;

        ctx.accounts.strategy.allocated_amount = target_amount;
        emit!(Rebalanced {
            vault: vault_state_key,
            strategy: ctx.accounts.strategy.key(),
            strategy_id,
            delta_signed: -(delta as i64),
            new_allocated: target_amount,
        });
    }

    Ok(())
}
