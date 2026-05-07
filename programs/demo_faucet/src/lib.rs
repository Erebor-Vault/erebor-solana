//! demo_faucet — devnet drip faucet for hackathon demos.
//!
//! Anyone can call `claim` to receive `FaucetConfig.amount_per_claim`
//! tokens of a registered SPL mint, subject to a per-recipient cooldown.
//! The mint authority lives on the `["faucet_authority", mint]` PDA so
//! no off-chain keypair is at risk.
//!
//! Lifecycle:
//!   1. Admin calls `register_mint(amount_per_claim, cooldown_secs)` —
//!      initialises a `FaucetConfig` PDA. The mint must already have its
//!      authority set to the `faucet_authority` PDA (transferred via
//!      `spl-token authorize` before this ix).
//!   2. Anyone calls `claim` — mints `amount_per_claim` of the registered
//!      mint to their ATA. A `ClaimRecord` PDA tracks `last_claimed_at`;
//!      a second call within `cooldown_secs` reverts.
//!
//! NOT FOR MAINNET. Intended exclusively for devnet demo flows.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("C86dEAtswZXMNqVPM6uhftE2yfwwv6qCxo3RpUXa777E");

#[program]
pub mod demo_faucet {
    use super::*;

    /// Initialise a faucet drip config for `mint`. Called once per mint by
    /// the admin who already transferred mint authority to the
    /// `faucet_authority` PDA.
    pub fn register_mint(
        ctx: Context<RegisterMint>,
        amount_per_claim: u64,
        cooldown_secs: i64,
    ) -> Result<()> {
        require!(amount_per_claim > 0, FaucetError::ZeroAmount);
        require!(cooldown_secs >= 0, FaucetError::NegativeCooldown);

        let cfg = &mut ctx.accounts.faucet_config;
        cfg.mint = ctx.accounts.mint.key();
        cfg.amount_per_claim = amount_per_claim;
        cfg.cooldown_secs = cooldown_secs;
        cfg.bump = ctx.bumps.faucet_config;
        cfg.authority_bump = ctx.bumps.faucet_authority;

        emit!(FaucetMintRegistered {
            mint: cfg.mint,
            amount_per_claim,
            cooldown_secs,
        });
        Ok(())
    }

    /// Anyone can call. Mints `amount_per_claim` of `mint` to recipient's
    /// ATA, subject to per-recipient cooldown.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let claim_record = &mut ctx.accounts.claim_record;

        if claim_record.last_claimed_at > 0 {
            let next_ok = claim_record
                .last_claimed_at
                .checked_add(ctx.accounts.faucet_config.cooldown_secs)
                .ok_or(FaucetError::MathOverflow)?;
            require!(now >= next_ok, FaucetError::Cooldown);
        } else {
            // First-time claim — record the recipient binding.
            claim_record.recipient = ctx.accounts.recipient.key();
            claim_record.mint = ctx.accounts.mint.key();
            claim_record.bump = ctx.bumps.claim_record;
        }
        claim_record.last_claimed_at = now;

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.faucet_config.authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"faucet_authority", mint_key.as_ref(), &[bump]]];

        let amount = ctx.accounts.faucet_config.amount_per_claim;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_ata.to_account_info(),
                    authority: ctx.accounts.faucet_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(FaucetClaimed {
            mint: ctx.accounts.mint.key(),
            recipient: ctx.accounts.recipient.key(),
            amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: Account<'info, Mint>,

    /// PDA that holds the mint authority. The admin must transfer the
    /// real mint authority to this PDA before calling `register_mint`.
    /// Its existence is implied — Solana doesn't need an account here,
    /// but Anchor needs the seeds to derive the bump for storage.
    /// CHECK: PDA, seeds verified by Anchor.
    #[account(
        seeds = [b"faucet_authority", mint.key().as_ref()],
        bump,
    )]
    pub faucet_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + FaucetConfig::INIT_SPACE,
        seeds = [b"faucet_config", mint.key().as_ref()],
        bump,
    )]
    pub faucet_config: Account<'info, FaucetConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(mut, address = faucet_config.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [b"faucet_config", mint.key().as_ref()],
        bump = faucet_config.bump,
    )]
    pub faucet_config: Account<'info, FaucetConfig>,

    /// CHECK: PDA, signs mint_to.
    #[account(
        seeds = [b"faucet_authority", mint.key().as_ref()],
        bump = faucet_config.authority_bump,
    )]
    pub faucet_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = recipient,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [b"claim", mint.key().as_ref(), recipient.key().as_ref()],
        bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct FaucetConfig {
    pub mint: Pubkey,
    pub amount_per_claim: u64,
    pub cooldown_secs: i64,
    pub bump: u8,
    pub authority_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub last_claimed_at: i64,
    pub bump: u8,
}

#[event]
pub struct FaucetMintRegistered {
    pub mint: Pubkey,
    pub amount_per_claim: u64,
    pub cooldown_secs: i64,
}

#[event]
pub struct FaucetClaimed {
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum FaucetError {
    #[msg("Amount per claim must be > 0")]
    ZeroAmount,
    #[msg("Cooldown must be non-negative")]
    NegativeCooldown,
    #[msg("Cooldown not elapsed since last claim")]
    Cooldown,
    #[msg("Math overflow")]
    MathOverflow,
}
