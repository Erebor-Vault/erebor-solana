use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use anchor_spl::token_interface::Mint;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as Token2022Mint,
};

use crate::constants::*;
use crate::errors::*;
use crate::state::*;

/// Read the `amount` field (u64 LE) from an SPL Token Account. Same byte
/// offset for classic SPL Token and Token-2022 (extensions follow the
/// base account block). Reverts with `AccountMismatch` if the data is
/// shorter than the expected layout.
pub fn read_spl_token_amount(ai: &AccountInfo<'_>) -> Result<u64> {
    let data = ai.try_borrow_data()?;
    require!(
        data.len() >= SPL_TOKEN_AMOUNT_OFFSET + 8,
        VaultError::AccountMismatch
    );
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[SPL_TOKEN_AMOUNT_OFFSET..SPL_TOKEN_AMOUNT_OFFSET + 8]);
    Ok(u64::from_le_bytes(buf))
}

/// Decode an Anchor-owned PDA from raw account data. Returns `Ok(None)`
/// for the "skip silently" cases (wrong owner, short data, mismatched
/// Anchor discriminator) so loops over `remaining_accounts` can iterate
/// without aborting on a stray entry. Returns `Err(AccountMismatch)` only
/// if the discriminator matches but Borsh deserialize then fails — that's
/// genuine corruption, not an unrelated account.
pub fn try_load_program_pda<T>(ai: &AccountInfo<'_>) -> Result<Option<T>>
where
    T: AnchorDeserialize + Discriminator,
{
    let program_id = crate::ID;
    if ai.owner != &program_id {
        return Ok(None);
    }
    let data = ai.try_borrow_data()?;
    if data.len() < 8 {
        return Ok(None);
    }
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&data[..8]);
    if disc != T::DISCRIMINATOR {
        return Ok(None);
    }
    let mut slice: &[u8] = &data[8..];
    T::deserialize(&mut slice)
        .map(Some)
        .map_err(|_| error!(VaultError::AccountMismatch))
}

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
    for ai in other_strategies.iter() {
        if let Some(skip) = skip_strategy_key {
            if ai.key == skip {
                continue;
            }
        }
        let Some(acct) = try_load_program_pda::<StrategyAllocation>(ai)? else {
            continue;
        };
        if acct.vault == *vault_state_key && acct.is_active && acct.delegate == new_delegate {
            return err!(VaultError::DuplicateDelegate);
        }
    }
    Ok(())
}
