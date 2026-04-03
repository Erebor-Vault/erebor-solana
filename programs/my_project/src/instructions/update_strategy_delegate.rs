use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Approve, Revoke, TokenAccount, TokenInterface};

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

    // Revoke old delegate
    let revoke_accounts = Revoke {
        source: ctx.accounts.strategy_token_account.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        revoke_accounts,
        signer_seeds,
    );
    token_interface::revoke(cpi_ctx)?;

    // Approve new delegate
    let approve_accounts = Approve {
        to: ctx.accounts.strategy_token_account.to_account_info(),
        delegate: ctx.accounts.new_delegate.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        approve_accounts,
        signer_seeds,
    );
    token_interface::approve(cpi_ctx, u64::MAX)?;

    ctx.accounts.strategy.delegate = ctx.accounts.new_delegate.key();

    msg!(
        "Strategy {} delegate updated to {:?}",
        ctx.accounts.strategy.strategy_id,
        ctx.accounts.strategy.delegate
    );

    Ok(())
}

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

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: New delegate address.
    pub new_delegate: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
