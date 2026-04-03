use anchor_lang::prelude::*;

/// VaultState — the main configuration account for a vault.
///
/// Seeds: ["vault", token_mint.key(), vault_id]
/// Multiple vaults can exist per token type using different vault_id values.
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    /// The admin — can create/deactivate strategies and change delegates.
    pub admin: Pubkey, // 32 bytes

    /// The operational authority — can allocate/deallocate funds between reserve and strategies.
    pub authority: Pubkey, // 32 bytes

    /// The accepted deposit token mint (e.g. USDC).
    pub token_mint: Pubkey, // 32 bytes

    /// The vault's share token mint (created as a PDA during initialize_vault).
    pub share_mint: Pubkey, // 32 bytes

    /// Unique vault ID — allows multiple vaults for the same token mint.
    pub vault_id: u64, // 8 bytes

    /// Total underlying tokens in the vault (reserve + all strategies).
    pub total_deposited: u64, // 8 bytes

    /// Auto-incrementing strategy ID counter (0, 1, 2, ...).
    pub strategy_count: u64, // 8 bytes

    /// PDA bump.
    pub bump: u8, // 1 byte

    /// PDA bump for the share_mint account.
    pub share_mint_bump: u8, // 1 byte
}

/// StrategyAllocation — metadata for a single strategy.
///
/// Seeds: ["strategy", vault_state.key(), &strategy_id.to_le_bytes()]
/// Each strategy = one "pocket" where the vault can delegate tokens to an external protocol.
#[account]
#[derive(InitSpace)]
pub struct StrategyAllocation {
    /// Back-reference to the VaultState this strategy belongs to.
    pub vault: Pubkey, // 32 bytes

    /// Unique sequential ID (0, 1, 2, ...). Part of the PDA seeds.
    pub strategy_id: u64, // 8 bytes

    /// The external protocol address approved as delegate on this strategy's token account.
    pub delegate: Pubkey, // 32 bytes

    /// How many tokens are currently allocated to this strategy.
    pub allocated_amount: u64, // 8 bytes

    /// The PDA token account holding this strategy's tokens.
    pub token_account: Pubkey, // 32 bytes

    /// Whether this strategy is active. Once deactivated, it's permanent.
    pub is_active: bool, // 1 byte

    /// Target allocation weight in basis points (0-10000).
    pub target_weight_bps: u16, // 2 bytes

    /// PDA bump.
    pub bump: u8, // 1 byte

    /// Count of AllowedAction PDAs for this strategy.
    pub action_count: u16, // 2 bytes
}

/// AllowedAction — a whitelisted (program, instruction) pair for a strategy.
///
/// Seeds: ["allowed_action", strategy.key(), &action_id.to_le_bytes()]
/// Each strategy has its own independent whitelist of allowed actions.
/// The delegate (or authority) can only execute CPI calls that match an active AllowedAction.
#[account]
#[derive(InitSpace)]
pub struct AllowedAction {
    /// Back-reference to the StrategyAllocation this action belongs to.
    pub strategy: Pubkey, // 32 bytes

    /// The external program to CPI into (e.g. Lulo, Kamino, Drift).
    pub target_program: Pubkey, // 32 bytes

    /// Anchor instruction discriminator (first 8 bytes of instruction data).
    pub discriminator: [u8; 8], // 8 bytes

    /// Sequential ID within the strategy.
    pub action_id: u16, // 2 bytes

    /// Whether this action is active. Can be deactivated without closing.
    pub is_active: bool, // 1 byte

    /// PDA bump.
    pub bump: u8, // 1 byte
}
