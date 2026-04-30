use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as Token2022Mint,
};

use crate::errors::*;
use crate::state::*;

pub fn reject_dangerous_mint_extensions(mint: &InterfaceAccount<'_, Mint>) -> Result<()> {
    let info = mint.to_account_info();
    // Classic SPL Token mints have no extensions; only inspect Token-2022.
    if info.owner != &anchor_spl::token_2022::spl_token_2022::ID {
        return Ok(());
    }
    let data = info.try_borrow_data()?;
    let mint_with_ext = StateWithExtensions::<Token2022Mint>::unpack(&data)
        .map_err(|_| error!(VaultError::InvalidMint))?;
    let exts = mint_with_ext
        .get_extension_types()
        .map_err(|_| error!(VaultError::InvalidMint))?;
    require!(
        !exts.contains(&ExtensionType::TransferHook),
        VaultError::MintHasTransferHook
    );
    require!(
        !exts.contains(&ExtensionType::PermanentDelegate),
        VaultError::MintHasPermanentDelegate
    );
    Ok(())
}

pub fn check_delegate_not_duplicated(
    other_strategies: &[AccountInfo<'_>],
    vault_state_key: &Pubkey,
    new_delegate: Pubkey,
    skip_strategy_key: Option<&Pubkey>,
) -> Result<()> {
    let program_id = crate::ID;
    for ai in other_strategies.iter() {
        if ai.owner != &program_id {
            continue;
        }
        if let Some(skip) = skip_strategy_key {
            if ai.key == skip {
                continue;
            }
        }
        let data = ai.try_borrow_data()?;
        if data.len() < 8 + StrategyAllocation::INIT_SPACE {
            continue;
        }
        // Verify Anchor discriminator before deserializing.
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&data[..8]);
        if disc != StrategyAllocation::DISCRIMINATOR {
            continue;
        }
        // Discriminator already validated above; deserialize the rest with
        // raw Borsh. (`try_deserialize_unchecked` would re-advance past the
        // discriminator and corrupt the read.)
        let mut slice: &[u8] = &data[8..];
        let acct = StrategyAllocation::deserialize(&mut slice)
            .map_err(|_| error!(VaultError::InvalidMint))?;
        if acct.vault == *vault_state_key && acct.is_active && acct.delegate == new_delegate {
            return err!(VaultError::DuplicateDelegate);
        }
    }
    Ok(())
}
