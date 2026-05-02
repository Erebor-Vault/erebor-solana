use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar::instructions::{
        load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID,
    },
};
use anchor_spl::token_interface::TokenAccount;

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::read_spl_token_amount;
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
        mut,
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

    /// CHECK: instructions sysvar — used by Phase-5 sibling-instruction
    /// introspection to ensure no other instruction in the same
    /// transaction touches the strategy ATA.
    #[account(address = INSTRUCTIONS_SYSVAR_ID @ VaultError::SiblingInstructionForbidden)]
    pub instructions_sysvar: AccountInfo<'info>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ExecuteAction<'info>>,
    _strategy_id: u64,
    target_program: Pubkey,
    discriminator: [u8; 8],
    ix_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // 0. Cooldown gate — rate-limit a compromised agent.
    let allowed_for_cooldown = &ctx.accounts.allowed_action;
    if allowed_for_cooldown.cooldown_secs > 0 {
        let elapsed = now.saturating_sub(allowed_for_cooldown.last_executed_at);
        require!(
            elapsed >= allowed_for_cooldown.cooldown_secs as i64,
            VaultError::ActionCooldownActive
        );
    }

    // 0b. Sibling-instruction introspection (audit #7). Reject any other
    // instruction in this transaction that touches the strategy ATA at
    // any meta slot — covers the "sibling Token::transfer signed by the
    // delegate against the strategy ATA" smuggle.
    {
        let ix_sysvar_ai = &ctx.accounts.instructions_sysvar;
        let current_idx = load_current_index_checked(ix_sysvar_ai)? as usize;
        let strategy_ata_key = ctx.accounts.strategy.token_account;
        for i in 0..MAX_INSTRUCTIONS_PER_TX {
            let probed_ix = match load_instruction_at_checked(i, ix_sysvar_ai) {
                Ok(ix) => ix,
                Err(_) => break,
            };
            if i == current_idx {
                continue;
            }
            for meta in &probed_ix.accounts {
                require!(
                    meta.pubkey != strategy_ata_key,
                    VaultError::SiblingInstructionForbidden
                );
            }
        }
    }

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

    // 5. Snapshot both caller's and delegate's ATAs (audit #30 revised),
    // plus the strategy ATA for the per-action loss cap.
    let caller_before = ctx.accounts.caller_token_ata.amount;
    let delegate_before = ctx.accounts.delegate_token_ata.amount;
    let strategy_ata_before = read_spl_token_amount(&ctx.remaining_accounts[recipient_idx])?;
    let strategy_allocated_at_call = ctx.accounts.strategy.allocated_amount;

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

    // 7b. Per-action loss cap. Cap is denominated in basis points of the
    // strategy's allocated_amount at call time. The check is over the
    // strategy ATA outflow during this call: if the ATA balance shrank
    // by more than the cap, revert. `cap == 0` disables.
    let cap_bps = ctx.accounts.allowed_action.loss_per_call_bps_cap;
    if cap_bps > 0 {
        let strategy_ata_after = read_spl_token_amount(&ctx.remaining_accounts[recipient_idx])?;
        let outflow = strategy_ata_before.saturating_sub(strategy_ata_after);
        let cap_amount: u64 = (strategy_allocated_at_call as u128)
            .checked_mul(cap_bps as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(VaultError::MathOverflow)?
            .try_into()
            .map_err(|_| error!(VaultError::MathOverflow))?;
        require!(outflow <= cap_amount, VaultError::ActionLossExceedsCap);
    }

    // 7c. Stamp the cooldown clock so the next call respects `cooldown_secs`.
    ctx.accounts.allowed_action.last_executed_at = now;

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
