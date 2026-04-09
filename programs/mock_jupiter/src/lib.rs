// mock_jupiter — Minimal mock of Jupiter swap aggregator for devnet testing.
//
// Supports swaps between USDC, BTC, and SOL using admin-set USD prices.
// Each asset has a Pool PDA token account with admin-funded liquidity.
//
// Swap math:
//   output_amount = input_amount * input_price / output_price * (10000 - slippage_bps) / 10000
//
// Account model:
//   PriceOracle (singleton)  — admin-set USD prices for BTC, SOL, USDC
//   Pool (per token mint)    — PDA token account holding liquidity for that asset
//
// The vault PDA signs the input transfer (it's the authority on the source
// account passed via execute_strategy_action). The output pool PDA signs
// the output transfer using its own seeds.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("43FrWWHc13Fp4rsnb3XjDV5dfmWWoyLNzdSe1pqkLxn7");

#[program]
pub mod mock_jupiter {
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
        msg!("Mock Jupiter oracle initialized");
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, asset: u8, new_price: u64) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        match asset {
            0 => oracle.usdc_price = new_price,
            1 => oracle.btc_price = new_price,
            2 => oracle.sol_price = new_price,
            _ => return err!(MockJupiterError::InvalidAsset),
        }
        msg!("Price updated for asset {}: {}", asset, new_price);
        Ok(())
    }

    // ── Pool ─────────────────────────────────────────────────────────────

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.token_account = ctx.accounts.pool_token_account.key();
        pool.bump = ctx.bumps.pool;
        msg!("Pool initialized for mint {:?}", pool.mint);
        Ok(())
    }

    // Admin funds a pool's liquidity by minting tokens into it.
    pub fn fund_pool(ctx: Context<FundPool>, amount: u64) -> Result<()> {
        require!(amount > 0, MockJupiterError::ZeroAmount);
        let cpi_accounts = anchor_spl::token::MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.pool_token_account.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::mint_to(cpi_ctx, amount)?;
        msg!("Pool funded with {}", amount);
        Ok(())
    }

    // ── Swap ─────────────────────────────────────────────────────────────

    // Swap input_amount of input asset for output asset.
    // Both input and output mints must be among USDC/BTC/SOL.
    // The user_input_account is debited; user_output_account is credited.
    pub fn swap(
        ctx: Context<Swap>,
        input_asset: u8,
        output_asset: u8,
        input_amount: u64,
        slippage_bps: u16,
    ) -> Result<()> {
        require!(input_amount > 0, MockJupiterError::ZeroAmount);
        require!(input_asset != output_asset, MockJupiterError::SameAsset);
        require!(slippage_bps <= 10000, MockJupiterError::InvalidSlippage);

        let oracle = &ctx.accounts.oracle;
        let input_price = price_for(input_asset, oracle)?;
        let output_price = price_for(output_asset, oracle)?;

        // output = input * in_price / out_price * (10000 - slippage) / 10000
        // Use u128 to avoid overflow.
        let output_amount: u64 = ((input_amount as u128)
            .checked_mul(input_price as u128)
            .ok_or(MockJupiterError::Overflow)?
            .checked_div(output_price as u128)
            .ok_or(MockJupiterError::Overflow)?
            .checked_mul((10000 - slippage_bps) as u128)
            .ok_or(MockJupiterError::Overflow)?
            .checked_div(10000)
            .ok_or(MockJupiterError::Overflow)?)
            .try_into()
            .map_err(|_| MockJupiterError::Overflow)?;

        require!(
            ctx.accounts.output_pool.amount >= output_amount,
            MockJupiterError::InsufficientLiquidity
        );

        // Transfer 1: user_input_account → input_pool
        // Authority: vault PDA (signed via invoke_signed by execute_strategy_action)
        let cpi_in = Transfer {
            from: ctx.accounts.user_input_account.to_account_info(),
            to: ctx.accounts.input_pool.to_account_info(),
            authority: ctx.accounts.user_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_in),
            input_amount,
        )?;

        // Transfer 2: output_pool → user_output_account
        // Authority: output pool PDA signs via its seeds
        let output_mint_key = ctx.accounts.output_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"pool_token",
            output_mint_key.as_ref(),
            &[ctx.bumps.output_pool],
        ]];
        let cpi_out = Transfer {
            from: ctx.accounts.output_pool.to_account_info(),
            to: ctx.accounts.user_output_account.to_account_info(),
            authority: ctx.accounts.output_pool.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_out,
                signer_seeds,
            ),
            output_amount,
        )?;

        msg!(
            "Swap: {} of asset {} → {} of asset {} (slippage {} bps)",
            input_amount,
            input_asset,
            output_amount,
            output_asset,
            slippage_bps
        );
        Ok(())
    }
}

// =============================================================================
// HELPERS
// =============================================================================

fn price_for(asset: u8, oracle: &PriceOracle) -> Result<u64> {
    match asset {
        0 => Ok(oracle.usdc_price),
        1 => Ok(oracle.btc_price),
        2 => Ok(oracle.sol_price),
        _ => err!(MockJupiterError::InvalidAsset),
    }
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
        seeds = [b"prices_jup"],
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
        seeds = [b"prices_jup"],
        bump = oracle.bump,
        constraint = oracle.admin == admin.key() @ MockJupiterError::Unauthorized,
    )]
    pub oracle: Account<'info, PriceOracle>,
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = payer,
        seeds = [b"pool_token", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool_token_account,
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundPool<'info> {
    #[account(mut)]
    pub mint_authority: Signer<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"pool_token", mint.key().as_ref()],
        bump,
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        seeds = [b"prices_jup"],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, PriceOracle>,

    pub input_mint: Account<'info, Mint>,
    pub output_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_input_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_output_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"pool_token", input_mint.key().as_ref()],
        bump,
    )]
    pub input_pool: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"pool_token", output_mint.key().as_ref()],
        bump,
    )]
    pub output_pool: Account<'info, TokenAccount>,

    /// CHECK: Vault PDA signs via invoke_signed.
    pub user_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// =============================================================================
// STATE
// =============================================================================

#[account]
#[derive(InitSpace)]
pub struct PriceOracle {
    pub admin: Pubkey,    // 32
    pub usdc_price: u64,  // 8
    pub btc_price: u64,   // 8
    pub sol_price: u64,   // 8
    pub bump: u8,         // 1
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub mint: Pubkey,         // 32
    pub token_account: Pubkey, // 32
    pub bump: u8,             // 1
}

// =============================================================================
// ERRORS
// =============================================================================

#[error_code]
pub enum MockJupiterError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Invalid asset (must be 0=USDC, 1=BTC, 2=SOL)")]
    InvalidAsset,

    #[msg("Cannot swap an asset for itself")]
    SameAsset,

    #[msg("Slippage must be <= 10000 bps")]
    InvalidSlippage,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Pool has insufficient liquidity")]
    InsufficientLiquidity,

    #[msg("Unauthorized")]
    Unauthorized,
}
