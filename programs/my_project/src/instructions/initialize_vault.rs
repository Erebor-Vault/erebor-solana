use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::VaultState;

pub fn handler(ctx: Context<InitializeVault>, vault_id: u64) -> Result<()> {
    msg!("Initializing vault for mint: {:?}", ctx.accounts.token_mint.key());

    let vault = &mut ctx.accounts.vault_state;
    vault.admin = ctx.accounts.admin.key();
    vault.authority = ctx.accounts.admin.key();
    vault.token_mint = ctx.accounts.token_mint.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.vault_id = vault_id;
    vault.total_deposited = 0;
    vault.strategy_count = 0;
    vault.bump = ctx.bumps.vault_state;
    vault.share_mint_bump = ctx.bumps.share_mint;

    msg!("Vault initialized. Admin: {:?}", vault.admin);

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", token_mint.key().as_ref(), &vault_id.to_le_bytes()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"shares", vault_state.key().as_ref()],
        bump,
        mint::decimals = token_mint.decimals,
        mint::authority = vault_state,
        mint::token_program = token_program,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
