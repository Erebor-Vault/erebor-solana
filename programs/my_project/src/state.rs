use anchor_lang::prelude::*;

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
    /// Phase-5: forward-compatibility cushion so future fields can be
    /// added by re-binarising existing accounts via `realloc` rather than
    /// orphaning live state. Keep zeroed.
    pub _reserved: [u8; 64],
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
    /// Phase-5: forward-compatibility cushion. See `VaultState._reserved`.
    pub _reserved: [u8; 32],
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
    /// Phase-5: max loss this single call may book against the strategy
    /// ATA, in basis points of `strategy.allocated_amount` at call time.
    /// `0` disables the check. Capped at `MAX_LOSS_PER_CALL_BPS`.
    pub loss_per_call_bps_cap: u16,
    /// Phase-5: minimum seconds between successful invocations of this
    /// allowed action. `0` disables. Combined with `last_executed_at` to
    /// rate-limit a compromised agent.
    pub cooldown_secs: u32,
    /// Phase-5: unix timestamp of last successful `execute_action` for
    /// this `(strategy, target, discriminator)` triple. Set inside the
    /// instruction handler.
    pub last_executed_at: i64,
    pub bump: u8,
    /// Forward-compatibility cushion. See `VaultState._reserved`.
    pub _reserved: [u8; 32],
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

/// Per-vault, curator-controlled mint allow-list entry. Existence of
/// the PDA at `["vault_allowed_token", vault_state, mint]` narrows the
/// protocol-level `AllowedToken` allow-list down to the curator's
/// chosen subset for *this* vault. `execute_action` requires both
/// PDAs to exist when an `AllowedAction` declares an `output_mint_index`
/// — defense-in-depth: governance vetoes broken mints globally, the
/// vault admin further constrains the swap-output universe per vault.
#[account]
#[derive(InitSpace)]
pub struct VaultAllowedToken {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

/// Phase-5: per-strategy value-source registry entry. A strategy can have
/// up to `MAX_VALUE_SOURCES_PER_STRATEGY` sources; the live value of the
/// strategy is the sum across them. Source kinds:
///   - kind = 0 (SplAtaBalance): read the SPL Token Account `amount` at
///     offset 64..72 of `target_account.data`. `offset` is ignored.
///   - kind = 1 (AccountU64): read the u64 at `target_account.data[offset..offset+8]`.
///
/// `scale_num / scale_den` is then applied to convert the raw read into
/// underlying-token units (e.g. cToken → underlying via the protocol's
/// exchange rate). Both default to 1.
#[account]
#[derive(InitSpace)]
pub struct ValueSource {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    /// Per-strategy slot index, 0..MAX_VALUE_SOURCES_PER_STRATEGY-1.
    pub index: u8,
    /// 0 = SplAtaBalance, 1 = AccountU64.
    pub kind: u8,
    pub target_account: Pubkey,
    /// Byte offset for `AccountU64`. Ignored for `SplAtaBalance`.
    pub offset: u32,
    pub scale_num: u64,
    pub scale_den: u64,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

/// Phase-5: declarative "what should this strategy do when funds enter
/// (kind = 0) or leave (kind = 1)" record. Read off-chain by the agent;
/// the agent then calls `execute_action` with this `(target_program,
/// discriminator, ix_data)` tuple. Frontend reads it to display
/// auto-deploy intent. Auto-CPI from inside `deposit` / `rebalance` is
/// not yet wired — admin-curated declaration today, on-chain enforcement
/// later.
#[account]
#[derive(InitSpace)]
pub struct AutoActionConfig {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    /// 0 = Deposit, 1 = Withdraw. Anything else is rejected at set time.
    pub kind: u8,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    /// Phase-5: bytes appended after the `discriminator` to form the
    /// inner CPI's `data`. Capped at 256 to bound rent + compute. Most
    /// adapters fit in <64 bytes (a single `u64` amount + a few flags).
    #[max_len(256)]
    pub ix_data: Vec<u8>,
    pub bump: u8,
    pub _reserved: [u8; 32],
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
