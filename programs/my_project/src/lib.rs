use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B");

#[program]
pub mod my_project {
    use super::*;

    // ============================================================
    // VAULT INSTRUCTIONS
    // ============================================================

    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_id: u64) -> Result<()> {
        instructions::initialize_vault::handler(ctx, vault_id)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
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

    pub fn deactivate_strategy(ctx: Context<DeactivateStrategy>) -> Result<()> {
        instructions::deactivate_strategy::handler(ctx)
    }

    // ============================================================
    // ADMIN MANAGEMENT INSTRUCTIONS
    // ============================================================

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::transfer_admin::handler(ctx, new_admin)
    }

    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::set_authority::handler(ctx, new_authority)
    }

    // ============================================================
    // AUTOMATED REBALANCING INSTRUCTIONS
    // ============================================================

    pub fn set_strategy_weight(ctx: Context<SetStrategyWeight>, weight_bps: u16) -> Result<()> {
        instructions::set_strategy_weight::handler(ctx, weight_bps)
    }

    pub fn rebalance_strategy(ctx: Context<RebalanceStrategy>) -> Result<()> {
        instructions::rebalance_strategy::handler(ctx)
    }

    // ============================================================
    // ACTION WHITELIST INSTRUCTIONS
    // ============================================================

    pub fn add_allowed_action(
        ctx: Context<AddAllowedAction>,
        target_program: Pubkey,
        discriminator: [u8; 8],
    ) -> Result<()> {
        instructions::add_allowed_action::handler(ctx, target_program, discriminator)
    }

    pub fn remove_allowed_action(ctx: Context<RemoveAllowedAction>) -> Result<()> {
        instructions::remove_allowed_action::handler(ctx)
    }

    pub fn migrate_strategy(ctx: Context<MigrateStrategy>) -> Result<()> {
        instructions::migrate_strategy::handler(ctx)
    }

    pub fn execute_strategy_action<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteStrategyAction<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()> {
        instructions::execute_strategy_action::handler(ctx, instruction_data)
    }
}
