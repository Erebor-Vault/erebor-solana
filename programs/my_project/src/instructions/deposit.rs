use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::try_load_program_pda;
use crate::state::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
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
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_share_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let share_supply = ctx.accounts.share_mint.supply as u128;
    let total_deposited = ctx.accounts.vault_state.total_deposited as u128;

    // OpenZeppelin virtual-shares offset (audit #4): inflate both supply
    // and assets by constants so the first depositor cannot brute-force
    // a 1-share : N-asset ratio that rounds later depositors to 0 shares.
    //   shares = amount × (supply + VIRTUAL_SHARES) / (assets + 1)
    let shares_to_mint_u128 = (amount as u128)
        .checked_mul(share_supply.checked_add(VIRTUAL_SHARES).ok_or(VaultError::MathOverflow)?)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_deposited.checked_add(1).ok_or(VaultError::MathOverflow)?)
        .ok_or(VaultError::MathOverflow)?;
    let shares_to_mint: u64 = shares_to_mint_u128
        .try_into()
        .map_err(|_| error!(VaultError::MathOverflow))?;
    require!(shares_to_mint > 0, VaultError::ZeroAmount);

    // CPI 1: user → reserve.
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.reserve_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    anchor_spl::token::transfer(cpi_ctx, amount)?;

    // CPI 2: vault_authority signs mint_to.
    let vault_state_key = ctx.accounts.vault_state.key();
    let auth_bump = ctx.accounts.vault_state.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault_authority",
        vault_state_key.as_ref(),
        std::slice::from_ref(&auth_bump),
    ]];

    let mint_accounts = MintTo {
        mint: ctx.accounts.share_mint.to_account_info(),
        to: ctx.accounts.user_share_token.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        mint_accounts,
        signer_seeds,
    );
    token_interface::mint_to(cpi_ctx, shares_to_mint)?;

    ctx.accounts.vault_state.total_deposited = ctx
        .accounts
        .vault_state
        .total_deposited
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;

    emit!(Deposited {
        vault: vault_state_key,
        user: ctx.accounts.user.key(),
        amount,
        shares_minted: shares_to_mint,
    });

    // Phase-5: optional auto-fan-out. Caller passes
    // `[strategy_pda, strategy_token_account]` pairs in `remaining_accounts`;
    // the loop pushes `amount * strategy.target_weight_bps / 10_000` from
    // reserve into each strategy's ATA, signed by `vault_authority`. The
    // remainder stays in reserve as withdrawal-liquidity buffer (which is
    // why the per-vault sum cap of 10 000 bps is a *cap*, not a floor).
    // If `remaining_accounts` is empty, this section is a no-op (back-
    // compat with the v1 deposit shape).
    if !ctx.remaining_accounts.is_empty() {
        let auth_bump_arr = [auth_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            vault_state_key.as_ref(),
            auth_bump_arr.as_ref(),
        ]];
        let reserve_ata_info = ctx.accounts.reserve_ata.to_account_info();
        let vault_authority_info = ctx.accounts.vault_authority.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();

        // Running total of how much has been pushed out of reserve in this
        // call. Together with the per-vault `total_active_weight_bps ≤ 10_000`
        // invariant, this caps cumulative fan-out at `amount` and blocks a
        // depositor from passing duplicate `(strategy, ata)` chunks to drain
        // pre-existing reserve liquidity into a single strategy.
        let mut pushed_total: u64 = 0;
        let chunks = ctx.remaining_accounts.chunks_exact(2);
        for chunk in chunks {
            let strategy_ai = &chunk[0];
            let strategy_token_ai = &chunk[1];

            let Some(strategy) = try_load_program_pda::<StrategyAllocation>(strategy_ai)? else {
                continue;
            };
            require!(strategy.vault == vault_state_key, VaultError::AccountMismatch);
            require!(
                strategy.token_account == strategy_token_ai.key(),
                VaultError::AccountMismatch
            );
            // Inactive strategies are silently skipped; admins drain to
            // 0 before deactivating, so a stray inactive PDA in the list
            // shouldn't be fatal to the whole deposit.
            if !strategy.is_active {
                continue;
            }
            if strategy.target_weight_bps == 0 {
                continue;
            }

            let share: u64 = (amount as u128)
                .checked_mul(strategy.target_weight_bps as u128)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(VaultError::MathOverflow)?
                .try_into()
                .map_err(|_| error!(VaultError::MathOverflow))?;
            if share == 0 {
                continue;
            }

            pushed_total = pushed_total
                .checked_add(share)
                .ok_or(VaultError::MathOverflow)?;
            require!(pushed_total <= amount, VaultError::FanOutExceedsDeposit);

            // CPI: reserve → strategy ATA, signed by vault_authority.
            let cpi_accounts = anchor_spl::token::Transfer {
                from: reserve_ata_info.clone(),
                to: strategy_token_ai.clone(),
                authority: vault_authority_info.clone(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                token_program_info.clone(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, share)?;

            // Increment allocated_amount on the strategy account.
            let new_allocated = strategy
                .allocated_amount
                .checked_add(share)
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

            emit!(StrategyAllocated {
                vault: vault_state_key,
                strategy: strategy_ai.key(),
                strategy_id: updated.strategy_id,
                amount: share,
            });
        }
    }

    Ok(())
}
