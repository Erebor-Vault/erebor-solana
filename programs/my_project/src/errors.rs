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

    #[msg("Vault is paused")]
    VaultPaused,

    #[msg("Strategy still holds funds — deallocate to zero before deactivating")]
    StrategyStillHoldsFunds,

    #[msg("Unauthorized: caller is neither delegate nor authority")]
    CallerNotDelegateOrAuthority,

    #[msg("Target program account does not match requested target")]
    TargetProgramMismatch,

    #[msg("Action not allowed for this strategy")]
    ActionNotAllowed,

    #[msg("Expected recipient index is out of range")]
    RecipientIndexOutOfRange,

    #[msg("Recipient at expected index is not the strategy token account")]
    RecipientMismatch,

    #[msg("Anti-theft: caller or delegate ATA balance grew during execute_action")]
    AntiTheft,

    #[msg("Fee bps exceeds protocol cap")]
    FeeExceedsMax,

    #[msg("Reported loss exceeds tracked deposit total")]
    LossExceedsDeposited,

    #[msg("Caller is not the pending admin")]
    NotPendingAdmin,

    #[msg("Caller is not the pending authority")]
    NotPendingAuthority,

    #[msg("Sum of active strategy weights would exceed 10000 bps")]
    WeightSumExceedsMax,

    #[msg("Token mint carries a TransferHook extension; not supported")]
    MintHasTransferHook,

    #[msg("Token mint carries a PermanentDelegate extension; not supported")]
    MintHasPermanentDelegate,

    #[msg("Delegate is already used by another active strategy in this vault")]
    DuplicateDelegate,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Caller is not the protocol governance")]
    UnauthorizedGovernance,

    #[msg("Treasury account mismatch with protocol_config.treasury")]
    TreasuryMismatch,

    #[msg("performance_fee_bps cannot be set below the protocol cut")]
    PerformanceFeeBelowProtocolFee,

    #[msg("Reserve plus available strategy ATAs cannot cover the requested withdrawal")]
    InsufficientLiquidity,

    #[msg("Output mint is not on the protocol allow-list")]
    OutputMintNotAllowed,

    #[msg("Output mint is not on this vault's curator allow-list")]
    VaultOutputMintNotAllowed,

    #[msg("Output mint index is out of range of remaining_accounts")]
    OutputMintIndexOutOfRange,

    #[msg("Allowed-action cooldown has not elapsed")]
    ActionCooldownActive,

    #[msg("Loss booked by execute_action exceeds the per-action cap")]
    ActionLossExceedsCap,

    #[msg("Per-action loss cap exceeds protocol maximum")]
    LossCapTooHigh,

    #[msg("Sibling instruction in this transaction is forbidden by introspection guard")]
    SiblingInstructionForbidden,

    #[msg("Signed delta would push allocated_amount negative or overflow")]
    DeltaOutOfRange,

    #[msg("AutoActionConfig kind must be 0 (Deposit) or 1 (Withdraw)")]
    InvalidAutoActionKind,

    #[msg("AutoActionConfig ix_data exceeds the 256-byte cap")]
    AutoActionDataTooLarge,

    #[msg("ValueSource kind must be 0 (SplAtaBalance) or 1 (AccountU64)")]
    InvalidValueSourceKind,

    #[msg("ValueSource index exceeds MAX_VALUE_SOURCES_PER_STRATEGY")]
    ValueSourceIndexOutOfBounds,

    #[msg("ValueSource scale_den must be non-zero")]
    InvalidValueSourceScale,

    #[msg("ValueSource target account passed in remaining_accounts does not match the registered target")]
    ValueSourceTargetMismatch,

    #[msg("ValueSource target account data is shorter than required offset+8")]
    ValueSourceTargetTooSmall,

    #[msg("Account passed in remaining_accounts does not match the expected key/owner/layout")]
    AccountMismatch,

    #[msg("ValueSource target_account must not equal the strategy's own ATA (would double-count)")]
    ValueSourceTargetIsStrategyAta,

    #[msg("Cumulative fan-out from a single deposit cannot exceed the deposit amount")]
    FanOutExceedsDeposit,
}
