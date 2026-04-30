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
    pub bump: u8,
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
