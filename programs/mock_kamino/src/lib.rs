//! Mock Kamino Lend program — for E2E testing of Erebor's `execute_action`
//! whitelist gateway against a realistic-shaped lending target.
//!
//! Mirrors real Kamino's headline instruction names so the Anchor
//! `sha256("global:method")[..8]` discriminators match production. A vault
//! admin who whitelists the real Kamino program ID + the same method name on
//! mainnet sees the same bytes; on devnet/localnet we whitelist this mock's
//! program ID instead and the test exercises identical wire format.
//!
//! Real Kamino is hundreds of accounts and modes deep. This mock keeps three
//! moving parts:
//!   - a `Reserve` PDA (per liquidity mint) holding metadata + the
//!     liquidity supply ATA + a collateral (cToken) mint
//!   - `deposit_reserve_liquidity_and_obligation_collateral` — pulls
//!     liquidity in, mints cTokens out
//!   - `withdraw_obligation_collateral_and_redeem_reserve_collateral` —
//!     burns cTokens, returns liquidity (post-yield)
//!
//! Plus an admin-only `simulate_yield` that mints liquidity into the supply
//! ATA, raising the cToken redemption rate. Stand-in for "borrowers paid
//! interest". Tests can call it between deposit/withdraw to check that yield
//! is correctly captured by Erebor's strategy + share-price math.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("HLDVeTCx7mJeHApCpDptwbHd78iLCPYrFnVAymjrANp2");

/// Minimum health factor for borrows / withdraws against an obligation
/// (basis points × 1.0). 10_500 = 1.05 — tight but matches real Kamino's
/// "liquidation HF" guard. The agent's TS-side `INTERMEDIATE_HF_FLOOR`
/// (1.10) sits above this so per-leg checks have a 5-point buffer.
pub const HF_MIN_BPS: u128 = 10_500;

#[program]
pub mod mock_kamino {
    use super::*;

    /// Admin creates a reserve for `liquidity_mint`. Mints the cToken mint
    /// (collateral_mint) as a PDA owned by the reserve, and the liquidity
    /// supply ATA owned by the reserve PDA.
    pub fn init_reserve(ctx: Context<InitReserve>) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.admin = ctx.accounts.admin.key();
        reserve.liquidity_mint = ctx.accounts.liquidity_mint.key();
        reserve.collateral_mint = ctx.accounts.collateral_mint.key();
        reserve.liquidity_supply = ctx.accounts.liquidity_supply.key();
        reserve.total_liquidity = 0;
        reserve.total_collateral_supply = 0;
        reserve.total_borrowed = 0;
        reserve.bump = ctx.bumps.reserve;
        reserve.collateral_mint_bump = ctx.bumps.collateral_mint;

        msg!(
            "Reserve initialized: liquidity_mint={} collateral_mint={}",
            reserve.liquidity_mint,
            reserve.collateral_mint
        );
        Ok(())
    }

    /// Pull `liquidity_amount` of underlying from `source_liquidity` into
    /// the reserve's liquidity supply, mint cTokens to
    /// `destination_collateral`. Anyone who has tokens to deposit can call.
    ///
    /// cToken math:
    ///   first deposit:  ctokens = liquidity_amount (1:1)
    ///   subsequent:     ctokens = liquidity_amount × ctoken_supply / total_liquidity
    pub fn deposit_reserve_liquidity_and_obligation_collateral(
        ctx: Context<DepositReserveLiquidity>,
        liquidity_amount: u64,
    ) -> Result<()> {
        require!(liquidity_amount > 0, MockKaminoError::ZeroAmount);

        let reserve = &mut ctx.accounts.reserve;
        let ctoken_amount: u64 = if reserve.total_collateral_supply == 0 {
            liquidity_amount
        } else {
            ((liquidity_amount as u128) * (reserve.total_collateral_supply as u128)
                / (reserve.total_liquidity as u128)) as u64
        };

        // Pull liquidity in
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.source_liquidity.to_account_info(),
            to: ctx.accounts.liquidity_supply.to_account_info(),
            mint: ctx.accounts.liquidity_mint.to_account_info(),
            authority: ctx.accounts.user_transfer_authority.to_account_info(),
        };
        let decimals = ctx.accounts.liquidity_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            liquidity_amount,
            decimals,
        )?;

        // Mint cTokens to destination
        let liquidity_mint_key = reserve.liquidity_mint;
        let bump = reserve.bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"reserve", liquidity_mint_key.as_ref(), &[bump]]];
        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.destination_collateral.to_account_info(),
                authority: reserve.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::mint_to(mint_ctx, ctoken_amount)?;

        reserve.total_liquidity = reserve
            .total_liquidity
            .checked_add(liquidity_amount)
            .ok_or(MockKaminoError::MathOverflow)?;
        reserve.total_collateral_supply = reserve
            .total_collateral_supply
            .checked_add(ctoken_amount)
            .ok_or(MockKaminoError::MathOverflow)?;

        msg!(
            "Deposited {} liquidity, minted {} cTokens",
            liquidity_amount,
            ctoken_amount
        );
        Ok(())
    }

    /// Burn `collateral_amount` of cTokens, return liquidity to
    /// `destination_liquidity`. Liquidity returned reflects the current
    /// redemption rate (which grows with simulated yield).
    pub fn withdraw_obligation_collateral_and_redeem_reserve_collateral(
        ctx: Context<WithdrawReserveLiquidity>,
        collateral_amount: u64,
    ) -> Result<()> {
        require!(collateral_amount > 0, MockKaminoError::ZeroAmount);
        let reserve = &mut ctx.accounts.reserve;
        require!(
            reserve.total_collateral_supply > 0,
            MockKaminoError::EmptyReserve
        );

        let liquidity_amount: u64 = ((collateral_amount as u128)
            * (reserve.total_liquidity as u128)
            / (reserve.total_collateral_supply as u128)) as u64;
        require!(liquidity_amount > 0, MockKaminoError::ZeroAmount);

        // Burn cTokens (user signs).
        let cpi_burn = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.collateral_mint.to_account_info(),
                from: ctx.accounts.source_collateral.to_account_info(),
                authority: ctx.accounts.user_transfer_authority.to_account_info(),
            },
        );
        token_interface::burn(cpi_burn, collateral_amount)?;

        // Transfer liquidity out (reserve PDA signs).
        let liquidity_mint_key = reserve.liquidity_mint;
        let bump = reserve.bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"reserve", liquidity_mint_key.as_ref(), &[bump]]];
        let cpi_xfer = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.liquidity_supply.to_account_info(),
                to: ctx.accounts.destination_liquidity.to_account_info(),
                mint: ctx.accounts.liquidity_mint.to_account_info(),
                authority: reserve.to_account_info(),
            },
            signer_seeds,
        );
        let decimals = ctx.accounts.liquidity_mint.decimals;
        token_interface::transfer_checked(cpi_xfer, liquidity_amount, decimals)?;

        reserve.total_liquidity = reserve
            .total_liquidity
            .checked_sub(liquidity_amount)
            .ok_or(MockKaminoError::MathOverflow)?;
        reserve.total_collateral_supply = reserve
            .total_collateral_supply
            .checked_sub(collateral_amount)
            .ok_or(MockKaminoError::MathOverflow)?;

        msg!(
            "Burned {} cTokens, returned {} liquidity",
            collateral_amount,
            liquidity_amount
        );
        Ok(())
    }

    /// Initialize a per-(reserve, owner) Obligation PDA. `owner` is the
    /// authority that will later sign borrow/repay against this obligation —
    /// in Erebor's flow that's the `strategy_authority` PDA. Real Kamino
    /// scopes obligations to a LendingMarket; we scope them to the reserve
    /// for simplicity (one mock reserve per liquidity_mint = one market).
    pub fn init_obligation(ctx: Context<InitObligation>) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.reserve = ctx.accounts.reserve.key();
        obligation.owner = ctx.accounts.owner.key();
        obligation.borrowed_liquidity = 0;
        obligation.bump = ctx.bumps.obligation;
        msg!(
            "Obligation initialized: reserve={} owner={}",
            obligation.reserve,
            obligation.owner
        );
        Ok(())
    }

    /// Borrow `liquidity_amount` of the reserve's underlying against
    /// existing cToken collateral. The caller must hold cTokens in
    /// `collateral_token_account` whose value (at the current redemption
    /// rate) keeps the obligation's health factor above `HF_MIN_BPS` after
    /// adding the new debt.
    ///
    /// HF math (post-borrow):
    ///   collateral_value = ctoken_balance × total_liquidity / total_collateral_supply
    ///   new_debt         = obligation.borrowed_liquidity + liquidity_amount
    ///   hf_bps           = collateral_value × 10_000 / new_debt
    ///
    /// MVP: same-mint borrow (USDC supplied, USDC borrowed). Multi-asset
    /// loops would require an oracle and a debt-by-mint vector — see
    /// agent/kamino_looper/TODO.md.
    pub fn borrow_obligation_liquidity(
        ctx: Context<BorrowObligationLiquidity>,
        liquidity_amount: u64,
    ) -> Result<()> {
        require!(liquidity_amount > 0, MockKaminoError::ZeroAmount);

        let reserve = &ctx.accounts.reserve;

        // 1. HF check using on-chain cToken balance × redemption rate.
        let ctoken_balance = ctx.accounts.collateral_token_account.amount as u128;
        require!(
            reserve.total_collateral_supply > 0,
            MockKaminoError::EmptyReserve
        );
        let collateral_value = ctoken_balance
            .checked_mul(reserve.total_liquidity as u128)
            .ok_or(MockKaminoError::MathOverflow)?
            / (reserve.total_collateral_supply as u128);

        let new_debt = (ctx.accounts.obligation.borrowed_liquidity as u128)
            .checked_add(liquidity_amount as u128)
            .ok_or(MockKaminoError::MathOverflow)?;
        require!(new_debt > 0, MockKaminoError::ZeroAmount);
        let hf_bps = collateral_value
            .checked_mul(10_000)
            .ok_or(MockKaminoError::MathOverflow)?
            / new_debt;
        require!(hf_bps >= HF_MIN_BPS, MockKaminoError::HealthFactorTooLow);

        // 2. Reserve must have liquidity available to lend.
        require!(
            ctx.accounts.liquidity_supply.amount >= liquidity_amount,
            MockKaminoError::InsufficientLiquidity
        );

        // 3. Transfer liquidity supply → caller's destination ATA. Reserve PDA signs.
        let liquidity_mint_key = reserve.liquidity_mint;
        let bump = reserve.bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"reserve", liquidity_mint_key.as_ref(), &[bump]]];
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.liquidity_supply.to_account_info(),
                to: ctx.accounts.destination_liquidity.to_account_info(),
                mint: ctx.accounts.liquidity_mint.to_account_info(),
                authority: reserve.to_account_info(),
            },
            signer_seeds,
        );
        let decimals = ctx.accounts.liquidity_mint.decimals;
        token_interface::transfer_checked(cpi, liquidity_amount, decimals)?;

        // 4. Bookkeeping.
        let reserve_mut = &mut ctx.accounts.reserve;
        reserve_mut.total_borrowed = reserve_mut
            .total_borrowed
            .checked_add(liquidity_amount)
            .ok_or(MockKaminoError::MathOverflow)?;

        let obligation = &mut ctx.accounts.obligation;
        obligation.borrowed_liquidity = obligation
            .borrowed_liquidity
            .checked_add(liquidity_amount)
            .ok_or(MockKaminoError::MathOverflow)?;

        msg!(
            "Borrowed {} liquidity (obligation debt = {})",
            liquidity_amount,
            obligation.borrowed_liquidity
        );
        Ok(())
    }

    /// Repay `liquidity_amount` of debt against the obligation. Caps the
    /// repay at the outstanding debt (overpayment is silently ignored).
    pub fn repay_obligation_liquidity(
        ctx: Context<RepayObligationLiquidity>,
        liquidity_amount: u64,
    ) -> Result<()> {
        require!(liquidity_amount > 0, MockKaminoError::ZeroAmount);
        let outstanding = ctx.accounts.obligation.borrowed_liquidity;
        let repay = liquidity_amount.min(outstanding);
        require!(repay > 0, MockKaminoError::ZeroAmount);

        // Transfer source_liquidity → reserve liquidity_supply. Caller signs.
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.source_liquidity.to_account_info(),
                to: ctx.accounts.liquidity_supply.to_account_info(),
                mint: ctx.accounts.liquidity_mint.to_account_info(),
                authority: ctx.accounts.user_transfer_authority.to_account_info(),
            },
        );
        let decimals = ctx.accounts.liquidity_mint.decimals;
        token_interface::transfer_checked(cpi, repay, decimals)?;

        let reserve = &mut ctx.accounts.reserve;
        reserve.total_borrowed = reserve.total_borrowed.saturating_sub(repay);

        let obligation = &mut ctx.accounts.obligation;
        obligation.borrowed_liquidity = obligation.borrowed_liquidity.saturating_sub(repay);

        msg!(
            "Repaid {} liquidity (obligation debt = {})",
            repay,
            obligation.borrowed_liquidity
        );
        Ok(())
    }

    /// Admin-only — mint additional `liquidity_amount` of underlying into the
    /// reserve's liquidity supply. Simulates "borrowers paid interest". Raises
    /// the cToken→liquidity redemption rate without changing cToken supply.
    ///
    /// In real Kamino this is implicit (interest accrual on borrows + market
    /// dynamics). Here it's a knob the test harness pulls.
    pub fn simulate_yield(ctx: Context<SimulateYield>, liquidity_amount: u64) -> Result<()> {
        require!(liquidity_amount > 0, MockKaminoError::ZeroAmount);

        // Mint underlying into the reserve's supply. Caller must be the
        // mint authority for liquidity_mint (the test wallet, in our setup).
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.liquidity_mint.to_account_info(),
                to: ctx.accounts.liquidity_supply.to_account_info(),
                authority: ctx.accounts.liquidity_mint_authority.to_account_info(),
            },
        );
        token_interface::mint_to(cpi, liquidity_amount)?;

        let reserve = &mut ctx.accounts.reserve;
        reserve.total_liquidity = reserve
            .total_liquidity
            .checked_add(liquidity_amount)
            .ok_or(MockKaminoError::MathOverflow)?;

        msg!(
            "Yield simulated: +{} liquidity (new total {})",
            liquidity_amount,
            reserve.total_liquidity
        );
        Ok(())
    }
}

// ============================================================
// ACCOUNT VALIDATION
// ============================================================

#[derive(Accounts)]
pub struct InitReserve<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub liquidity_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Reserve::INIT_SPACE,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        init,
        payer = admin,
        seeds = [b"collateral_mint", liquidity_mint.key().as_ref()],
        bump,
        mint::decimals = liquidity_mint.decimals,
        mint::authority = reserve,
        mint::token_program = token_program,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = liquidity_mint,
        associated_token::authority = reserve,
        associated_token::token_program = token_program,
    )]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    /// Source liquidity token account (owned by the depositor's authority).
    #[account(mut)]
    pub source_liquidity: InterfaceAccount<'info, TokenAccount>,

    /// Destination collateral (cToken) account.
    #[account(mut)]
    pub destination_collateral: InterfaceAccount<'info, TokenAccount>,

    /// Reserve config PDA, mut for accounting.
    #[account(
        mut,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump = reserve.bump,
        has_one = liquidity_mint @ MockKaminoError::WrongMint,
        has_one = collateral_mint @ MockKaminoError::WrongMint,
        has_one = liquidity_supply @ MockKaminoError::WrongMint,
    )]
    pub reserve: Account<'info, Reserve>,

    pub liquidity_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// Authority that can sign for `source_liquidity`. In Erebor's flow this
    /// is the `strategy_authority` PDA, signed via `invoke_signed` in
    /// `execute_action`.
    pub user_transfer_authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawReserveLiquidity<'info> {
    /// Source collateral (cToken) account.
    #[account(mut)]
    pub source_collateral: InterfaceAccount<'info, TokenAccount>,

    /// Destination liquidity account.
    #[account(mut)]
    pub destination_liquidity: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump = reserve.bump,
        has_one = liquidity_mint @ MockKaminoError::WrongMint,
        has_one = collateral_mint @ MockKaminoError::WrongMint,
        has_one = liquidity_supply @ MockKaminoError::WrongMint,
    )]
    pub reserve: Account<'info, Reserve>,

    pub liquidity_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// Authority that can sign for `source_collateral`.
    pub user_transfer_authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitObligation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The reserve this obligation borrows against.
    pub reserve: Account<'info, Reserve>,

    /// Authority that will sign borrow/repay against this obligation.
    /// In Erebor's flow this is the `strategy_authority` PDA, passed as
    /// `UncheckedAccount` because invoke_signed binds it via seeds rather
    /// than requiring a runtime signer here.
    /// CHECK: only used to seed the obligation PDA — no privilege granted.
    pub owner: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Obligation::INIT_SPACE,
        seeds = [b"obligation", reserve.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub obligation: Account<'info, Obligation>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BorrowObligationLiquidity<'info> {
    /// Obligation tracked by (reserve, owner). `owner` must sign — that's the
    /// strategy_authority PDA in the Erebor flow (signed via invoke_signed).
    #[account(
        mut,
        seeds = [b"obligation", reserve.key().as_ref(), owner.key().as_ref()],
        bump = obligation.bump,
        has_one = reserve @ MockKaminoError::WrongObligation,
        has_one = owner @ MockKaminoError::WrongObligation,
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(
        mut,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump = reserve.bump,
        has_one = liquidity_mint @ MockKaminoError::WrongMint,
        has_one = collateral_mint @ MockKaminoError::WrongMint,
        has_one = liquidity_supply @ MockKaminoError::WrongMint,
    )]
    pub reserve: Account<'info, Reserve>,

    pub liquidity_mint: InterfaceAccount<'info, Mint>,

    /// Reserve's underlying-token reservoir; debited on borrow.
    #[account(mut)]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// Where the borrowed liquidity goes — typically the strategy ATA owned
    /// by `owner` (= strategy_authority).
    #[account(mut)]
    pub destination_liquidity: InterfaceAccount<'info, TokenAccount>,

    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// cToken account holding `owner`'s collateral. Required for the HF
    /// check. Verified by the constraint to belong to `owner` and the
    /// reserve's collateral mint.
    #[account(
        constraint = collateral_token_account.mint == collateral_mint.key()
            @ MockKaminoError::WrongMint,
        constraint = collateral_token_account.owner == owner.key()
            @ MockKaminoError::WrongObligation,
    )]
    pub collateral_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Owner of the obligation. Signs to authorize the borrow.
    pub owner: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RepayObligationLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"obligation", reserve.key().as_ref(), user_transfer_authority.key().as_ref()],
        bump = obligation.bump,
        has_one = reserve @ MockKaminoError::WrongObligation,
        constraint = obligation.owner == user_transfer_authority.key()
            @ MockKaminoError::WrongObligation,
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(
        mut,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump = reserve.bump,
        has_one = liquidity_mint @ MockKaminoError::WrongMint,
        has_one = liquidity_supply @ MockKaminoError::WrongMint,
    )]
    pub reserve: Account<'info, Reserve>,

    pub liquidity_mint: InterfaceAccount<'info, Mint>,

    /// Reserve's underlying-token reservoir; credited on repay.
    #[account(mut)]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// Where the repaid liquidity comes from — typically the strategy ATA.
    #[account(mut)]
    pub source_liquidity: InterfaceAccount<'info, TokenAccount>,

    /// Authority that signs for `source_liquidity` and owns the obligation.
    pub user_transfer_authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SimulateYield<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump = reserve.bump,
        constraint = reserve.admin == admin.key() @ MockKaminoError::Unauthorized,
        has_one = liquidity_mint @ MockKaminoError::WrongMint,
        has_one = liquidity_supply @ MockKaminoError::WrongMint,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(mut)]
    pub liquidity_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// Mint authority for `liquidity_mint`. Must sign.
    pub liquidity_mint_authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================================
// DATA ACCOUNTS
// ============================================================

#[account]
#[derive(InitSpace)]
pub struct Reserve {
    pub admin: Pubkey,
    pub liquidity_mint: Pubkey,
    pub collateral_mint: Pubkey,
    pub liquidity_supply: Pubkey,
    pub total_liquidity: u64,
    pub total_collateral_supply: u64,
    /// Total outstanding borrows across all obligations on this reserve.
    /// Used for stats / utilization-rate calculations (not enforced).
    pub total_borrowed: u64,
    pub bump: u8,
    pub collateral_mint_bump: u8,
}

/// Per-(reserve, owner) borrow position. Created via `init_obligation`,
/// mutated by `borrow_obligation_liquidity` and `repay_obligation_liquidity`.
/// Owned by the reserve's program; the `owner` field gates who can sign
/// borrow/repay (== Erebor's strategy_authority PDA in the agent flow).
#[account]
#[derive(InitSpace)]
pub struct Obligation {
    pub reserve: Pubkey,
    pub owner: Pubkey,
    pub borrowed_liquidity: u64,
    pub bump: u8,
}

// ============================================================
// ERRORS
// ============================================================

#[error_code]
pub enum MockKaminoError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Reserve has no collateral supply")]
    EmptyReserve,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Mint or supply account does not match reserve config")]
    WrongMint,

    #[msg("Caller is not the reserve admin")]
    Unauthorized,

    #[msg("Health factor would drop below HF_MIN_BPS after this borrow/withdraw")]
    HealthFactorTooLow,

    #[msg("Reserve has insufficient liquidity to satisfy the borrow")]
    InsufficientLiquidity,

    #[msg("Obligation does not match the (reserve, owner) seed pair")]
    WrongObligation,
}
