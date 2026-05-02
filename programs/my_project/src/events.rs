use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_id: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_minted: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub amount: u64,
}

#[event]
pub struct StrategyCreated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub delegate: Pubkey,
}

#[event]
pub struct StrategyAllocated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub amount: u64,
}

#[event]
pub struct StrategyDeallocated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub amount: u64,
}

#[event]
pub struct StrategyWeightSet {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub weight_bps: u16,
}

#[event]
pub struct DelegateUpdated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub new_delegate: Pubkey,
}

#[event]
pub struct StrategyDeactivated {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
}

#[event]
pub struct YieldReported {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub yield_amount: u64,
    pub new_total_deposited: u64,
}

#[event]
pub struct LossReported {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub amount: u64,
    pub new_total_deposited: u64,
}

#[event]
pub struct Rebalanced {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub delta_signed: i64,
    pub new_allocated: u64,
}

#[event]
pub struct AdminProposed {
    pub vault: Pubkey,
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub vault: Pubkey,
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AuthorityProposed {
    pub vault: Pubkey,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthoritySet {
    pub vault: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct PausedToggled {
    pub vault: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AllowedActionAdded {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    pub expected_recipient_index: u16,
    pub output_mint_index: Option<u16>,
    pub loss_per_call_bps_cap: u16,
    pub cooldown_secs: u32,
}

#[event]
pub struct AllowedActionRemoved {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
}

#[event]
pub struct AllowedTokenAdded {
    pub mint: Pubkey,
}

#[event]
pub struct AllowedTokenRemoved {
    pub mint: Pubkey,
}

#[event]
pub struct VaultAllowedTokenAdded {
    pub vault: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct VaultAllowedTokenRemoved {
    pub vault: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct ActionExecuted {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub caller: Pubkey,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    pub ix_data_len: u32,
}

#[event]
pub struct PerformanceFeeCharged {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub treasury_fee: u64,
    pub curator_fee: u64,
    pub fee_bps: u16,
    pub protocol_fee_bps: u16,
}

#[event]
pub struct PerformanceFeeSet {
    pub vault: Pubkey,
    pub previous_bps: u16,
    pub new_bps: u16,
}

#[event]
pub struct ProtocolConfigInitialized {
    pub governance: Pubkey,
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
}

#[event]
pub struct TreasurySet {
    pub previous: Pubkey,
    pub new_treasury: Pubkey,
}

#[event]
pub struct ProtocolFeeBpsSet {
    pub previous_bps: u16,
    pub new_bps: u16,
}

#[event]
pub struct GovernanceSet {
    pub previous: Pubkey,
    pub new_governance: Pubkey,
}

#[event]
pub struct AutoActionConfigSet {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    /// 0 = Deposit, 1 = Withdraw.
    pub kind: u8,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    pub ix_data_len: u32,
}

#[event]
pub struct AutoActionConfigCleared {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub kind: u8,
}

#[event]
pub struct ValueSourceAdded {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub index: u8,
    pub kind: u8,
    pub target_account: Pubkey,
    pub offset: u32,
    pub scale_num: u64,
    pub scale_den: u64,
}

#[event]
pub struct ValueSourceRemoved {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    pub index: u8,
}

#[event]
pub struct StrategyValueSettled {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    /// Strategy's `allocated_amount` before the settle.
    pub previous_allocated: u64,
    /// Computed live value as the sum across the strategy's value sources.
    pub computed_value: u64,
    /// Signed delta booked into both `strategy.allocated_amount` and
    /// `vault.total_deposited`. Positive = yield, negative = loss.
    pub delta_signed: i64,
}
