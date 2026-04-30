use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// CHECK: PDA signer derived from vault_state.
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump = vault_state.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_share_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let share_supply = ctx.accounts.share_mint.supply as u128;
    let total_deposited = ctx.accounts.vault_state.total_deposited as u128;

    // OpenZeppelin virtual-shares offset (audit #4): inflate both supply
    // and assets by constants so the first depositor cannot brute-force
    // a 1-share : N-asset ratio that rounds later depositors to 0 shares.
    //   shares = amount × (supply + VIRTUAL_SHARES) / (assets + 1)
    let shares_to_mint_u128 = (amount as u128)
        .checked_mul(share_supply.checked_add(VIRTUAL_SHARES).ok_or(VaultError::MathOverflow)?)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_deposited.checked_add(1).ok_or(VaultError::MathOverflow)?)
        .ok_or(VaultError::MathOverflow)?;
    let shares_to_mint: u64 = shares_to_mint_u128
        .try_into()
        .map_err(|_| error!(VaultError::MathOverflow))?;
    require!(shares_to_mint > 0, VaultError::ZeroAmount);

    // CPI 1: user → reserve.
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.reserve_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    // CPI 2: vault_authority signs mint_to.
    let vault_state_key = ctx.accounts.vault_state.key();
    let auth_bump = ctx.accounts.vault_state.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault_authority",
        vault_state_key.as_ref(),
        std::slice::from_ref(&auth_bump),
    ]];

    let mint_accounts = MintTo {
        mint: ctx.accounts.share_mint.to_account_info(),
        to: ctx.accounts.user_share_token.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        mint_accounts,
        signer_seeds,
    );
    token_interface::mint_to(cpi_ctx, shares_to_mint)?;

    ctx.accounts.vault_state.total_deposited = ctx
        .accounts
        .vault_state
        .total_deposited
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;

    emit!(Deposited {
        vault: ctx.accounts.vault_state.key(),
        user: ctx.accounts.user.key(),
        amount,
        shares_minted: shares_to_mint,
    });

    Ok(())
}
