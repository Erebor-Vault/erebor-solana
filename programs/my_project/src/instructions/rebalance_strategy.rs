use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<RebalanceStrategy>) -> Result<()> {
    let strategy_id = ctx.accounts.strategy.strategy_id;
    let weight_bps = ctx.accounts.strategy.target_weight_bps;
    let current = ctx.accounts.strategy.allocated_amount;
    let total_deposited = ctx.accounts.vault_state.total_deposited;
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault_state.bump;

    let target_amount = (total_deposited as u128)
        .checked_mul(weight_bps as u128)
        .unwrap()
        .checked_div(10000)
        .unwrap() as u64;

    if target_amount == current {
        msg!("Strategy {} already at target", strategy_id);
        return Ok(());
    }

    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

    if target_amount > current {
        let delta = target_amount - current;
        require!(
            ctx.accounts.reserve_ata.amount >= delta,
            VaultError::InsufficientReserveForRebalance
        );

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, delta)?;

        ctx.accounts.strategy.allocated_amount = target_amount;
        msg!("Rebalanced strategy {}: allocated {} more", strategy_id, delta);
    } else {
        let delta = current - target_amount;

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.strategy_token_account.to_account_info(),
            to: ctx.accounts.reserve_ata.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, delta)?;

        ctx.accounts.strategy.allocated_amount = target_amount;
        msg!("Rebalanced strategy {}: deallocated {}", strategy_id, delta);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct RebalanceStrategy<'info> {
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
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
