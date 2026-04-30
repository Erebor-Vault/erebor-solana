// Phase 3 program: per-strategy authority PDAs + audit fixes.
//
// Two signer PDAs per vault:
//   - vault_authority   — owns reserve ATA, mints/burns share tokens.
//   - strategy_authority[i] — owns strategy i's ATA, signs CPIs that
//                             move funds out of strategy i.
//
// VaultState becomes a pure config account that never signs CPIs.

use anchor_lang::prelude::*;

use anchor_spl::token_interface::{
    self, Approve, Burn, Mint, MintTo, Revoke, TokenAccount, TokenInterface,
};

use anchor_spl::associated_token::AssociatedToken;

use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as Token2022Mint,
};

declare_id!("DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B");

/// Default performance fee charged at withdraw time (5%, in basis points).
/// This is the *total* fee deducted from a withdrawal — split inside
/// `withdraw` into a constant protocol cut (`ProtocolConfig.protocol_fee_bps`,
/// default 200 = 2%) routed to the treasury, and the remainder to the
/// vault admin (the curator).
pub const DEFAULT_PERFORMANCE_FEE_BPS: u16 = 500;

/// Hard cap on performance fee — admins cannot set above this.
pub const MAX_PERFORMANCE_FEE_BPS: u16 = 2000;

/// Default protocol cut at init time (2 %, in basis points). Carved out of
/// the total `vault_state.performance_fee_bps` and routed to
/// `ProtocolConfig.treasury`. Adjustable post-init via `set_protocol_fee_bps`,
/// gated by `ProtocolConfig.governance`.
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 200;

/// Cap on the sum of `target_weight_bps` across all *active* strategies.
pub const MAX_TOTAL_ACTIVE_WEIGHT_BPS: u16 = 10_000;

/// Virtual-shares offset for inflation-attack mitigation (audit #4 / spec §9).
/// OpenZeppelin pattern: shares = amount × (supply + VIRTUAL) / (assets + 1).
pub const VIRTUAL_SHARES: u128 = 1_000_000;

#[program]
pub mod my_project {
    use super::*;

    // ============================================================
    // VAULT INSTRUCTIONS
    // ============================================================

    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_id: u64) -> Result<()> {
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

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
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
            vault: ctx.accounts.vault_state.key(),
            user: ctx.accounts.user.key(),
            amount,
            shares_minted: shares_to_mint,
        });

        Ok(())
    }

    pub fn withdraw<'info>(
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

                // Each strategy account must be owned by this program.
                if strategy_ai.owner != &program_id {
                    continue;
                }

                // Deserialize StrategyAllocation from raw account data after
                // verifying the discriminator.
                let strategy = {
                    let data = strategy_ai.try_borrow_data()?;
                    if data.len() < 8 + StrategyAllocation::INIT_SPACE {
                        continue;
                    }
                    let mut disc = [0u8; 8];
                    disc.copy_from_slice(&data[..8]);
                    if disc != StrategyAllocation::DISCRIMINATOR {
                        continue;
                    }
                    let mut slice: &[u8] = &data[8..];
                    StrategyAllocation::deserialize(&mut slice)
                        .map_err(|_| error!(VaultError::InvalidMint))?
                };

                require!(strategy.vault == vault_state_key, VaultError::InvalidMint);
                require!(
                    strategy.token_account == strategy_token_ai.key(),
                    VaultError::InvalidMint
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
                    .map_err(|_| error!(VaultError::InvalidMint))?;
                require!(
                    strategy_authority_ai.key() == expected_auth,
                    VaultError::InvalidMint
                );

                // Read strategy ATA balance from raw bytes (offset 64..72 in
                // both classic SPL Token and Token-2022 layouts).
                let strategy_token_balance = {
                    let data = strategy_token_ai.try_borrow_data()?;
                    if data.len() < 72 {
                        continue;
                    }
                    let mut amount_bytes = [0u8; 8];
                    amount_bytes.copy_from_slice(&data[64..72]);
                    u64::from_le_bytes(amount_bytes)
                };
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
                        .map_err(|_| error!(VaultError::MathOverflow))?;
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

    // ============================================================
    // STRATEGY INSTRUCTIONS
    // ============================================================

    pub fn create_strategy(ctx: Context<CreateStrategy>) -> Result<()> {
        // Defensive dedupe: caller passes existing active strategy PDAs in
        // remaining_accounts; reject if any already uses this delegate. The
        // structural defense against cross-strategy drains is still the
        // per-strategy authority PDA — this catches admin mistakes.
        check_delegate_not_duplicated(
            ctx.remaining_accounts,
            &ctx.accounts.vault_state.key(),
            ctx.accounts.delegate.key(),
            None,
        )?;

        let strategy_id = ctx.accounts.vault_state.strategy_count;
        let strategy = &mut ctx.accounts.strategy;
        strategy.vault = ctx.accounts.vault_state.key();
        strategy.strategy_id = strategy_id;
        strategy.delegate = ctx.accounts.delegate.key();
        strategy.allocated_amount = 0;
        strategy.token_account = ctx.accounts.strategy_token_account.key();
        strategy.is_active = true;
        strategy.target_weight_bps = 0;
        strategy.bump = ctx.bumps.strategy;
        strategy.authority_bump = ctx.bumps.strategy_authority;

        // Approve delegate, signed by strategy_authority (the new ATA owner).
        let vault_state_key = ctx.accounts.vault_state.key();
        let strategy_id_le = strategy_id.to_le_bytes();
        let bump = strategy.authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"strategy_authority",
            vault_state_key.as_ref(),
            strategy_id_le.as_ref(),
            std::slice::from_ref(&bump),
        ]];

        let approve_accounts = Approve {
            to: ctx.accounts.strategy_token_account.to_account_info(),
            delegate: ctx.accounts.delegate.to_account_info(),
            authority: ctx.accounts.strategy_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            approve_accounts,
            signer_seeds,
        );
        token_interface::approve(cpi_ctx, u64::MAX)?;

        ctx.accounts.vault_state.strategy_count = ctx
            .accounts
            .vault_state
            .strategy_count
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;

        emit!(StrategyCreated {
            vault: ctx.accounts.vault_state.key(),
            strategy: strategy.key(),
            strategy_id,
            delegate: strategy.delegate,
        });

        Ok(())
    }

    pub fn allocate_to_strategy(ctx: Context<AllocateToStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

        let vault_state_key = ctx.accounts.vault_state.key();
        let auth_bump = ctx.accounts.vault_state.vault_authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            vault_state_key.as_ref(),
            std::slice::from_ref(&auth_bump),
        ]];

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.reserve_ata.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        ctx.accounts.strategy.allocated_amount = ctx
            .accounts
            .strategy
            .allocated_amount
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;

        emit!(StrategyAllocated {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id: ctx.accounts.strategy.strategy_id,
            amount,
        });

        Ok(())
    }

    pub fn deallocate_from_strategy(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        // Audit #19.
        require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

        let vault_state_key = ctx.accounts.vault_state.key();
        let strategy_id_le = ctx.accounts.strategy.strategy_id.to_le_bytes();
        let bump = ctx.accounts.strategy.authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"strategy_authority",
            vault_state_key.as_ref(),
            strategy_id_le.as_ref(),
            std::slice::from_ref(&bump),
        ]];

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.strategy_token_account.to_account_info(),
            to: ctx.accounts.reserve_ata.to_account_info(),
            authority: ctx.accounts.strategy_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        ctx.accounts.strategy.allocated_amount = ctx
            .accounts
            .strategy
            .allocated_amount
            .checked_sub(amount)
            .ok_or(VaultError::MathOverflow)?;

        emit!(StrategyDeallocated {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id: ctx.accounts.strategy.strategy_id,
            amount,
        });

        Ok(())
    }

    pub fn update_strategy_delegate(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
        // Defensive dedupe — exclude this strategy itself from the loop.
        check_delegate_not_duplicated(
            ctx.remaining_accounts,
            &ctx.accounts.vault_state.key(),
            ctx.accounts.new_delegate.key(),
            Some(&ctx.accounts.strategy.key()),
        )?;

        let vault_state_key = ctx.accounts.vault_state.key();
        let strategy_id_le = ctx.accounts.strategy.strategy_id.to_le_bytes();
        let bump = ctx.accounts.strategy.authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"strategy_authority",
            vault_state_key.as_ref(),
            strategy_id_le.as_ref(),
            std::slice::from_ref(&bump),
        ]];

        let revoke_accounts = Revoke {
            source: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.strategy_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            revoke_accounts,
            signer_seeds,
        );
        token_interface::revoke(cpi_ctx)?;

        let approve_accounts = Approve {
            to: ctx.accounts.strategy_token_account.to_account_info(),
            delegate: ctx.accounts.new_delegate.to_account_info(),
            authority: ctx.accounts.strategy_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            approve_accounts,
            signer_seeds,
        );
        token_interface::approve(cpi_ctx, u64::MAX)?;

        ctx.accounts.strategy.delegate = ctx.accounts.new_delegate.key();

        emit!(DelegateUpdated {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id: ctx.accounts.strategy.strategy_id,
            new_delegate: ctx.accounts.strategy.delegate,
        });

        Ok(())
    }

    pub fn report_yield(ctx: Context<ReportYield>) -> Result<()> {
        // Audit #20.
        require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

        let strategy = &mut ctx.accounts.strategy;
        let actual_balance = ctx.accounts.strategy_token_account.amount;

        let yield_amount = actual_balance
            .checked_sub(strategy.allocated_amount)
            .ok_or(VaultError::MathOverflow)?;

        if yield_amount > 0 {
            ctx.accounts.vault_state.total_deposited = ctx
                .accounts
                .vault_state
                .total_deposited
                .checked_add(yield_amount)
                .ok_or(VaultError::MathOverflow)?;
            strategy.allocated_amount = actual_balance;

            emit!(YieldReported {
                vault: ctx.accounts.vault_state.key(),
                strategy: strategy.key(),
                strategy_id: strategy.strategy_id,
                yield_amount,
                new_total_deposited: ctx.accounts.vault_state.total_deposited,
            });
        }

        Ok(())
    }

    /// Authority reports a realized loss on a strategy. Decrements both
    /// `strategy.allocated_amount` and `vault_state.total_deposited` by the
    /// loss. Reverts if the loss exceeds either tracked total. Audit #6.
    pub fn report_loss(ctx: Context<ReportLoss>, loss_amount: u64) -> Result<()> {
        require!(loss_amount > 0, VaultError::ZeroAmount);

        let strategy = &mut ctx.accounts.strategy;
        require!(
            loss_amount <= strategy.allocated_amount,
            VaultError::LossExceedsDeposited
        );
        require!(
            loss_amount <= ctx.accounts.vault_state.total_deposited,
            VaultError::LossExceedsDeposited
        );

        strategy.allocated_amount = strategy
            .allocated_amount
            .checked_sub(loss_amount)
            .ok_or(VaultError::MathOverflow)?;
        let new_total = ctx
            .accounts
            .vault_state
            .total_deposited
            .checked_sub(loss_amount)
            .ok_or(VaultError::MathOverflow)?;
        ctx.accounts.vault_state.total_deposited = new_total;

        emit!(LossReported {
            vault: ctx.accounts.vault_state.key(),
            strategy: strategy.key(),
            strategy_id: strategy.strategy_id,
            amount: loss_amount,
            new_total_deposited: new_total,
        });

        Ok(())
    }

    pub fn deactivate_strategy(ctx: Context<DeactivateStrategy>) -> Result<()> {
        require!(
            ctx.accounts.strategy.allocated_amount == 0,
            VaultError::StrategyStillHoldsFunds
        );
        require!(
            ctx.accounts.strategy_token_account.amount == 0,
            VaultError::StrategyStillHoldsFunds
        );

        let vault_state_key = ctx.accounts.vault_state.key();
        let strategy_id_le = ctx.accounts.strategy.strategy_id.to_le_bytes();
        let bump = ctx.accounts.strategy.authority_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"strategy_authority",
            vault_state_key.as_ref(),
            strategy_id_le.as_ref(),
            std::slice::from_ref(&bump),
        ]];

        let revoke_accounts = Revoke {
            source: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.strategy_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            revoke_accounts,
            signer_seeds,
        );
        token_interface::revoke(cpi_ctx)?;

        // Decrement the active-weight invariant before flipping is_active.
        let prior_weight = ctx.accounts.strategy.target_weight_bps;
        if prior_weight > 0 {
            ctx.accounts.vault_state.total_active_weight_bps = ctx
                .accounts
                .vault_state
                .total_active_weight_bps
                .checked_sub(prior_weight)
                .ok_or(VaultError::MathOverflow)?;
        }

        ctx.accounts.strategy.is_active = false;
        ctx.accounts.strategy.target_weight_bps = 0;

        emit!(StrategyDeactivated {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id: ctx.accounts.strategy.strategy_id,
        });

        Ok(())
    }

    // ============================================================
    // PROTOCOL CONFIG (treasury + governance, single global PDA)
    // ============================================================
    //
    // One global `ProtocolConfig` PDA at seeds `["protocol_config"]` owns:
    //   - `governance` — pubkey allowed to call `set_*` here. Initialised to
    //     whoever first calls `initialize_protocol_config`; intended to be
    //     the deployer / multisig.
    //   - `treasury` — pubkey whose underlying ATA receives the protocol cut
    //     of every withdrawal.
    //   - `protocol_fee_bps` — constant slice carved from each vault's
    //     `performance_fee_bps`. Default 200 (= 2 %); changeable by
    //     governance up to `MAX_PERFORMANCE_FEE_BPS`. The remainder of
    //     `performance_fee_bps − protocol_fee_bps` is the curator's share.

    pub fn initialize_protocol_config(
        ctx: Context<InitializeProtocolConfig>,
        treasury: Pubkey,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        require!(
            protocol_fee_bps <= MAX_PERFORMANCE_FEE_BPS,
            VaultError::FeeExceedsMax
        );
        let cfg = &mut ctx.accounts.protocol_config;
        cfg.governance = ctx.accounts.governance.key();
        cfg.treasury = treasury;
        cfg.protocol_fee_bps = protocol_fee_bps;
        cfg.bump = ctx.bumps.protocol_config;

        emit!(ProtocolConfigInitialized {
            governance: cfg.governance,
            treasury,
            protocol_fee_bps,
        });
        Ok(())
    }

    pub fn set_treasury(ctx: Context<ProtocolGovernanceOnly>, new_treasury: Pubkey) -> Result<()> {
        let previous = ctx.accounts.protocol_config.treasury;
        ctx.accounts.protocol_config.treasury = new_treasury;
        emit!(TreasurySet { previous, new_treasury });
        Ok(())
    }

    pub fn set_protocol_fee_bps(ctx: Context<ProtocolGovernanceOnly>, new_bps: u16) -> Result<()> {
        require!(new_bps <= MAX_PERFORMANCE_FEE_BPS, VaultError::FeeExceedsMax);
        let previous = ctx.accounts.protocol_config.protocol_fee_bps;
        ctx.accounts.protocol_config.protocol_fee_bps = new_bps;
        emit!(ProtocolFeeBpsSet { previous_bps: previous, new_bps });
        Ok(())
    }

    pub fn set_governance(ctx: Context<ProtocolGovernanceOnly>, new_governance: Pubkey) -> Result<()> {
        let previous = ctx.accounts.protocol_config.governance;
        ctx.accounts.protocol_config.governance = new_governance;
        emit!(GovernanceSet { previous, new_governance });
        Ok(())
    }

    // ============================================================
    // TOKEN WHITELIST (Phase-4d)
    // ============================================================
    //
    // One PDA per allowed mint at seeds `["allowed_token", mint]`. Only
    // mints that have a live PDA can appear as the *output* of a
    // whitelisted action — `execute_action` enforces this via the
    // `output_mint_index` field on `AllowedAction`. This stops a
    // compromised agent from swapping the strategy's USDC into a worthless
    // token through an otherwise-whitelisted DEX route.

    pub fn add_allowed_token(ctx: Context<AddAllowedToken>, mint: Pubkey) -> Result<()> {
        let token = &mut ctx.accounts.allowed_token;
        token.mint = mint;
        token.bump = ctx.bumps.allowed_token;
        emit!(AllowedTokenAdded { mint });
        Ok(())
    }

    pub fn remove_allowed_token(ctx: Context<RemoveAllowedToken>, _mint: Pubkey) -> Result<()> {
        emit!(AllowedTokenRemoved {
            mint: ctx.accounts.allowed_token.mint,
        });
        Ok(())
    }

    // ============================================================
    // ADMIN MANAGEMENT (two-step)
    // ============================================================

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.vault_state.pending_admin = new_admin;
        emit!(AdminProposed {
            vault: ctx.accounts.vault_state.key(),
            current_admin: ctx.accounts.vault_state.admin,
            pending_admin: new_admin,
        });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let pending = ctx.accounts.vault_state.pending_admin;
        require!(
            pending != Pubkey::default() && pending == ctx.accounts.new_admin.key(),
            VaultError::NotPendingAdmin
        );

        let previous = ctx.accounts.vault_state.admin;
        ctx.accounts.vault_state.admin = pending;
        ctx.accounts.vault_state.pending_admin = Pubkey::default();

        emit!(AdminTransferred {
            vault: ctx.accounts.vault_state.key(),
            previous_admin: previous,
            new_admin: pending,
        });

        Ok(())
    }

    pub fn propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.vault_state.pending_authority = new_authority;
        emit!(AuthorityProposed {
            vault: ctx.accounts.vault_state.key(),
            current_authority: ctx.accounts.vault_state.authority,
            pending_authority: new_authority,
        });
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let pending = ctx.accounts.vault_state.pending_authority;
        require!(
            pending != Pubkey::default() && pending == ctx.accounts.new_authority.key(),
            VaultError::NotPendingAuthority
        );

        let previous = ctx.accounts.vault_state.authority;
        ctx.accounts.vault_state.authority = pending;
        ctx.accounts.vault_state.pending_authority = Pubkey::default();

        emit!(AuthoritySet {
            vault: ctx.accounts.vault_state.key(),
            previous_authority: previous,
            new_authority: pending,
        });

        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.vault_state.paused = paused;
        emit!(PausedToggled {
            vault: ctx.accounts.vault_state.key(),
            paused,
        });
        Ok(())
    }

    pub fn set_performance_fee_bps(ctx: Context<SetPerformanceFeeBps>, new_bps: u16) -> Result<()> {
        require!(new_bps <= MAX_PERFORMANCE_FEE_BPS, VaultError::FeeExceedsMax);
        // The total fee floor is the protocol cut — admin cannot set the
        // total below it (would mean a negative curator share).
        require!(
            new_bps >= ctx.accounts.protocol_config.protocol_fee_bps,
            VaultError::PerformanceFeeBelowProtocolFee
        );
        let previous = ctx.accounts.vault_state.performance_fee_bps;
        ctx.accounts.vault_state.performance_fee_bps = new_bps;
        emit!(PerformanceFeeSet {
            vault: ctx.accounts.vault_state.key(),
            previous_bps: previous,
            new_bps,
        });
        Ok(())
    }

    // ============================================================
    // REBALANCING
    // ============================================================

    pub fn set_strategy_weight(ctx: Context<SetStrategyWeight>, weight_bps: u16) -> Result<()> {
        require!(weight_bps <= MAX_TOTAL_ACTIVE_WEIGHT_BPS, VaultError::WeightExceedsMax);

        let prior_weight = ctx.accounts.strategy.target_weight_bps;
        // Audit #18: enforce sum ≤ 10_000 across active strategies.
        let new_total = ctx
            .accounts
            .vault_state
            .total_active_weight_bps
            .checked_sub(prior_weight)
            .ok_or(VaultError::MathOverflow)?
            .checked_add(weight_bps)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            new_total <= MAX_TOTAL_ACTIVE_WEIGHT_BPS,
            VaultError::WeightSumExceedsMax
        );

        ctx.accounts.strategy.target_weight_bps = weight_bps;
        ctx.accounts.vault_state.total_active_weight_bps = new_total;

        emit!(StrategyWeightSet {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id: ctx.accounts.strategy.strategy_id,
            weight_bps,
        });
        Ok(())
    }

    /// Rebalance is now authority-only (audit #5). The two transfer legs sign
    /// as different PDAs: in-leg (reserve → strategy) signs as
    /// `vault_authority`; out-leg signs as `strategy_authority[i]`.
    pub fn rebalance_strategy(ctx: Context<RebalanceStrategy>) -> Result<()> {
        require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

        let strategy_id = ctx.accounts.strategy.strategy_id;
        let weight_bps = ctx.accounts.strategy.target_weight_bps;
        let current = ctx.accounts.strategy.allocated_amount;
        let total_deposited = ctx.accounts.vault_state.total_deposited;
        let vault_state_key = ctx.accounts.vault_state.key();
        let vault_auth_bump = ctx.accounts.vault_state.vault_authority_bump;
        let strategy_id_le = strategy_id.to_le_bytes();
        let strat_auth_bump = ctx.accounts.strategy.authority_bump;

        let target_amount: u64 = (total_deposited as u128)
            .checked_mul(weight_bps as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(VaultError::MathOverflow)?
            .try_into()
            .map_err(|_| error!(VaultError::MathOverflow))?;

        if target_amount == current {
            return Ok(());
        }

        if target_amount > current {
            let delta = target_amount.checked_sub(current).ok_or(VaultError::MathOverflow)?;
            require!(
                ctx.accounts.reserve_ata.amount >= delta,
                VaultError::InsufficientReserveForRebalance
            );

            let signer_seeds: &[&[&[u8]]] = &[&[
                b"vault_authority",
                vault_state_key.as_ref(),
                std::slice::from_ref(&vault_auth_bump),
            ]];

            let cpi_accounts = anchor_spl::token::Transfer {
                from: ctx.accounts.reserve_ata.to_account_info(),
                to: ctx.accounts.strategy_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, delta)?;

            ctx.accounts.strategy.allocated_amount = target_amount;
            emit!(Rebalanced {
                vault: vault_state_key,
                strategy: ctx.accounts.strategy.key(),
                strategy_id,
                delta_signed: delta as i64,
                new_allocated: target_amount,
            });
        } else {
            let delta = current.checked_sub(target_amount).ok_or(VaultError::MathOverflow)?;

            let signer_seeds: &[&[&[u8]]] = &[&[
                b"strategy_authority",
                vault_state_key.as_ref(),
                strategy_id_le.as_ref(),
                std::slice::from_ref(&strat_auth_bump),
            ]];

            let cpi_accounts = anchor_spl::token::Transfer {
                from: ctx.accounts.strategy_token_account.to_account_info(),
                to: ctx.accounts.reserve_ata.to_account_info(),
                authority: ctx.accounts.strategy_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            anchor_spl::token::transfer(cpi_ctx, delta)?;

            ctx.accounts.strategy.allocated_amount = target_amount;
            emit!(Rebalanced {
                vault: vault_state_key,
                strategy: ctx.accounts.strategy.key(),
                strategy_id,
                delta_signed: -(delta as i64),
                new_allocated: target_amount,
            });
        }

        Ok(())
    }

    // ============================================================
    // ALLOWED-ACTION WHITELIST + EXECUTE_ACTION
    // ============================================================

    pub fn add_allowed_action(
        ctx: Context<AddAllowedAction>,
        strategy_id: u64,
        target_program: Pubkey,
        discriminator: [u8; 8],
        expected_recipient_index: u16,
        // Phase-4d: optional slot in remaining_accounts that must be a
        // mint pubkey. When set, execute_action requires the mint to be
        // on the protocol-level allow-list (an `AllowedToken` PDA).
        output_mint_index: Option<u16>,
    ) -> Result<()> {
        let allowed = &mut ctx.accounts.allowed_action;
        allowed.vault = ctx.accounts.vault_state.key();
        allowed.strategy = ctx.accounts.strategy.key();
        allowed.strategy_id = strategy_id;
        allowed.target_program = target_program;
        allowed.discriminator = discriminator;
        allowed.expected_recipient_index = expected_recipient_index;
        allowed.output_mint_index = output_mint_index;
        allowed.bump = ctx.bumps.allowed_action;

        emit!(AllowedActionAdded {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id,
            target_program,
            discriminator,
            expected_recipient_index,
            output_mint_index,
        });
        Ok(())
    }

    pub fn remove_allowed_action(
        ctx: Context<RemoveAllowedAction>,
        _strategy_id: u64,
        target_program: Pubkey,
        discriminator: [u8; 8],
    ) -> Result<()> {
        emit!(AllowedActionRemoved {
            vault: ctx.accounts.vault_state.key(),
            strategy: ctx.accounts.strategy.key(),
            strategy_id: ctx.accounts.strategy.strategy_id,
            target_program,
            discriminator,
        });
        Ok(())
    }

    pub fn execute_action<'info>(
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
}

// ============================================================
// HELPERS
// ============================================================

fn reject_dangerous_mint_extensions(mint: &InterfaceAccount<'_, Mint>) -> Result<()> {
    let info = mint.to_account_info();
    // Classic SPL Token mints have no extensions; only inspect Token-2022.
    if info.owner != &anchor_spl::token_2022::spl_token_2022::ID {
        return Ok(());
    }
    let data = info.try_borrow_data()?;
    let mint_with_ext = StateWithExtensions::<Token2022Mint>::unpack(&data)
        .map_err(|_| error!(VaultError::InvalidMint))?;
    let exts = mint_with_ext
        .get_extension_types()
        .map_err(|_| error!(VaultError::InvalidMint))?;
    require!(
        !exts.contains(&ExtensionType::TransferHook),
        VaultError::MintHasTransferHook
    );
    require!(
        !exts.contains(&ExtensionType::PermanentDelegate),
        VaultError::MintHasPermanentDelegate
    );
    Ok(())
}

fn check_delegate_not_duplicated(
    other_strategies: &[AccountInfo<'_>],
    vault_state_key: &Pubkey,
    new_delegate: Pubkey,
    skip_strategy_key: Option<&Pubkey>,
) -> Result<()> {
    let program_id = crate::ID;
    for ai in other_strategies.iter() {
        if ai.owner != &program_id {
            continue;
        }
        if let Some(skip) = skip_strategy_key {
            if ai.key == skip {
                continue;
            }
        }
        let data = ai.try_borrow_data()?;
        if data.len() < 8 + StrategyAllocation::INIT_SPACE {
            continue;
        }
        // Verify Anchor discriminator before deserializing.
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&data[..8]);
        if disc != StrategyAllocation::DISCRIMINATOR {
            continue;
        }
        // Discriminator already validated above; deserialize the rest with
        // raw Borsh. (`try_deserialize_unchecked` would re-advance past the
        // discriminator and corrupt the read.)
        let mut slice: &[u8] = &data[8..];
        let acct = StrategyAllocation::deserialize(&mut slice)
            .map_err(|_| error!(VaultError::InvalidMint))?;
        if acct.vault == *vault_state_key && acct.is_active && acct.delegate == new_delegate {
            return err!(VaultError::DuplicateDelegate);
        }
    }
    Ok(())
}

// ============================================================
// ERROR CODES
// ============================================================

#[error_code]
pub enum VaultError {
    #[msg("Insufficient balance in source account")]
    InsufficientBalance,

    #[msg("Insufficient reserve for withdrawal")]
    InsufficientReserve,

    #[msg("Strategy is not active")]
    StrategyInactive,

    #[msg("Unauthorized: not admin")]
    UnauthorizedAdmin,

    #[msg("Unauthorized: not authority")]
    UnauthorizedAuthority,

    #[msg("Invalid token mint")]
    InvalidMint,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Weight exceeds maximum of 10000 basis points")]
    WeightExceedsMax,

    #[msg("Insufficient reserve for rebalance allocation")]
    InsufficientReserveForRebalance,

    #[msg("Vault is paused")]
    VaultPaused,

    #[msg("Strategy still holds funds — deallocate to zero before deactivating")]
    StrategyStillHoldsFunds,

    #[msg("Unauthorized: caller is neither delegate nor authority")]
    CallerNotDelegateOrAuthority,

    #[msg("Target program account does not match requested target")]
    TargetProgramMismatch,

    #[msg("Action not allowed for this strategy")]
    ActionNotAllowed,

    #[msg("Expected recipient index is out of range")]
    RecipientIndexOutOfRange,

    #[msg("Recipient at expected index is not the strategy token account")]
    RecipientMismatch,

    #[msg("Anti-theft: caller or delegate ATA balance grew during execute_action")]
    AntiTheft,

    #[msg("Fee bps exceeds protocol cap")]
    FeeExceedsMax,

    #[msg("Reported loss exceeds tracked deposit total")]
    LossExceedsDeposited,

    #[msg("Caller is not the pending admin")]
    NotPendingAdmin,

    #[msg("Caller is not the pending authority")]
    NotPendingAuthority,

    #[msg("Sum of active strategy weights would exceed 10000 bps")]
    WeightSumExceedsMax,

    #[msg("Token mint carries a TransferHook extension; not supported")]
    MintHasTransferHook,

    #[msg("Token mint carries a PermanentDelegate extension; not supported")]
    MintHasPermanentDelegate,

    #[msg("Delegate is already used by another active strategy in this vault")]
    DuplicateDelegate,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Caller is not the protocol governance")]
    UnauthorizedGovernance,

    #[msg("Treasury account mismatch with protocol_config.treasury")]
    TreasuryMismatch,

    #[msg("performance_fee_bps cannot be set below the protocol cut")]
    PerformanceFeeBelowProtocolFee,

    #[msg("Reserve plus available strategy ATAs cannot cover the requested withdrawal")]
    InsufficientLiquidity,

    #[msg("Output mint is not on the protocol allow-list")]
    OutputMintNotAllowed,

    #[msg("Output mint index is out of range of remaining_accounts")]
    OutputMintIndexOutOfRange,
}

// ============================================================
// ACCOUNT VALIDATION STRUCTS
// ============================================================

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

#[derive(Accounts)]
pub struct CreateStrategy<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = admin,
        space = 8 + StrategyAllocation::INIT_SPACE,
        seeds = [b"strategy", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer derived from (vault_state, strategy_count).
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"strategy_token", vault_state.key().as_ref(), &vault_state.strategy_count.to_le_bytes()],
        bump,
        token::mint = token_mint,
        token::authority = strategy_authority,
        token::token_program = token_program,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: protocol address to approve as delegate.
    pub delegate: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AllocateToStrategy<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer for the reserve ATA.
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump = vault_state.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct DeallocateFromStrategy<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer for the reserve ATA.
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump = vault_state.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA.
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy.strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UpdateStrategyDelegate<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA.
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy.strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: new delegate address.
    pub new_delegate: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ReportYield<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// Audit #14: pin the ATA's mint to the vault's underlying mint.
    #[account(
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
        constraint = strategy_token_account.mint == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct ReportLoss<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
    )]
    pub strategy: Account<'info, StrategyAllocation>,
}

#[derive(Accounts)]
pub struct DeactivateStrategy<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA.
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy.strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct ProposeAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct SetPerformanceFeeBps<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct SetStrategyWeight<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,
}

#[derive(Accounts)]
pub struct RebalanceStrategy<'info> {
    /// Audit #5: rebalance is now authority-only.
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ VaultError::UnauthorizedAuthority,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer for reserve ATA (in-leg).
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump = vault_state.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    /// CHECK: PDA signer for strategy ATA (out-leg).
    #[account(
        seeds = [b"strategy_authority", vault_state.key().as_ref(), &strategy.strategy_id.to_le_bytes()],
        bump = strategy.authority_bump,
    )]
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint.key() == vault_state.token_mint @ VaultError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = strategy_token_account.key() == strategy.token_account @ VaultError::InvalidMint,
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(strategy_id: u64, target_program: Pubkey, discriminator: [u8; 8])]
pub struct AddAllowedAction<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"strategy", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
        constraint = strategy.is_active @ VaultError::StrategyInactive,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        init,
        payer = admin,
        space = 8 + AllowedAction::INIT_SPACE,
        seeds = [
            b"allowed_action",
            strategy.key().as_ref(),
            target_program.as_ref(),
            &discriminator,
        ],
        bump,
    )]
    pub allowed_action: Account<'info, AllowedAction>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(strategy_id: u64, target_program: Pubkey, discriminator: [u8; 8])]
pub struct RemoveAllowedAction<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref(), &vault_state.vault_id.to_le_bytes()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ VaultError::UnauthorizedAdmin,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"strategy", vault_state.key().as_ref(), &strategy_id.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.vault == vault_state.key() @ VaultError::InvalidMint,
    )]
    pub strategy: Account<'info, StrategyAllocation>,

    #[account(
        mut,
        close = admin,
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
    pub allowed_action: Account<'info, AllowedAction>,
}

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

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct AddAllowedToken<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
        constraint = protocol_config.governance == governance.key() @ VaultError::UnauthorizedGovernance,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = governance,
        space = 8 + AllowedToken::INIT_SPACE,
        seeds = [b"allowed_token", mint.as_ref()],
        bump,
    )]
    pub allowed_token: Account<'info, AllowedToken>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct RemoveAllowedToken<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
        constraint = protocol_config.governance == governance.key() @ VaultError::UnauthorizedGovernance,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        close = governance,
        seeds = [b"allowed_token", mint.as_ref()],
        bump = allowed_token.bump,
    )]
    pub allowed_token: Account<'info, AllowedToken>,
}

#[derive(Accounts)]
pub struct InitializeProtocolConfig<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,

    #[account(
        init,
        payer = governance,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [b"protocol_config"],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProtocolGovernanceOnly<'info> {
    pub governance: Signer<'info>,

    #[account(
        mut,
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
        constraint = protocol_config.governance == governance.key() @ VaultError::UnauthorizedGovernance,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

// ============================================================
// DATA ACCOUNTS
// ============================================================

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_id: u64,
    pub total_deposited: u64,
    pub strategy_count: u64,
    pub bump: u8,
    pub share_mint_bump: u8,
    /// Audit refactor: stored bump for the vault_authority PDA so signing
    /// CPIs doesn't recompute it every call.
    pub vault_authority_bump: u8,
    pub paused: bool,
    pub performance_fee_bps: u16,
    /// Audit #18: invariant `sum(target_weight_bps for active strategies) ≤ 10_000`.
    pub total_active_weight_bps: u16,
    /// Audit #21: two-step admin transfer. `Pubkey::default()` means no pending.
    pub pending_admin: Pubkey,
    pub pending_authority: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct StrategyAllocation {
    pub vault: Pubkey,
    pub strategy_id: u64,
    pub delegate: Pubkey,
    pub allocated_amount: u64,
    pub token_account: Pubkey,
    pub is_active: bool,
    pub target_weight_bps: u16,
    pub bump: u8,
    /// Stored bump for the strategy_authority PDA.
    pub authority_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AllowedAction {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    /// Audit #8: index in remaining_accounts that must equal
    /// `strategy.token_account`. No longer optional.
    pub expected_recipient_index: u16,
    /// Phase-4d: when `Some`, the mint at
    /// `remaining_accounts[output_mint_index]` must be on the protocol
    /// allow-list (an `AllowedToken` PDA must exist). Used to gate
    /// swap-style actions (Jupiter route, Drift open-position) so a
    /// compromised agent can't pivot the strategy into a worthless asset.
    pub output_mint_index: Option<u16>,
    pub bump: u8,
}

/// Per-mint protocol-level allow-list entry. Existence of the PDA at
/// `["allowed_token", mint]` is the whitelist check; the data carries
/// just the mint pubkey (for off-chain `program.account.allowedToken.all()`
/// queries) and the bump.
#[account]
#[derive(InitSpace)]
pub struct AllowedToken {
    pub mint: Pubkey,
    pub bump: u8,
}

/// Global protocol configuration. Single PDA at seeds `["protocol_config"]`.
/// `governance` gates `set_treasury`, `set_protocol_fee_bps`, and
/// `set_governance`. `protocol_fee_bps` is the constant slice carved from
/// every vault's `performance_fee_bps` and routed to `treasury`'s
/// underlying ATA at withdraw time.
#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub governance: Pubkey,
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
    pub bump: u8,
}

// ============================================================
// EVENTS
// ============================================================

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_id: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_minted: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub amount: u64,
}

#[event]
pub struct StrategyCreated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub delegate: Pubkey,
}

#[event]
pub struct StrategyAllocated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub amount: u64,
}

#[event]
pub struct StrategyDeallocated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub amount: u64,
}

#[event]
pub struct StrategyWeightSet {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub weight_bps: u16,
}

#[event]
pub struct DelegateUpdated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub new_delegate: Pubkey,
}

#[event]
pub struct StrategyDeactivated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
}

#[event]
pub struct YieldReported {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub yield_amount: u64,
    pub new_total_deposited: u64,
}

#[event]
pub struct LossReported {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub amount: u64,
    pub new_total_deposited: u64,
}

#[event]
pub struct Rebalanced {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub delta_signed: i64,
    pub new_allocated: u64,
}

#[event]
pub struct AdminProposed {
    pub vault: Pubkey,
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub vault: Pubkey,
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AuthorityProposed {
    pub vault: Pubkey,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthoritySet {
    pub vault: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct PausedToggled {
    pub vault: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AllowedActionAdded {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    pub expected_recipient_index: u16,
    pub output_mint_index: Option<u16>,
}

#[event]
pub struct AllowedActionRemoved {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
}

#[event]
pub struct AllowedTokenAdded {
    pub mint: Pubkey,
}

#[event]
pub struct AllowedTokenRemoved {
    pub mint: Pubkey,
}

#[event]
pub struct ActionExecuted {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub caller: Pubkey,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    pub ix_data_len: u32,
}

#[event]
pub struct PerformanceFeeCharged {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub treasury_fee: u64,
    pub curator_fee: u64,
    pub fee_bps: u16,
    pub protocol_fee_bps: u16,
}

#[event]
pub struct PerformanceFeeSet {
    pub vault: Pubkey,
    pub previous_bps: u16,
    pub new_bps: u16,
}

#[event]
pub struct ProtocolConfigInitialized {
    pub governance: Pubkey,
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
}

#[event]
pub struct TreasurySet {
    pub previous: Pubkey,
    pub new_treasury: Pubkey,
}

#[event]
pub struct ProtocolFeeBpsSet {
    pub previous_bps: u16,
    pub new_bps: u16,
}

#[event]
pub struct GovernanceSet {
    pub previous: Pubkey,
    pub new_governance: Pubkey,
}
