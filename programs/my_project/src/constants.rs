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
