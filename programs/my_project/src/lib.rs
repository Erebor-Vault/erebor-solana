use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

declare_id!("6B8tT1EzLMKUZ5fF5H8cTs4We1vLabVeZtgCnB4Ccmnq"); // program ID, best to keep it unchangeable
// the private key to this is at target/deploy/my_project-keypair.json

#[program]
pub mod my_project {
    use super::*;
 
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        msg!("Signer {:?}", ctx.accounts.signer.key());
 
        ctx.accounts.counter.value = 0;
        ctx.accounts.counter.bump = ctx.bumps.counter;
 
        Ok(())
    }
 
    pub fn increment(ctx: Context<Increment>, increment_by: u64) -> Result<()> {
        msg!(
            "Value incremented by {:?} for {:?}",
            increment_by,
            ctx.accounts.signer.key()
        );
 
        require!(
            ctx.accounts.source_token_account.amount >= increment_by,
            MyErrors::AmountTooSmall
        );
 
        ctx.accounts.counter.value += increment_by;
 
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.source_token_account.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };
 
        let cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
 
        anchor_spl::token::transfer(cpi_context, increment_by)?;
 
        Ok(())
    }
}
 
#[error_code]
enum MyErrors {
    AmountTooSmall,
}
 
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
 
    #[account(
        init,
        payer = signer,
        space = 8 + Counter::INIT_SPACE,
        seeds=[b"counter", signer.key().to_bytes().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,
 
    pub system_program: Program<'info, System>,
}
 
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
 
    #[account(
        mut,
        seeds=[b"counter", signer.key().to_bytes().as_ref()],
        bump = counter.bump
    )]
    pub counter: Account<'info, Counter>,
 
    pub vault_authority: SystemAccount<'info>,
 
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = signer,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
 
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,
 
    pub token_mint: InterfaceAccount<'info, Mint>,
 
    pub token_program: Interface<'info, TokenInterface>,
}
 
#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub value: u64,
    pub bump: u8,
}
