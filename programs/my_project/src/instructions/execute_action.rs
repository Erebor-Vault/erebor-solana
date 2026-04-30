use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::token_interface::TokenAccount;

use crate::errors::*;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strategy_id: u64, target_program: Pubkey, discriminator: [u8; 8])]
pub struct ExecuteAction<'info> {
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        seeds = [b"strategy", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Box<Account<'info, StrategyAllocation>>,

    /// CHECK: PDA signer for strategy ATA. Signs the inner CPI.
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [
            b"allowed_action",
            strategy.key().as_ref(),
            target_program.as_ref(),
            &discriminator,
        ],
        bump = allowed_action.bump,
        constraint = allowed_action.vault == vault_state.key() @ VaultError::ActionNotAllowed,
        constraint = allowed_action.strategy == strategy.key() @ VaultError::ActionNotAllowed,
    )]
    pub allowed_action: Box<Account<'info, AllowedAction>>,

    /// Caller's wallet ATA — anti-theft snapshot point.
    #[account(
        mut,
        constraint = caller_token_ata.mint == vault_state.token_mint @ VaultError::InvalidMint,
        constraint = caller_token_ata.owner == caller.key() @ VaultError::InvalidMint,
    )]
    pub caller_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Delegate's wallet ATA — also snapshotted (audit #30 revised). When the
    /// authority is the caller this catches "authority routes funds to the
    /// agent" attacks; when caller == delegate, both ATAs point to the same
    /// account and the second check is redundant but safe.
    #[account(
        mut,
        constraint = delegate_token_ata.mint == vault_state.token_mint @ VaultError::InvalidMint,
        constraint = delegate_token_ata.owner == strategy.delegate @ VaultError::InvalidMint,
    )]
    pub delegate_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated against the `target_program` argument in handler.
    pub target_program_account: AccountInfo<'info>,

    /// CHECK: When `allowed_action.output_mint_index` is `Some`, this must
    /// be the `["allowed_token", remaining_accounts[index].key()]` PDA
    /// owned by this program. When `None`, the account is unused. Caller
    /// passes any account (e.g. SystemProgram::id) as a placeholder.
    pub allowed_output_token: AccountInfo<'info>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ExecuteAction<'info>>,
    _strategy_id: u64,
    target_program: Pubkey,
    discriminator: [u8; 8],
    ix_data: Vec<u8>,
) -> Result<()> {
    // 1. Caller is delegate or authority.
    let caller = ctx.accounts.caller.key();
    let is_delegate = caller == ctx.accounts.strategy.delegate;
    let is_authority = caller == ctx.accounts.vault_state.authority;
    require!(
        is_delegate || is_authority,
        VaultError::CallerNotDelegateOrAuthority
    );

    // 2. target_program AccountInfo matches.
    require!(
        ctx.accounts.target_program_account.key() == target_program,
        VaultError::TargetProgramMismatch
    );

    // 3. AllowedAction PDA was loaded by Anchor seeds; cross-check fields.
    let allowed = &ctx.accounts.allowed_action;
    require!(
        allowed.target_program == target_program
            && allowed.discriminator == discriminator,
        VaultError::ActionNotAllowed
    );

    // 4. Recipient pin (audit #8 — required, not optional).
    let recipient_idx = allowed.expected_recipient_index as usize;
    require!(
        recipient_idx < ctx.remaining_accounts.len(),
        VaultError::RecipientIndexOutOfRange
    );
    require!(
        ctx.remaining_accounts[recipient_idx].key() == ctx.accounts.strategy.token_account,
        VaultError::RecipientMismatch
    );

    // 4b. Phase-4d: output-mint allow-list. If the action declares an
    // `output_mint_index`, verify the mint at that slot is whitelisted
    // by checking that the supplied `allowed_output_token` AccountInfo
    // is the `["allowed_token", mint]` PDA, owned by this program, with
    // a positive lamport balance (i.e. live, not closed).
    if let Some(mint_idx) = allowed.output_mint_index {
        let i = mint_idx as usize;
        require!(
            i < ctx.remaining_accounts.len(),
            VaultError::OutputMintIndexOutOfRange
        );
        let mint_account = &ctx.remaining_accounts[i];
        let (expected_pda, _) = Pubkey::find_program_address(
            &[b"allowed_token", mint_account.key().as_ref()],
            &crate::ID,
        );
        require!(
            ctx.accounts.allowed_output_token.key() == expected_pda,
            VaultError::OutputMintNotAllowed
        );
        require!(
            ctx.accounts.allowed_output_token.lamports() > 0
                && ctx.accounts.allowed_output_token.owner == &crate::ID,
            VaultError::OutputMintNotAllowed
        );
    }

    // 5. Snapshot both caller's and delegate's ATAs (audit #30 revised).
    let caller_before = ctx.accounts.caller_token_ata.amount;
    let delegate_before = ctx.accounts.delegate_token_ata.amount;

    // 6. Build inner ix; mark the strategy_authority PDA as a signer in
    //    the metas so the protocol sees a valid authority on the
    //    strategy ATA.
    let strategy_authority_key = ctx.accounts.strategy_authority.key();
    let metas: Vec<AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .map(|ai| {
            let is_signer = ai.is_signer || ai.key() == strategy_authority_key;
            if ai.is_writable {
                AccountMeta::new(ai.key(), is_signer)
            } else {
                AccountMeta::new_readonly(ai.key(), is_signer)
            }
        })
        .collect();

    let mut data = Vec::with_capacity(8 + ix_data.len());
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(&ix_data);

    let ix = Instruction {
        program_id: target_program,
        accounts: metas,
        data,
    };

    let vault_state_key = ctx.accounts.vault_state.key();
    let strategy_id_le = ctx.accounts.strategy.strategy_id.to_le_bytes();
    let bump = ctx.accounts.strategy.authority_bump;
    let signer_seeds: &[&[u8]] = &[
        b"strategy_authority",
        vault_state_key.as_ref(),
        strategy_id_le.as_ref(),
        std::slice::from_ref(&bump),
    ];

    invoke_signed(&ix, ctx.remaining_accounts, &[signer_seeds])?;

    // 7. Anti-theft re-read on both ATAs.
    ctx.accounts.caller_token_ata.reload()?;
    ctx.accounts.delegate_token_ata.reload()?;
    require!(
        ctx.accounts.caller_token_ata.amount <= caller_before,
        VaultError::AntiTheft
    );
    require!(
        ctx.accounts.delegate_token_ata.amount <= delegate_before,
        VaultError::AntiTheft
    );

    emit!(ActionExecuted {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id: ctx.accounts.strategy.strategy_id,
        caller,
        target_program,
        discriminator,
        ix_data_len: ix_data.len() as u32,
    });
    Ok(())
}
