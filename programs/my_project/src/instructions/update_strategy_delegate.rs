use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Approve, Revoke, TokenAccount, TokenInterface};

use crate::errors::*;
use crate::events::*;
use crate::helpers::*;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateStrategyDelegate<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA.
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy.strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: new delegate address.
    pub new_delegate: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
    // Defensive dedupe — exclude this strategy itself from the loop.
    check_delegate_not_duplicated(
        ctx.remaining_accounts,
        &ctx.accounts.vault_state.key(),
        ctx.accounts.new_delegate.key(),
        Some(&ctx.accounts.strategy.key()),
    )?;

    let vault_state_key = ctx.accounts.vault_state.key();
    let strategy_id_le = ctx.accounts.strategy.strategy_id.to_le_bytes();
    let bump = ctx.accounts.strategy.authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"strategy_authority",
        vault_state_key.as_ref(),
        strategy_id_le.as_ref(),
        std::slice::from_ref(&bump),
    ]];

    let revoke_accounts = Revoke {
        source: ctx.accounts.strategy_token_account.to_account_info(),
        authority: ctx.accounts.strategy_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        revoke_accounts,
        signer_seeds,
    );
    token_interface::revoke(cpi_ctx)?;

    let approve_accounts = Approve {
        to: ctx.accounts.strategy_token_account.to_account_info(),
        delegate: ctx.accounts.new_delegate.to_account_info(),
        authority: ctx.accounts.strategy_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        approve_accounts,
        signer_seeds,
    );
    token_interface::approve(cpi_ctx, u64::MAX)?;

    ctx.accounts.strategy.delegate = ctx.accounts.new_delegate.key();

    emit!(DelegateUpdated {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id: ctx.accounts.strategy.strategy_id,
        new_delegate: ctx.accounts.strategy.delegate,
    });

    Ok(())
}
