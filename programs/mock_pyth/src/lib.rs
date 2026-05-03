//! mock_pyth — Minimal Pyth-style price feed for devnet/localnet testing.
//!
//! Wire layout of `MockPriceFeed` matches what `my_project::settle_strategy_value`
//! expects (constants `PYTH_PRICE_OFFSET = 8`, `PYTH_EXPO_OFFSET = 16`,
//! `PYTH_PUBLISH_TIME_OFFSET = 20`). Real Pyth `PriceUpdateV2` wiring is a
//! follow-up (see docs/FOLLOWUPS.md A4).

use anchor_lang::prelude::*;

declare_id!("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");

#[program]
pub mod mock_pyth {
    use super::*;

    /// Initialise a `MockPriceFeed` PDA seeded by `[b"price", mint]`.
    /// Sets initial price/expo and stamps `publish_time = now`.
    pub fn initialize_feed(
        ctx: Context<InitializeFeed>,
        price: i64,
        expo: i32,
    ) -> Result<()> {
        let feed = &mut ctx.accounts.feed;
        feed.price = price;
        feed.expo = expo;
        feed.publish_time = Clock::get()?.unix_timestamp;
        feed._reserved = [0; 4];
        Ok(())
    }

    /// Update price/expo and stamp `publish_time = now`. Anyone can update
    /// — this is mock infra; production swaps in a real Pyth feed.
    pub fn set_price(
        ctx: Context<SetPrice>,
        price: i64,
        expo: i32,
    ) -> Result<()> {
        let feed = &mut ctx.accounts.feed;
        feed.price = price;
        feed.expo = expo;
        feed.publish_time = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: any pubkey works as the seed identifier — typically a token
    /// mint, but the program does not enforce SPL Mint shape.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + MockPriceFeed::INIT_SPACE,
        seeds = [b"price", mint.key().as_ref()],
        bump,
    )]
    pub feed: Account<'info, MockPriceFeed>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    pub payer: Signer<'info>,

    /// CHECK: same as InitializeFeed — used only as a seed.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"price", mint.key().as_ref()],
        bump,
    )]
    pub feed: Account<'info, MockPriceFeed>,
}

/// Wire layout (after Anchor 8-byte disc):
///   8..16  price          (i64)
///   16..20 expo           (i32)
///   20..28 publish_time   (i64)
///   28..32 _reserved      ([u8;4])
#[account]
#[derive(InitSpace)]
pub struct MockPriceFeed {
    pub price: i64,
    pub expo: i32,
    pub publish_time: i64,
    pub _reserved: [u8; 4],
}
