use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::events::*;
use crate::helpers::*;
use crate::state::*;

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

    /// CHECK: PDA derived from vault_state; pure signer, never holds data.
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"shares", vault_state.key().as_ref()],
        bump,
        mint::decimals = token_mint.decimals,
        mint::authority = vault_authority,
        mint::token_program = token_program,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<InitializeVault>, vault_id: u64) -> Result<()> {
    // Reject Token-2022 mints carrying a TransferHook or PermanentDelegate
    // extension. Both can rug the vault by silently routing or seizing
    // tokens that the program "owns" (audit #15).
    reject_dangerous_mint_extensions(&ctx.accounts.token_mint)?;

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
    vault.vault_authority_bump = ctx.bumps.vault_authority;
    vault.paused = false;
    vault.performance_fee_bps = DEFAULT_PERFORMANCE_FEE_BPS;
    vault.total_active_weight_bps = 0;
    vault.pending_admin = Pubkey::default();
    vault.pending_authority = Pubkey::default();
    vault._reserved = [0; 64];

    emit!(VaultInitialized {
        vault: vault.key(),
        admin: vault.admin,
        authority: vault.authority,
        token_mint: vault.token_mint,
        share_mint: vault.share_mint,
        vault_id,
    });

    Ok(())
}
