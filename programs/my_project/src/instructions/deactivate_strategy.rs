use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, Revoke, TokenAccount, TokenInterface};

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct DeactivateStrategy<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
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
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<DeactivateStrategy>) -> Result<()> {
    require!(
        ctx.accounts.strategy.allocated_amount == 0,
        VaultError::StrategyStillHoldsFunds
    );
    require!(
        ctx.accounts.strategy_token_account.amount == 0,
        VaultError::StrategyStillHoldsFunds
    );

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

    // Decrement the active-weight invariant before flipping is_active.
    let prior_weight = ctx.accounts.strategy.target_weight_bps;
    if prior_weight > 0 {
        ctx.accounts.vault_state.total_active_weight_bps = ctx
            .accounts
            .vault_state
            .total_active_weight_bps
            .checked_sub(prior_weight)
            .ok_or(VaultError::MathOverflow)?;
    }

    ctx.accounts.strategy.is_active = false;
    ctx.accounts.strategy.target_weight_bps = 0;

    emit!(StrategyDeactivated {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id: ctx.accounts.strategy.strategy_id,
    });

    Ok(())
}
