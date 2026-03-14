use anchor_lang::prelude::*;

declare_id!("6B8tT1EzLMKUZ5fF5H8cTs4We1vLabVeZtgCnB4Ccmnq"); // program ID, best to keep it unchangeable
// the private key to this is at target/deploy/my_project-keypair.json

#[program]
pub mod my_project {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init, 
        payer = signer, 
        space = 8 + Counter::INIT_SPACE, 
        seeds=[b"counter", 
        signer.key().to_bytes().as_ref()], 
        bump)]
    pub counter: Account<'info, Counter>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Counter{
    pub value: u64,
    pub bump: u8
}
