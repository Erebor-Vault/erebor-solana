use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Approve, Mint, TokenAccount, TokenInterface};

use crate::errors::VaultError;
use crate::state::{StrategyAllocation, VaultState};

pub fn handler(ctx: Context<CreateStrategy>) -> Result<()> {
    let strategy = &mut ctx.accounts.strategy;
    strategy.vault = ctx.accounts.vault_state.key();
    strategy.strategy_id = ctx.accounts.vault_state.strategy_count;
    strategy.delegate = ctx.accounts.delegate.key();
    strategy.allocated_amount = 0;
    strategy.token_account = ctx.accounts.strategy_token_account.key();
    strategy.is_active = true;
    strategy.target_weight_bps = 0;
    strategy.bump = ctx.bumps.strategy;

    // CPI: Approve the delegate on the strategy token account.
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &vault_id_bytes, &[bump]]];

    let approve_accounts = Approve {
        to: ctx.accounts.strategy_token_account.to_account_info(),
        delegate: ctx.accounts.delegate.to_account_info(),
        authority: ctx.accounts.vault_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        approve_accounts,
        signer_seeds,
    );
    token_interface::approve(cpi_ctx, u64::MAX)?;

    ctx.accounts.vault_state.strategy_count += 1;

    msg!(
        "Strategy {} created with delegate {:?}",
        strategy.strategy_id,
        strategy.delegate
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CreateStrategy<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = admin,
        space = 8 + StrategyAllocation::INIT_SPACE,
        seeds = [b"strategy", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"strategy_token", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = vault_state,
        token::token_program = token_program,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: The external protocol address to approve as delegate.
    pub delegate: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}
