use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);

    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

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
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    ctx.accounts.strategy.allocated_amount -= amount;

    msg!("Deallocated {} from strategy {}", amount, ctx.accounts.strategy.strategy_id);

    Ok(())
}

#[derive(Accounts)]
pub struct DeallocateFromStrategy<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
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
