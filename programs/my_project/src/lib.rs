// Phase 3 program: per-strategy authority PDAs + audit fixes.
//
// Two signer PDAs per vault:
//   - vault_authority   — owns reserve ATA, mints/burns share tokens.
//   - strategy_authority[i] — owns strategy i's ATA, signs CPIs that
//                             move funds out of strategy i.
//
// VaultState becomes a pure config account that never signs CPIs.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use errors::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo");

#[program]
pub mod my_project {
    use super::*;

    // ============================================================
    // VAULT INSTRUCTIONS
    // ============================================================

    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_id: u64) -> Result<()> {
        instructions::initialize_vault::handler(ctx, vault_id)
    }

    pub fn deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
        shares_to_burn: u64,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, shares_to_burn)
    }

    // ============================================================
    // STRATEGY INSTRUCTIONS
    // ============================================================

    pub fn create_strategy(ctx: Context<CreateStrategy>) -> Result<()> {
        instructions::create_strategy::handler(ctx)
    }

    pub fn allocate_to_strategy(ctx: Context<AllocateToStrategy>, amount: u64) -> Result<()> {
        instructions::allocate_to_strategy::handler(ctx, amount)
    }

    pub fn deallocate_from_strategy(ctx: Context<DeallocateFromStrategy>, amount: u64) -> Result<()> {
        instructions::deallocate_from_strategy::handler(ctx, amount)
    }

    pub fn update_strategy_delegate(ctx: Context<UpdateStrategyDelegate>) -> Result<()> {
        instructions::update_strategy_delegate::handler(ctx)
    }

    pub fn report_yield(ctx: Context<ReportYield>) -> Result<()> {
        instructions::report_yield::handler(ctx)
    }

    /// Authority reports a realized loss on a strategy. Decrements both
    /// `strategy.allocated_amount` and `vault_state.total_deposited` by the
    /// loss. Reverts if the loss exceeds either tracked total. Audit #6.
    pub fn report_loss(ctx: Context<ReportLoss>, loss_amount: u64) -> Result<()> {
        instructions::report_loss::handler(ctx, loss_amount)
    }

    pub fn deactivate_strategy(ctx: Context<DeactivateStrategy>) -> Result<()> {
        instructions::deactivate_strategy::handler(ctx)
    }

    // ============================================================
    // PROTOCOL CONFIG (treasury + governance, single global PDA)
    // ============================================================

    pub fn initialize_protocol_config(
        ctx: Context<InitializeProtocolConfig>,
        treasury: Pubkey,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize_protocol_config::handler(ctx, treasury, protocol_fee_bps)
    }

    pub fn set_treasury(ctx: Context<ProtocolGovernanceOnly>, new_treasury: Pubkey) -> Result<()> {
        instructions::protocol_governance::set_treasury_handler(ctx, new_treasury)
    }

    pub fn set_protocol_fee_bps(ctx: Context<ProtocolGovernanceOnly>, new_bps: u16) -> Result<()> {
        instructions::protocol_governance::set_protocol_fee_bps_handler(ctx, new_bps)
    }

    pub fn set_governance(ctx: Context<ProtocolGovernanceOnly>, new_governance: Pubkey) -> Result<()> {
        instructions::protocol_governance::set_governance_handler(ctx, new_governance)
    }

    // ============================================================
    // TOKEN WHITELIST (Phase-4d)
    // ============================================================

    pub fn add_allowed_token(ctx: Context<AddAllowedToken>, mint: Pubkey) -> Result<()> {
        instructions::add_allowed_token::handler(ctx, mint)
    }

    pub fn remove_allowed_token(ctx: Context<RemoveAllowedToken>, _mint: Pubkey) -> Result<()> {
        instructions::remove_allowed_token::handler(ctx, _mint)
    }

    // ============================================================
    // ADMIN MANAGEMENT (two-step)
    // ============================================================

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::propose_admin::handler(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::accept_admin::handler(ctx)
    }

    pub fn propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::propose_authority::handler(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::accept_authority::handler(ctx)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::handler(ctx, paused)
    }

    pub fn set_performance_fee_bps(ctx: Context<SetPerformanceFeeBps>, new_bps: u16) -> Result<()> {
        instructions::set_performance_fee_bps::handler(ctx, new_bps)
    }

    // ============================================================
    // REBALANCING
    // ============================================================

    pub fn set_strategy_weight(ctx: Context<SetStrategyWeight>, weight_bps: u16) -> Result<()> {
        instructions::set_strategy_weight::handler(ctx, weight_bps)
    }

    /// Rebalance is now authority-only (audit #5). The two transfer legs sign
    /// as different PDAs: in-leg (reserve → strategy) signs as
    /// `vault_authority`; out-leg signs as `strategy_authority[i]`.
    pub fn rebalance_strategy(ctx: Context<RebalanceStrategy>) -> Result<()> {
        instructions::rebalance_strategy::handler(ctx)
    }

    /// Phase-5: explicit signed-delta rebalance. Authority-only. Pushes
    /// `delta` if positive (reserve → strategy) and pulls if negative
    /// (strategy → reserve). Reverts on overflow / under-flow / when the
    /// reserve can't cover a positive delta.
    pub fn rebalance_with_delta(ctx: Context<RebalanceWithDelta>, delta: i64) -> Result<()> {
        instructions::rebalance_with_delta::handler(ctx, delta)
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
        output_mint_index: Option<u16>,
        loss_per_call_bps_cap: u16,
        cooldown_secs: u32,
    ) -> Result<()> {
        instructions::add_allowed_action::handler(
            ctx,
            strategy_id,
            target_program,
            discriminator,
            expected_recipient_index,
            output_mint_index,
            loss_per_call_bps_cap,
            cooldown_secs,
        )
    }

    pub fn remove_allowed_action(
        ctx: Context<RemoveAllowedAction>,
        _strategy_id: u64,
        target_program: Pubkey,
        discriminator: [u8; 8],
    ) -> Result<()> {
        instructions::remove_allowed_action::handler(ctx, _strategy_id, target_program, discriminator)
    }

    pub fn execute_action<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteAction<'info>>,
        _strategy_id: u64,
        target_program: Pubkey,
        discriminator: [u8; 8],
        ix_data: Vec<u8>,
    ) -> Result<()> {
        instructions::execute_action::handler(
            ctx,
            _strategy_id,
            target_program,
            discriminator,
            ix_data,
        )
    }

    // ============================================================
    // AUTO-ACTION CONFIG (Phase-5 — declarative deploy/redeem intent)
    // ============================================================

    /// Admin-only. Records the curator's intended `(target, disc, ix_data)`
    /// for what this strategy should do when funds enter (kind=0) or
    /// leave (kind=1). Read off-chain by the agent; on-chain auto-CPI
    /// invocation is a future phase.
    pub fn set_auto_action_config(
        ctx: Context<SetAutoActionConfig>,
        strategy_id: u64,
        kind: u8,
        target_program: Pubkey,
        discriminator: [u8; 8],
        ix_data: Vec<u8>,
    ) -> Result<()> {
        instructions::set_auto_action_config::handler(
            ctx,
            strategy_id,
            kind,
            target_program,
            discriminator,
            ix_data,
        )
    }

    /// Admin-only. Closes the AutoActionConfig PDA, returning rent to the
    /// admin. Call before re-issuing `set_auto_action_config` for the
    /// same `(strategy, kind)` to update the recorded intent.
    pub fn clear_auto_action_config(
        ctx: Context<ClearAutoActionConfig>,
        strategy_id: u64,
        kind: u8,
    ) -> Result<()> {
        instructions::clear_auto_action_config::handler(ctx, strategy_id, kind)
    }

    // ============================================================
    // VALUE SOURCES + LIVE NAV SETTLE (Phase-5)
    // ============================================================

    /// Admin-only. Registers a `ValueSource` slot for a strategy. `kind`
    /// 0 = SplAtaBalance (read u64 at offset 64..72 of `target_account`);
    /// 1 = AccountU64 (read u64 at `offset..offset+8`). The raw read is
    /// scaled by `scale_num/scale_den` to convert into underlying-token
    /// units (e.g. cToken → underlying via the protocol's exchange rate).
    pub fn add_value_source(
        ctx: Context<AddValueSource>,
        strategy_id: u64,
        index: u8,
        kind: u8,
        target_account: Pubkey,
        offset: u32,
        scale_num: u64,
        scale_den: u64,
    ) -> Result<()> {
        instructions::add_value_source::handler(
            ctx,
            strategy_id,
            index,
            kind,
            target_account,
            offset,
            scale_num,
            scale_den,
        )
    }

    /// Admin-only. Closes a `ValueSource` PDA, returning rent.
    pub fn remove_value_source(
        ctx: Context<RemoveValueSource>,
        strategy_id: u64,
        index: u8,
    ) -> Result<()> {
        instructions::remove_value_source::handler(ctx, strategy_id, index)
    }

    /// Authority-only. Computes a strategy's live total (idle ATA balance
    /// plus the sum of registered ValueSources, scaled into underlying
    /// units) and settles `strategy.allocated_amount` + `vault.total_deposited`
    /// to match. Pause-gated. Caller passes
    /// `[value_source_pda, target_account]` pairs in `remaining_accounts`.
    pub fn settle_strategy_value<'info>(
        ctx: Context<'_, '_, '_, 'info, SettleStrategyValue<'info>>,
        strategy_id: u64,
    ) -> Result<()> {
        instructions::settle_strategy_value::handler(ctx, strategy_id)
    }
}
