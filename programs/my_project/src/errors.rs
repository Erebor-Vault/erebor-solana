use anchor_lang::prelude::*;

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
}
