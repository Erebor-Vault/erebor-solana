use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;

use crate::errors::VaultError;
use crate::state::{AllowedAction, StrategyAllocation, VaultState};

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteStrategyAction<'info>>,
    instruction_data: Vec<u8>,
) -> Result<()> {
    // Validate instruction data has at least 8 bytes (discriminator)
    require!(
        instruction_data.len() >= 8,
        VaultError::InvalidInstructionData
    );

    // Verify the discriminator matches the allowed action
    let provided_discriminator: [u8; 8] = instruction_data[..8]
        .try_into()
        .map_err(|_| error!(VaultError::InvalidInstructionData))?;
    require!(
        provided_discriminator == ctx.accounts.allowed_action.discriminator,
        VaultError::ActionNotAllowed
    );

    // Build account metas from remaining_accounts for the CPI
    let vault_key = ctx.accounts.vault_state.key();
    let cpi_accounts: Vec<AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .map(|acc| {
            // If the account is the vault PDA, mark it as signer (invoke_signed will sign for it)
            let is_signer = acc.is_signer || *acc.key == vault_key;
            if acc.is_writable {
                AccountMeta::new(*acc.key, is_signer)
            } else {
                AccountMeta::new_readonly(*acc.key, is_signer)
            }
        })
        .collect();

    let cpi_instruction = Instruction {
        program_id: ctx.accounts.target_program.key(),
        accounts: cpi_accounts,
        data: instruction_data,
    };

    // Vault PDA signs the CPI
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let vault_id_bytes = ctx.accounts.vault_state.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault",
        token_mint_key.as_ref(),
        &vault_id_bytes,
        &[bump],
    ]];

    // Collect all account infos needed for invoke_signed
    let mut account_infos: Vec<AccountInfo<'info>> = ctx.remaining_accounts.to_vec();
    account_infos.push(ctx.accounts.target_program.to_account_info());
    account_infos.push(ctx.accounts.vault_state.to_account_info());

    invoke_signed(&cpi_instruction, &account_infos, signer_seeds)?;

    msg!(
        "Strategy {} executed action on program {:?}",
        ctx.accounts.strategy.strategy_id,
        ctx.accounts.target_program.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteStrategyAction<'info> {
    /// The caller — must be either the strategy's delegate or the vault's authority.
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidStrategy,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
        constraint = (
            strategy.delegate == caller.key() ||
            vault_state.authority == caller.key()
        ) @ VaultError::UnauthorizedCaller,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = allowed_action.strategy == strategy.key() @ VaultError::InvalidStrategy,
        constraint = allowed_action.is_active @ VaultError::ActionNotActive,
        constraint = allowed_action.target_program == target_program.key() @ VaultError::ActionNotAllowed,
    )]
    pub allowed_action: Account<'info, AllowedAction>,

    /// CHECK: The external program to CPI into. Validated against allowed_action.target_program.
    pub target_program: UncheckedAccount<'info>,

    // Remaining accounts: all accounts needed by the target program's instruction.
}
