use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Approve, Mint, TokenAccount, TokenInterface};

use crate::errors::*;
use crate::events::*;
use crate::helpers::*;
use crate::state::*;

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

    /// CHECK: PDA signer derived from (vault_state, strategy_count).
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

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
        token::authority = strategy_authority,
        token::token_program = token_program,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: protocol address to approve as delegate.
    pub delegate: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CreateStrategy>) -> Result<()> {
    // Defensive dedupe: caller passes existing active strategy PDAs in
    // remaining_accounts; reject if any already uses this delegate. The
    // structural defense against cross-strategy drains is still the
    // per-strategy authority PDA — this catches admin mistakes.
    check_delegate_not_duplicated(
        ctx.remaining_accounts,
        &ctx.accounts.vault_state.key(),
        ctx.accounts.delegate.key(),
        None,
    )?;

    let strategy_id = ctx.accounts.vault_state.strategy_count;
    let strategy = &mut ctx.accounts.strategy;
    strategy.vault = ctx.accounts.vault_state.key();
    strategy.strategy_id = strategy_id;
    strategy.delegate = ctx.accounts.delegate.key();
    strategy.allocated_amount = 0;
    strategy.token_account = ctx.accounts.strategy_token_account.key();
    strategy.is_active = true;
    strategy.target_weight_bps = 0;
    strategy.bump = ctx.bumps.strategy;
    strategy.authority_bump = ctx.bumps.strategy_authority;

    // Approve delegate, signed by strategy_authority (the new ATA owner).
    let vault_state_key = ctx.accounts.vault_state.key();
    let strategy_id_le = strategy_id.to_le_bytes();
    let bump = strategy.authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"strategy_authority",
        vault_state_key.as_ref(),
        strategy_id_le.as_ref(),
        std::slice::from_ref(&bump),
    ]];

    let approve_accounts = Approve {
        to: ctx.accounts.strategy_token_account.to_account_info(),
        delegate: ctx.accounts.delegate.to_account_info(),
        authority: ctx.accounts.strategy_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        approve_accounts,
        signer_seeds,
    );
    token_interface::approve(cpi_ctx, u64::MAX)?;

    ctx.accounts.vault_state.strategy_count = ctx
        .accounts
        .vault_state
        .strategy_count
        .checked_add(1)
        .ok_or(VaultError::MathOverflow)?;

    emit!(StrategyCreated {
        vault: ctx.accounts.vault_state.key(),
        strategy: strategy.key(),
        strategy_id,
        delegate: strategy.delegate,
    });

    Ok(())
}
