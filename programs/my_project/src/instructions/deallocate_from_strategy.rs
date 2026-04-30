use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct DeallocateFromStrategy<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer for the reserve ATA.
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump = vault_state.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA.
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

pub fn handler(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);
    // Audit #19.
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let vault_state_key = ctx.accounts.vault_state.key();
    let strategy_id_le = ctx.accounts.strategy.strategy_id.to_le_bytes();
    let bump = ctx.accounts.strategy.authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"strategy_authority",
        vault_state_key.as_ref(),
        strategy_id_le.as_ref(),
        std::slice::from_ref(&bump),
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
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    ctx.accounts.strategy.allocated_amount = ctx
        .accounts
        .strategy
        .allocated_amount
        .checked_sub(amount)
        .ok_or(VaultError::MathOverflow)?;

    emit!(StrategyDeallocated {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id: ctx.accounts.strategy.strategy_id,
        amount,
    });

    Ok(())
}
