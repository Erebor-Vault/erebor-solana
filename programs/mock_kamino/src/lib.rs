// mock_kamino — Minimal mock of Kamino kLend lending market for devnet testing.
//
// Simulates a multi-asset lending protocol with collateral, borrowing, and
// health-factor checks. Supports BTC, SOL, and USDC. Yield accrues via an
// admin/crank instruction that mints tokens into a reserve's supply treasury.
//
// Account model:
//   PriceOracle (singleton)        — admin-set USD prices for BTC, SOL, USDC
//   Reserve (per token mint)        — APYs and total supply/borrow tracking
//   Obligation (per strategy)       — per-strategy supplied/borrowed amounts
//   Treasury (per token mint)       — PDA token account holding all deposits
//
// Health factor:
//   collateral_value_usd = Σ(supplied_amount * price)
//   debt_value_usd       = Σ(borrowed_amount * price)
//   HF = collateral_value_usd / debt_value_usd
// Withdraw and borrow are rejected if the resulting HF would drop below 1.05.
//
// Prices are denominated in micro-USD (1 USDC = 1_000_000), so a BTC price
// of 60_000_000_000 means 60_000 USD per BTC, etc. Token amounts are raw u64
// in the asset's smallest unit (e.g., lamports for SOL, satoshis for BTC).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK");

pub const HF_MIN_BPS: u128 = 10500; // 1.05 minimum health factor (in basis points)

#[program]
pub mod mock_kamino {
    use super::*;

    // ── Oracle ───────────────────────────────────────────────────────────

    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        usdc_price: u64,
        btc_price: u64,
        sol_price: u64,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        oracle.admin = ctx.accounts.admin.key();
        oracle.usdc_price = usdc_price;
        oracle.btc_price = btc_price;
        oracle.sol_price = sol_price;
        oracle.bump = ctx.bumps.oracle;
        msg!("Mock Kamino oracle initialized");
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, asset: u8, new_price: u64) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        match asset {
            0 => oracle.usdc_price = new_price, // USDC
            1 => oracle.btc_price = new_price,  // BTC
            2 => oracle.sol_price = new_price,  // SOL
            _ => return err!(MockKaminoError::InvalidAsset),
        }
        msg!("Price updated for asset {}: {}", asset, new_price);
        Ok(())
    }

    // ── Reserve ──────────────────────────────────────────────────────────

    pub fn initialize_reserve(
        ctx: Context<InitializeReserve>,
        supply_apy_bps: u16,
        borrow_apy_bps: u16,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.mint = ctx.accounts.mint.key();
        reserve.supply_treasury = ctx.accounts.treasury.key();
        reserve.supply_apy_bps = supply_apy_bps;
        reserve.borrow_apy_bps = borrow_apy_bps;
        reserve.total_supplied = 0;
        reserve.total_borrowed = 0;
        reserve.bump = ctx.bumps.reserve;
        msg!("Reserve initialized for mint {:?}", reserve.mint);
        Ok(())
    }

    // ── Obligation ───────────────────────────────────────────────────────

    pub fn initialize_obligation(ctx: Context<InitializeObligation>) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.strategy_token_account = ctx.accounts.strategy_token_account.key();
        obligation.usdc_supplied = 0;
        obligation.usdc_borrowed = 0;
        obligation.btc_supplied = 0;
        obligation.btc_borrowed = 0;
        obligation.sol_supplied = 0;
        obligation.sol_borrowed = 0;
        obligation.bump = ctx.bumps.obligation;
        msg!(
            "Obligation initialized for strategy {:?}",
            obligation.strategy_token_account
        );
        Ok(())
    }

    // ── Deposit ──────────────────────────────────────────────────────────

    pub fn deposit(ctx: Context<Deposit>, asset: u8, amount: u64) -> Result<()> {
        require!(amount > 0, MockKaminoError::ZeroAmount);

        // Transfer tokens: user → treasury
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.user_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update obligation
        let obligation = &mut ctx.accounts.obligation;
        match asset {
            0 => obligation.usdc_supplied = obligation.usdc_supplied.checked_add(amount).ok_or(MockKaminoError::Overflow)?,
            1 => obligation.btc_supplied = obligation.btc_supplied.checked_add(amount).ok_or(MockKaminoError::Overflow)?,
            2 => obligation.sol_supplied = obligation.sol_supplied.checked_add(amount).ok_or(MockKaminoError::Overflow)?,
            _ => return err!(MockKaminoError::InvalidAsset),
        }

        // Update reserve total
        let reserve = &mut ctx.accounts.reserve;
        reserve.total_supplied = reserve.total_supplied.checked_add(amount).ok_or(MockKaminoError::Overflow)?;

        msg!("Deposit: asset={} amount={}", asset, amount);
        Ok(())
    }

    // ── Withdraw ─────────────────────────────────────────────────────────

    pub fn withdraw(ctx: Context<Withdraw>, asset: u8, amount: u64) -> Result<()> {
        require!(amount > 0, MockKaminoError::ZeroAmount);

        // Snapshot supplied/borrowed for the obligation BEFORE the withdraw
        let mut sim_usdc_s = ctx.accounts.obligation.usdc_supplied;
        let mut sim_btc_s = ctx.accounts.obligation.btc_supplied;
        let mut sim_sol_s = ctx.accounts.obligation.sol_supplied;
        match asset {
            0 => {
                require!(sim_usdc_s >= amount, MockKaminoError::InsufficientCollateral);
                sim_usdc_s -= amount;
            }
            1 => {
                require!(sim_btc_s >= amount, MockKaminoError::InsufficientCollateral);
                sim_btc_s -= amount;
            }
            2 => {
                require!(sim_sol_s >= amount, MockKaminoError::InsufficientCollateral);
                sim_sol_s -= amount;
            }
            _ => return err!(MockKaminoError::InvalidAsset),
        }

        // Health factor check on the simulated state
        let oracle = &ctx.accounts.oracle;
        let obligation = &ctx.accounts.obligation;
        let collateral_value = collateral_value_usd(
            sim_usdc_s,
            sim_btc_s,
            sim_sol_s,
            oracle,
        );
        let debt_value = debt_value_usd(
            obligation.usdc_borrowed,
            obligation.btc_borrowed,
            obligation.sol_borrowed,
            oracle,
        );
        if debt_value > 0 {
            let hf_bps = collateral_value
                .checked_mul(10000)
                .ok_or(MockKaminoError::Overflow)?
                .checked_div(debt_value)
                .ok_or(MockKaminoError::Overflow)?;
            require!(hf_bps >= HF_MIN_BPS, MockKaminoError::HealthFactorTooLow);
        }

        // Transfer tokens: treasury → user
        // Treasury PDA signs via its own seeds
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.treasury],
        ]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        // Commit obligation update
        let obligation = &mut ctx.accounts.obligation;
        match asset {
            0 => obligation.usdc_supplied = sim_usdc_s,
            1 => obligation.btc_supplied = sim_btc_s,
            2 => obligation.sol_supplied = sim_sol_s,
            _ => return err!(MockKaminoError::InvalidAsset),
        }

        // Update reserve
        let reserve = &mut ctx.accounts.reserve;
        reserve.total_supplied = reserve.total_supplied.saturating_sub(amount);

        msg!("Withdraw: asset={} amount={}", asset, amount);
        Ok(())
    }

    // ── Borrow ───────────────────────────────────────────────────────────

    pub fn borrow(ctx: Context<Borrow>, asset: u8, amount: u64) -> Result<()> {
        require!(amount > 0, MockKaminoError::ZeroAmount);

        // Simulate the new debt
        let obligation = &ctx.accounts.obligation;
        let mut sim_usdc_b = obligation.usdc_borrowed;
        let mut sim_btc_b = obligation.btc_borrowed;
        let mut sim_sol_b = obligation.sol_borrowed;
        match asset {
            0 => sim_usdc_b = sim_usdc_b.checked_add(amount).ok_or(MockKaminoError::Overflow)?,
            1 => sim_btc_b = sim_btc_b.checked_add(amount).ok_or(MockKaminoError::Overflow)?,
            2 => sim_sol_b = sim_sol_b.checked_add(amount).ok_or(MockKaminoError::Overflow)?,
            _ => return err!(MockKaminoError::InvalidAsset),
        }

        // Health factor check
        let oracle = &ctx.accounts.oracle;
        let collateral_value = collateral_value_usd(
            obligation.usdc_supplied,
            obligation.btc_supplied,
            obligation.sol_supplied,
            oracle,
        );
        let debt_value = debt_value_usd(sim_usdc_b, sim_btc_b, sim_sol_b, oracle);
        require!(debt_value > 0, MockKaminoError::ZeroAmount);
        let hf_bps = collateral_value
            .checked_mul(10000)
            .ok_or(MockKaminoError::Overflow)?
            .checked_div(debt_value)
            .ok_or(MockKaminoError::Overflow)?;
        require!(hf_bps >= HF_MIN_BPS, MockKaminoError::HealthFactorTooLow);

        // Treasury must have liquidity
        require!(
            ctx.accounts.treasury.amount >= amount,
            MockKaminoError::InsufficientLiquidity
        );

        // Transfer tokens: treasury → user (borrowing tokens out)
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.treasury],
        ]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        // Commit obligation update
        let obligation = &mut ctx.accounts.obligation;
        match asset {
            0 => obligation.usdc_borrowed = sim_usdc_b,
            1 => obligation.btc_borrowed = sim_btc_b,
            2 => obligation.sol_borrowed = sim_sol_b,
            _ => return err!(MockKaminoError::InvalidAsset),
        }

        let reserve = &mut ctx.accounts.reserve;
        reserve.total_borrowed = reserve.total_borrowed.checked_add(amount).ok_or(MockKaminoError::Overflow)?;

        msg!("Borrow: asset={} amount={}", asset, amount);
        Ok(())
    }

    // ── Repay ────────────────────────────────────────────────────────────

    pub fn repay(ctx: Context<Repay>, asset: u8, amount: u64) -> Result<()> {
        require!(amount > 0, MockKaminoError::ZeroAmount);

        // Cap repay at outstanding debt
        let obligation = &ctx.accounts.obligation;
        let outstanding = match asset {
            0 => obligation.usdc_borrowed,
            1 => obligation.btc_borrowed,
            2 => obligation.sol_borrowed,
            _ => return err!(MockKaminoError::InvalidAsset),
        };
        let repay_amount = amount.min(outstanding);
        require!(repay_amount > 0, MockKaminoError::ZeroAmount);

        // Transfer tokens: user → treasury
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.user_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, repay_amount)?;

        // Update obligation
        let obligation = &mut ctx.accounts.obligation;
        match asset {
            0 => obligation.usdc_borrowed = obligation.usdc_borrowed.saturating_sub(repay_amount),
            1 => obligation.btc_borrowed = obligation.btc_borrowed.saturating_sub(repay_amount),
            2 => obligation.sol_borrowed = obligation.sol_borrowed.saturating_sub(repay_amount),
            _ => return err!(MockKaminoError::InvalidAsset),
        }

        // Update reserve
        let reserve = &mut ctx.accounts.reserve;
        reserve.total_borrowed = reserve.total_borrowed.saturating_sub(repay_amount);

        msg!("Repay: asset={} amount={}", asset, repay_amount);
        Ok(())
    }

    // ── Yield accrual (admin/crank) ──────────────────────────────────────

    // Mints additional tokens into the reserve treasury, simulating
    // interest accrued. The admin (mint authority) signs.
    pub fn accrue_yield(ctx: Context<AccrueYield>, yield_amount: u64) -> Result<()> {
        require!(yield_amount > 0, MockKaminoError::ZeroAmount);

        let cpi_accounts = anchor_spl::token::MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::mint_to(cpi_ctx, yield_amount)?;

        let reserve = &mut ctx.accounts.reserve;
        reserve.total_supplied = reserve.total_supplied.checked_add(yield_amount).ok_or(MockKaminoError::Overflow)?;

        msg!("Yield accrued: {} tokens", yield_amount);
        Ok(())
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

fn collateral_value_usd(usdc: u64, btc: u64, sol: u64, oracle: &PriceOracle) -> u128 {
    (usdc as u128) * (oracle.usdc_price as u128)
        + (btc as u128) * (oracle.btc_price as u128)
        + (sol as u128) * (oracle.sol_price as u128)
}

fn debt_value_usd(usdc: u64, btc: u64, sol: u64, oracle: &PriceOracle) -> u128 {
    (usdc as u128) * (oracle.usdc_price as u128)
        + (btc as u128) * (oracle.btc_price as u128)
        + (sol as u128) * (oracle.sol_price as u128)
}

// =============================================================================
// ACCOUNTS
// =============================================================================

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + PriceOracle::INIT_SPACE,
        seeds = [b"prices"],
        bump,
    )]
    pub oracle: Account<'info, PriceOracle>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"prices"],
        bump = oracle.bump,
        constraint = oracle.admin == admin.key() @ MockKaminoError::Unauthorized,
    )]
    pub oracle: Account<'info, PriceOracle>,
}

#[derive(Accounts)]
pub struct InitializeReserve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + Reserve::INIT_SPACE,
        seeds = [b"reserve", mint.key().as_ref()],
        bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        init,
        payer = payer,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = treasury,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeObligation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The strategy token account this obligation tracks.
    pub strategy_token_account: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Obligation::INIT_SPACE,
        seeds = [b"obligation", strategy_token_account.key().as_ref()],
        bump,
    )]
    pub obligation: Account<'info, Obligation>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reserve", mint.key().as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [b"obligation", user_token_account.key().as_ref()],
        bump = obligation.bump,
    )]
    pub obligation: Account<'info, Obligation>,

    /// CHECK: Authority on user_token_account (vault PDA via invoke_signed).
    pub user_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reserve", mint.key().as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [b"obligation", user_token_account.key().as_ref()],
        bump = obligation.bump,
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(
        seeds = [b"prices"],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, PriceOracle>,

    /// CHECK: Vault PDA — present for consistency, not used.
    pub user_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reserve", mint.key().as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [b"obligation", user_token_account.key().as_ref()],
        bump = obligation.bump,
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(
        seeds = [b"prices"],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, PriceOracle>,

    /// CHECK: Vault PDA — present for consistency.
    pub user_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reserve", mint.key().as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [b"obligation", user_token_account.key().as_ref()],
        bump = obligation.bump,
    )]
    pub obligation: Account<'info, Obligation>,

    pub user_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AccrueYield<'info> {
    #[account(mut)]
    pub mint_authority: Signer<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reserve", mint.key().as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    pub token_program: Program<'info, Token>,
}

// =============================================================================
// STATE
// =============================================================================

#[account]
#[derive(InitSpace)]
pub struct PriceOracle {
    pub admin: Pubkey,    // 32
    pub usdc_price: u64,  // 8 — micro-USD per token unit
    pub btc_price: u64,   // 8
    pub sol_price: u64,   // 8
    pub bump: u8,         // 1
}

#[account]
#[derive(InitSpace)]
pub struct Reserve {
    pub mint: Pubkey,            // 32
    pub supply_treasury: Pubkey, // 32
    pub supply_apy_bps: u16,     // 2
    pub borrow_apy_bps: u16,     // 2
    pub total_supplied: u64,     // 8
    pub total_borrowed: u64,     // 8
    pub bump: u8,                // 1
}

/// Per-strategy obligation. Layout (after 8-byte discriminator):
///   bytes 8..40   strategy_token_account (Pubkey)
///   bytes 40..48  usdc_supplied (u64 LE)
///   bytes 48..56  usdc_borrowed (u64 LE)
///   bytes 56..64  btc_supplied (u64 LE)
///   bytes 64..72  btc_borrowed (u64 LE)
///   bytes 72..80  sol_supplied (u64 LE)
///   bytes 80..88  sol_borrowed (u64 LE)
///   bytes 88..89  bump (u8)
///
/// The Erebor vault reads this layout raw (no Anchor dep) when computing
/// total strategy value across protocols.
#[account]
#[derive(InitSpace)]
pub struct Obligation {
    pub strategy_token_account: Pubkey, // 32
    pub usdc_supplied: u64,             // 8
    pub usdc_borrowed: u64,             // 8
    pub btc_supplied: u64,              // 8
    pub btc_borrowed: u64,              // 8
    pub sol_supplied: u64,              // 8
    pub sol_borrowed: u64,              // 8
    pub bump: u8,                       // 1
}

// =============================================================================
// ERRORS
// =============================================================================

#[error_code]
pub enum MockKaminoError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Invalid asset (must be 0=USDC, 1=BTC, 2=SOL)")]
    InvalidAsset,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Insufficient collateral for withdrawal")]
    InsufficientCollateral,

    #[msg("Health factor too low after operation")]
    HealthFactorTooLow,

    #[msg("Reserve has insufficient liquidity")]
    InsufficientLiquidity,

    #[msg("Unauthorized")]
    Unauthorized,
}
