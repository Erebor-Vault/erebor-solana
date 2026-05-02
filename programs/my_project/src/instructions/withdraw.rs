use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::{read_spl_token_amount, try_load_program_pda};
use crate::state::*;

#[derive(Accounts)]
pub struct Withdraw<'info> {
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
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_share_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Audit #11: program creates this on-demand if it doesn't exist so a
    /// withdrawer never gets blocked by a missing admin ATA.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint,
        associated_token::authority = admin_wallet,
        associated_token::token_program = token_program,
    )]
    pub admin_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: must equal vault_state.admin; used as ATA owner for the fee
    /// account. Pubkey validated by constraint.
    #[account(
        constraint = admin_wallet.key() == vault_state.admin @ VaultError::UnauthorizedAdmin,
    )]
    pub admin_wallet: UncheckedAccount<'info>,

    /// Treasury's underlying-token ATA — receives the protocol cut.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint,
        associated_token::authority = treasury_wallet,
        associated_token::token_program = token_program,
    )]
    pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: pubkey must equal `protocol_config.treasury`; used as ATA owner.
    #[account(
        constraint = treasury_wallet.key() == protocol_config.treasury @ VaultError::TreasuryMismatch,
    )]
    pub treasury_wallet: UncheckedAccount<'info>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
    shares_to_burn: u64,
) -> Result<()> {
    require!(shares_to_burn > 0, VaultError::ZeroAmount);

    let share_supply = ctx.accounts.share_mint.supply as u128;
    let total_deposited = ctx.accounts.vault_state.total_deposited as u128;

    // u128 share math with virtual offset (mirrors deposit / audit #2):
    //   underlying = shares × (assets + 1) / (supply + VIRTUAL_SHARES)
    let underlying_u128 = (shares_to_burn as u128)
        .checked_mul(total_deposited.checked_add(1).ok_or(VaultError::MathOverflow)?)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(share_supply.checked_add(VIRTUAL_SHARES).ok_or(VaultError::MathOverflow)?)
        .ok_or(VaultError::MathOverflow)?;
    let underlying_amount: u64 = underlying_u128
        .try_into()
        .map_err(|_| error!(VaultError::MathOverflow))?;
    require!(underlying_amount > 0, VaultError::ZeroAmount);

    // Phase 4b: auto-pull from in-ATA strategy balances when reserve is
    // short. Caller passes a flat `[strategy_pda, strategy_authority,
    // strategy_token_account]` triple per strategy in `remaining_accounts`;
    // the loop iterates id-order, pulling `min(strategy_ata.amount,
    // shortfall)` per strategy until the gap is closed. Reverts
    // `InsufficientLiquidity` if exhausting the list still doesn't cover.
    // Funds parked in *external* protocols (Kamino reserve, Drift sub-
    // account, etc.) aren't touched here — the agent / frontend is
    // expected to redeem via `execute_action` first; the redeemed funds
    // land in the strategy ATA and this loop sweeps them.
    if ctx.accounts.reserve_ata.amount < underlying_amount {
        let mut shortfall = underlying_amount
            .checked_sub(ctx.accounts.reserve_ata.amount)
            .ok_or(VaultError::MathOverflow)?;
        let vault_state_key = ctx.accounts.vault_state.key();
        let reserve_ata_info = ctx.accounts.reserve_ata.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let program_id = crate::ID;

        let chunks = ctx.remaining_accounts.chunks_exact(3);
        for chunk in chunks {
            if shortfall == 0 {
                break;
            }
            let strategy_ai = &chunk[0];
            let strategy_authority_ai = &chunk[1];
            let strategy_token_ai = &chunk[2];

            let Some(strategy) = try_load_program_pda::<StrategyAllocation>(strategy_ai)? else {
                continue;
            };
            require!(strategy.vault == vault_state_key, VaultError::AccountMismatch);
            require!(
                strategy.token_account == strategy_token_ai.key(),
                VaultError::AccountMismatch
            );

            // Re-derive strategy_authority from stored bump and check it
            // matches the AccountInfo passed in remaining_accounts.
            let strategy_id_bytes = strategy.strategy_id.to_le_bytes();
            let auth_bump_arr = [strategy.authority_bump];
            let auth_seeds: &[&[u8]] = &[
                b"strategy_authority",
                vault_state_key.as_ref(),
                strategy_id_bytes.as_ref(),
                auth_bump_arr.as_ref(),
            ];
            let expected_auth = Pubkey::create_program_address(auth_seeds, &program_id)
                .map_err(|_| error!(VaultError::AccountMismatch))?;
            require!(
                strategy_authority_ai.key() == expected_auth,
                VaultError::AccountMismatch
            );

            let strategy_token_balance = read_spl_token_amount(strategy_token_ai)?;
            let pull = std::cmp::min(strategy_token_balance, shortfall);
            if pull == 0 {
                continue;
            }

            // CPI: strategy ATA → reserve, signed by strategy_authority.
            let signer_seeds: &[&[&[u8]]] = &[auth_seeds];
            let cpi_accounts = anchor_spl::token::Transfer {
                from: strategy_token_ai.clone(),
                to: reserve_ata_info.clone(),
                authority: strategy_authority_ai.clone(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                token_program_info.clone(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, pull)?;

            // Decrement allocated_amount and write the StrategyAllocation
            // back to its account.
            let new_allocated = strategy
                .allocated_amount
                .checked_sub(pull)
                .ok_or(VaultError::MathOverflow)?;
            let mut updated = strategy;
            updated.allocated_amount = new_allocated;
            {
                let mut data = strategy_ai.try_borrow_mut_data()?;
                let mut writer: &mut [u8] = &mut data[8..];
                updated
                    .serialize(&mut writer)
                    .map_err(|_| error!(VaultError::AccountMismatch))?;
            }

            emit!(StrategyDeallocated {
                vault: vault_state_key,
                strategy: strategy_ai.key(),
                strategy_id: updated.strategy_id,
                amount: pull,
            });

            shortfall = shortfall
                .checked_sub(pull)
                .ok_or(VaultError::MathOverflow)?;
        }

        require!(shortfall == 0, VaultError::InsufficientLiquidity);
        ctx.accounts.reserve_ata.reload()?;
    }

    // After auto-pull (or if reserve was already sufficient), the post-
    // condition is the same as the legacy guard.
    require!(
        ctx.accounts.reserve_ata.amount >= underlying_amount,
        VaultError::InsufficientReserve
    );

    // Fee split: protocol_fee_bps from ProtocolConfig is fixed at the
    // protocol level (default 200 = 2 %); vault_state.performance_fee_bps
    // is the *total* fee. Curator gets the remainder.
    let total_fee_bps = ctx.accounts.vault_state.performance_fee_bps as u128;
    let protocol_fee_bps = ctx.accounts.protocol_config.protocol_fee_bps as u128;
    require!(
        total_fee_bps >= protocol_fee_bps,
        VaultError::PerformanceFeeBelowProtocolFee
    );
    let total_fee: u64 = ((underlying_amount as u128) * total_fee_bps / 10_000u128) as u64;
    let treasury_fee: u64 = ((underlying_amount as u128) * protocol_fee_bps / 10_000u128) as u64;
    let curator_fee = total_fee
        .checked_sub(treasury_fee)
        .ok_or(VaultError::MathOverflow)?;
    let user_amount = underlying_amount
        .checked_sub(total_fee)
        .ok_or(VaultError::MathOverflow)?;

    // CPI 1: burn user's shares.
    let burn_accounts = Burn {
        mint: ctx.accounts.share_mint.to_account_info(),
        from: ctx.accounts.user_share_token.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        burn_accounts,
    );
    token_interface::burn(cpi_ctx, shares_to_burn)?;

    // CPI 2: reserve → user, signed by vault_authority.
    let vault_state_key = ctx.accounts.vault_state.key();
    let auth_bump = ctx.accounts.vault_state.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault_authority",
        vault_state_key.as_ref(),
        std::slice::from_ref(&auth_bump),
    ]];

    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.reserve_ata.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    anchor_spl::token::transfer(cpi_ctx, user_amount)?;

    if treasury_fee > 0 {
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, treasury_fee)?;
    }

    if curator_fee > 0 {
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.admin_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, curator_fee)?;
    }

    if total_fee > 0 {
        emit!(PerformanceFeeCharged {
            vault: ctx.accounts.vault_state.key(),
            user: ctx.accounts.user.key(),
            gross_amount: underlying_amount,
            fee_amount: total_fee,
            treasury_fee,
            curator_fee,
            fee_bps: ctx.accounts.vault_state.performance_fee_bps,
            protocol_fee_bps: ctx.accounts.protocol_config.protocol_fee_bps,
        });
    }

    ctx.accounts.vault_state.total_deposited = ctx
        .accounts
        .vault_state
        .total_deposited
        .checked_sub(underlying_amount)
        .ok_or(VaultError::MathOverflow)?;

    emit!(Withdrawn {
        vault: ctx.accounts.vault_state.key(),
        user: ctx.accounts.user.key(),
        shares_burned: shares_to_burn,
        amount: user_amount,
    });

    Ok(())
}
