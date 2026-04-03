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

    #[msg("Unauthorized: not delegate or authority")]
    UnauthorizedCaller,

    #[msg("Action is not in the allowed list for this strategy")]
    ActionNotAllowed,

    #[msg("Action is not active")]
    ActionNotActive,

    #[msg("Invalid strategy reference")]
    InvalidStrategy,

    #[msg("Instruction data too short or invalid")]
    InvalidInstructionData,

    #[msg("Writable token account belongs to caller — funds must flow to vault-owned accounts")]
    UnauthorizedDestination,
}
