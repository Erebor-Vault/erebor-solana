/// Default performance fee charged at withdraw time (5%, in basis points).
/// This is the *total* fee deducted from a withdrawal — split inside
/// `withdraw` into a constant protocol cut (`ProtocolConfig.protocol_fee_bps`,
/// default 200 = 2%) routed to the treasury, and the remainder to the
/// vault admin (the curator).
pub const DEFAULT_PERFORMANCE_FEE_BPS: u16 = 500;

/// Hard cap on performance fee — admins cannot set above this.
pub const MAX_PERFORMANCE_FEE_BPS: u16 = 2000;

/// Cap on the sum of `target_weight_bps` across all *active* strategies.
pub const MAX_TOTAL_ACTIVE_WEIGHT_BPS: u16 = 10_000;

/// Virtual-shares offset for inflation-attack mitigation (audit #4 / spec §9).
/// OpenZeppelin pattern: shares = amount × (supply + VIRTUAL) / (assets + 1).
pub const VIRTUAL_SHARES: u128 = 1_000_000;

/// Phase-5: program-level maximum for `AllowedAction.loss_per_call_bps_cap`.
/// Curators cannot wave through actions that may book more than 50% of a
/// strategy's allocation in a single call.
pub const MAX_LOSS_PER_CALL_BPS: u16 = 5_000;

/// Maximum number of `ValueSource` PDAs a single strategy can register.
/// Enforced at registration time by `add_value_source` via
/// `require!(index < MAX_VALUE_SOURCES_PER_STRATEGY, ...)`.
pub const MAX_VALUE_SOURCES_PER_STRATEGY: u8 = 16;

/// Value-source kind discriminants — must match the on-chain
/// `ValueSource.kind` byte.
pub const VALUE_SOURCE_KIND_SPL_ATA_BALANCE: u8 = 0;
pub const VALUE_SOURCE_KIND_ACCOUNT_U64: u8 = 1;

/// AutoActionConfig kind discriminants — must match the on-chain
/// `AutoActionConfig.kind` byte.
pub const AUTO_ACTION_KIND_DEPOSIT: u8 = 0;
pub const AUTO_ACTION_KIND_WITHDRAW: u8 = 1;

/// `AutoActionConfig.ix_data` byte cap.
pub const MAX_AUTO_ACTION_IX_DATA_LEN: usize = 256;

/// SPL Token Account `amount` byte offset (LE u64). Same for spl-token
/// and spl-token-2022 (extensions follow the base account block).
pub const SPL_TOKEN_AMOUNT_OFFSET: usize = 64;

/// Solana caps a single transaction at 64 instructions; used as the
/// upper bound for the sibling-instruction introspection loop.
pub const MAX_INSTRUCTIONS_PER_TX: usize = 64;
