use anchor_lang::prelude::*;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct AddVaultAllowedToken<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The protocol-level allow-list entry must already exist for the
    /// mint. This enforces the "per-vault list ⊆ global list"
    /// invariant: an admin can only narrow the protocol-approved set,
    /// never extend it.
    #[account(
        seeds = [b"allowed_token", mint.as_ref()],
        bump = allowed_token.bump,
        constraint = allowed_token.mint == mint @ VaultError::OutputMintNotAllowed,
    )]
    pub allowed_token: Account<'info, AllowedToken>,

    #[account(
        init,
        payer = admin,
        space = 8 + VaultAllowedToken::INIT_SPACE,
        seeds = [b"vault_allowed_token", vault_state.key().as_ref(), mint.as_ref()],
        bump,
    )]
    pub vault_allowed_token: Account<'info, VaultAllowedToken>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddVaultAllowedToken>, mint: Pubkey) -> Result<()> {
    let entry = &mut ctx.accounts.vault_allowed_token;
    entry.vault = ctx.accounts.vault_state.key();
    entry.mint = mint;
    entry.bump = ctx.bumps.vault_allowed_token;
    entry._reserved = [0u8; 32];

    emit!(VaultAllowedTokenAdded {
        vault: ctx.accounts.vault_state.key(),
        mint,
    });
    Ok(())
}
