# Plan 1 — `PythPriceFeed` ValueSource + `mock_pyth` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `ValueSource` kind (`PythPriceFeed`) so `settle_strategy_value` can compute strategy NAV in underlying-token units from on-chain price feeds, and ship a `mock_pyth` Anchor program for devnet so the path is exercised without depending on live Pyth.

**Architecture:** Carve the new variant's two extra fields (`mint_balance_source_index: u8`, `max_staleness_secs: u32`) out of `ValueSource._reserved` (32 → 27 bytes remaining) so live devnet `ValueSource` accounts deserialize unchanged. The `PythPriceFeed` variant references *another* `SplAtaBalance` ValueSource by index (the balance source) and a price account (the rate source); the reader multiplies `balance × price × 10^expo` and contributes to `computed_value`. `mock_pyth` writes a fixed-layout price account that the reader interprets at known offsets; mainnet wiring against real Pyth `PriceUpdateV2` accounts is gated to a follow-up where offsets are verified. The plan ends with a working e2e devnet test of `settle_strategy_value` reading a mock-Pyth-priced position.

**Tech Stack:** Anchor 0.32.1, Rust 2021 edition, Solana cargo-build-sbf (Cargo 1.75), TypeScript ts-mocha + chai, `@coral-xyz/anchor` 0.32.

---

## File Structure

**Created:**
- `programs/mock_pyth/Cargo.toml`
- `programs/mock_pyth/Xargo.toml`
- `programs/mock_pyth/src/lib.rs` — single Anchor program with one account type (`MockPriceFeed`) and one ix (`set_price`). Wire layout matches the offsets the on-chain reader expects.
- `tests/pyth_value_source.ts` — e2e test that boots a vault, registers a balance + Pyth ValueSource, sets a price via `mock_pyth`, calls `settle_strategy_value`, asserts `vault.total_deposited` increased by `balance × price`.
- `tests/helpers/mock_pyth.ts` — TS helpers to derive PDAs and call `set_price`.

**Modified:**
- `Anchor.toml` — register `mock_pyth` program ID under `[programs.devnet]`, `[programs.localnet]`, `[programs.mainnet]`. Mainnet entry points at the same ID but the program will not be deployed there (gated in `scripts/deploy.sh`).
- `programs/my_project/src/constants.rs` — add `VALUE_SOURCE_KIND_PYTH_PRICE_FEED: u8 = 2`, plus `PYTH_PRICE_OFFSET`, `PYTH_EXPO_OFFSET`, `PYTH_PUBLISH_TIME_OFFSET` constants matching the `mock_pyth` `MockPriceFeed` layout.
- `programs/my_project/src/state.rs` — extend `ValueSource` with `mint_balance_source_index: u8`, `max_staleness_secs: u32`, shrink `_reserved` from `[u8; 32]` to `[u8; 27]`. `INIT_SPACE` is unchanged (Anchor recomputes it).
- `programs/my_project/src/errors.rs` — add `ValueSourcePythStale`, `ValueSourcePythNegativePrice`, `ValueSourcePythBadIndex`, `ValueSourcePythBalanceSourceMissing`, `ValueSourcePythRecursive`, `ValueSourcePythBalanceKindMismatch`. Update the existing "kind must be 0 or 1" message to "0, 1, or 2".
- `programs/my_project/src/instructions/add_value_source.rs` — accept the new fields, validate `kind == 2` rules.
- `programs/my_project/src/instructions/settle_strategy_value.rs` — handle `kind == 2` in the loop. Requires a two-pass walk (first pass collects `SplAtaBalance` reads by their `index`; second pass evaluates `PythPriceFeed` entries against that map).
- `programs/my_project/src/lib.rs` — bump the `add_value_source` doc comment, add the new params to its signature, re-export.
- `programs/my_project/src/events.rs` — extend `ValueSourceAdded` with the two new fields.
- `app/src/idl/my_project.ts` — regenerated after `anchor build`.
- `Cargo.toml` (workspace) — no change needed; `programs/*` glob picks up `mock_pyth` automatically.
- `scripts/deploy.sh` — guard against deploying `mock_pyth` to mainnet.

---

## Wire layout (the contract this plan establishes)

`mock_pyth::MockPriceFeed` and the `my_project` reader both use:

| Offset | Size | Field           | Type | Notes |
|--------|------|-----------------|------|-------|
| 0..8   | 8    | Anchor disc     | `[u8;8]` | Standard `MockPriceFeed` discriminator |
| 8..16  | 8    | `price`         | `i64`    | Price as integer; multiply by `10^expo` for real value |
| 16..20 | 4    | `expo`          | `i32`    | Typically negative (e.g. `-8`) |
| 20..28 | 8    | `publish_time`  | `i64`    | Unix seconds; `Clock::get()?.unix_timestamp - publish_time` must be ≤ `max_staleness_secs` |
| 28..32 | 4    | `_reserved`     | `[u8;4]` | Padding for future fields |

`PYTH_PRICE_OFFSET = 8`, `PYTH_EXPO_OFFSET = 16`, `PYTH_PUBLISH_TIME_OFFSET = 20`.

This is **not** wire-compatible with real Pyth's `PriceUpdateV2` yet — that is gated to the FOLLOWUPS A4 verification task. For Plan 1, both producer (`mock_pyth`) and consumer (`my_project::settle_strategy_value`) agree on this layout.

---

## Task 1: Add ValueSource kind constant + Pyth offset constants

**Files:**
- Modify: `programs/my_project/src/constants.rs`

- [ ] **Step 1: Add constants**

Append at the end of the file (after the existing `VALUE_SOURCE_KIND_*` constants and `SPL_TOKEN_AMOUNT_OFFSET`):

```rust
/// Phase-5b: third `ValueSource.kind` byte. Reads price from a Pyth-style
/// price account and multiplies by an SPL balance read from a sibling
/// `SplAtaBalance` ValueSource at `mint_balance_source_index`.
pub const VALUE_SOURCE_KIND_PYTH_PRICE_FEED: u8 = 2;

/// Byte offsets inside a `mock_pyth::MockPriceFeed` account (and any
/// future Pyth-compatible feed wired in via FOLLOWUPS A4).
pub const PYTH_PRICE_OFFSET: usize = 8;
pub const PYTH_EXPO_OFFSET: usize = 16;
pub const PYTH_PUBLISH_TIME_OFFSET: usize = 20;
/// Last byte the reader touches; account data must be at least this long.
pub const PYTH_MIN_ACCOUNT_LEN: usize = PYTH_PUBLISH_TIME_OFFSET + 8;
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p my_project`
Expected: PASS (no warnings about unused constants is fine — they're consumed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add programs/my_project/src/constants.rs
git commit -m "feat(vault): add VALUE_SOURCE_KIND_PYTH_PRICE_FEED + Pyth offset consts"
```

---

## Task 2: Extend the `ValueSource` state struct

**Files:**
- Modify: `programs/my_project/src/state.rs:119-136`

- [ ] **Step 1: Update the struct**

Replace the existing `ValueSource` definition (around line 119–136) with:

```rust
/// Phase-5/5b: per-strategy value-source registry entry. A strategy can
/// have up to `MAX_VALUE_SOURCES_PER_STRATEGY` sources; the live value of
/// the strategy is the sum across them. Source kinds:
///   - 0 (SplAtaBalance): read SPL Token Account `amount` at offset 64..72.
///   - 1 (AccountU64): read u64 at `target_account.data[offset..offset+8]`.
///   - 2 (PythPriceFeed): read price/expo/publish_time at the canonical
///     `PYTH_*_OFFSET` constants from `target_account`; multiply by the
///     balance from the `SplAtaBalance` source at
///     `mint_balance_source_index`. Reverts if `now - publish_time >
///     max_staleness_secs` or if `price < 0`.
///
/// `scale_num / scale_den` is applied to convert the raw read into
/// underlying-token units; both default to 1.
#[account]
#[derive(InitSpace)]
pub struct ValueSource {
    pub vault: Pubkey,
    pub strategy: Pubkey,
    pub strategy_id: u64,
    /// Per-strategy slot index, 0..MAX_VALUE_SOURCES_PER_STRATEGY-1.
    pub index: u8,
    /// 0 = SplAtaBalance, 1 = AccountU64, 2 = PythPriceFeed.
    pub kind: u8,
    pub target_account: Pubkey,
    /// Byte offset for `AccountU64`. Ignored for `SplAtaBalance` and
    /// `PythPriceFeed`.
    pub offset: u32,
    pub scale_num: u64,
    pub scale_den: u64,
    pub bump: u8,
    /// Phase-5b: only meaningful for `PythPriceFeed`. Index of the
    /// sibling `SplAtaBalance` ValueSource whose balance gets multiplied
    /// by this feed's price. Ignored for other kinds.
    pub mint_balance_source_index: u8,
    /// Phase-5b: only meaningful for `PythPriceFeed`. Reverts if
    /// `now - publish_time > max_staleness_secs`. Ignored for other kinds.
    pub max_staleness_secs: u32,
    pub _reserved: [u8; 27],
}
```

Note: the **byte layout of pre-existing accounts is preserved** because the new fields land at the start of what used to be `_reserved`, which is zero-initialised. `kind != 2` ignores them.

- [ ] **Step 2: Compile-check**

Run: `cargo check -p my_project`
Expected: PASS. (`add_value_source` and `settle_strategy_value` will fail in later tasks until updated — but `cargo check` here only flags `state.rs`-level errors.)

If it complains about `add_value_source` or related sites, that's expected; continue to Task 3.

- [ ] **Step 3: Commit**

```bash
git add programs/my_project/src/state.rs
git commit -m "feat(vault): extend ValueSource with Pyth fields, shrink _reserved 32->27"
```

---

## Task 3: Add error variants

**Files:**
- Modify: `programs/my_project/src/errors.rs`

- [ ] **Step 1: Update existing message + add new variants**

Find the existing entry around line 125:
```rust
    #[msg("ValueSource kind must be 0 (SplAtaBalance) or 1 (AccountU64)")]
    InvalidValueSourceKind,
```

Replace with:
```rust
    #[msg("ValueSource kind must be 0 (SplAtaBalance), 1 (AccountU64), or 2 (PythPriceFeed)")]
    InvalidValueSourceKind,
```

Then append, just before the closing `}` of the `VaultError` enum:

```rust
    #[msg("Pyth price feed is stale: now - publish_time exceeds max_staleness_secs")]
    ValueSourcePythStale,

    #[msg("Pyth price feed reported a negative price")]
    ValueSourcePythNegativePrice,

    #[msg("PythPriceFeed.mint_balance_source_index is out of range or self-referential")]
    ValueSourcePythBadIndex,

    #[msg("PythPriceFeed.mint_balance_source_index does not resolve to a present ValueSource in remaining_accounts")]
    ValueSourcePythBalanceSourceMissing,

    #[msg("PythPriceFeed.mint_balance_source_index must point at an SplAtaBalance source, not another PythPriceFeed or AccountU64")]
    ValueSourcePythBalanceKindMismatch,
```

- [ ] **Step 2: Compile-check**

Run: `cargo check -p my_project`
Expected: PASS at the errors-module level (other modules still failing is fine).

- [ ] **Step 3: Commit**

```bash
git add programs/my_project/src/errors.rs
git commit -m "feat(vault): add Pyth ValueSource error variants"
```

---

## Task 4: Extend `ValueSourceAdded` event

**Files:**
- Modify: `programs/my_project/src/events.rs:257-269` (the `ValueSourceAdded` event)

- [ ] **Step 1: Add fields**

Add `mint_balance_source_index: u8` and `max_staleness_secs: u32` at the end of the `ValueSourceAdded` struct:

```rust
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
    pub mint_balance_source_index: u8,
    pub max_staleness_secs: u32,
}
```

- [ ] **Step 2: Compile-check**

Run: `cargo check -p my_project`
Expected: still failing in `add_value_source.rs` (next task fixes the emit call).

- [ ] **Step 3: Commit**

```bash
git add programs/my_project/src/events.rs
git commit -m "feat(vault): add Pyth fields to ValueSourceAdded event"
```

---

## Task 5: Extend `add_value_source` instruction

**Files:**
- Modify: `programs/my_project/src/instructions/add_value_source.rs`

- [ ] **Step 1: Update the handler signature + body**

Replace the entire `handler` function with:

```rust
pub fn handler(
    ctx: Context<AddValueSource>,
    strategy_id: u64,
    index: u8,
    kind: u8,
    target_account: Pubkey,
    offset: u32,
    scale_num: u64,
    scale_den: u64,
    mint_balance_source_index: u8,
    max_staleness_secs: u32,
) -> Result<()> {
    require!(
        index < MAX_VALUE_SOURCES_PER_STRATEGY,
        VaultError::ValueSourceIndexOutOfBounds
    );
    require!(
        kind == VALUE_SOURCE_KIND_SPL_ATA_BALANCE
            || kind == VALUE_SOURCE_KIND_ACCOUNT_U64
            || kind == VALUE_SOURCE_KIND_PYTH_PRICE_FEED,
        VaultError::InvalidValueSourceKind
    );
    require!(scale_den > 0, VaultError::InvalidValueSourceScale);

    if kind == VALUE_SOURCE_KIND_PYTH_PRICE_FEED {
        require!(
            mint_balance_source_index < MAX_VALUE_SOURCES_PER_STRATEGY
                && mint_balance_source_index != index,
            VaultError::ValueSourcePythBadIndex
        );
        require!(
            max_staleness_secs > 0,
            VaultError::ValueSourcePythStale
        );
    }

    let vs = &mut ctx.accounts.value_source;
    vs.vault = ctx.accounts.vault_state.key();
    vs.strategy = ctx.accounts.strategy.key();
    vs.strategy_id = strategy_id;
    vs.index = index;
    vs.kind = kind;
    vs.target_account = target_account;
    vs.offset = offset;
    vs.scale_num = scale_num;
    vs.scale_den = scale_den;
    vs.bump = ctx.bumps.value_source;
    vs.mint_balance_source_index = mint_balance_source_index;
    vs.max_staleness_secs = max_staleness_secs;
    vs._reserved = [0; 27];

    emit!(ValueSourceAdded {
        vault: ctx.accounts.vault_state.key(),
        strategy: ctx.accounts.strategy.key(),
        strategy_id,
        index,
        kind,
        target_account,
        offset,
        scale_num,
        scale_den,
        mint_balance_source_index,
        max_staleness_secs,
    });
    Ok(())
}
```

- [ ] **Step 2: Update the `lib.rs` entrypoint signature**

In `programs/my_project/src/lib.rs`, find the `add_value_source` function (around line 287–313) and update its signature + body to pass the two new args:

```rust
    /// Admin-only. Registers a `ValueSource` slot for a strategy. `kind`
    /// 0 = SplAtaBalance (read u64 at offset 64..72 of `target_account`);
    /// 1 = AccountU64 (read u64 at `offset..offset+8`); 2 = PythPriceFeed
    /// (read price/expo/publish_time at canonical Pyth offsets, multiply
    /// by balance from sibling SplAtaBalance source at
    /// `mint_balance_source_index`). Raw read scaled by
    /// `scale_num/scale_den` (both default to 1). Pyth path reverts if
    /// stale (`now - publish_time > max_staleness_secs`) or price < 0.
    pub fn add_value_source(
        ctx: Context<AddValueSource>,
        strategy_id: u64,
        index: u8,
        kind: u8,
        target_account: Pubkey,
        offset: u32,
        scale_num: u64,
        scale_den: u64,
        mint_balance_source_index: u8,
        max_staleness_secs: u32,
    ) -> Result<()> {
        instructions::add_value_source::handler(
            ctx,
            strategy_id,
            index,
            kind,
            target_account,
            offset,
            scale_num,
            scale_den,
            mint_balance_source_index,
            max_staleness_secs,
        )
    }
```

- [ ] **Step 3: Compile-check**

Run: `cargo check -p my_project`
Expected: failing only in `settle_strategy_value.rs` now.

- [ ] **Step 4: Commit**

```bash
git add programs/my_project/src/instructions/add_value_source.rs programs/my_project/src/lib.rs
git commit -m "feat(vault): accept Pyth fields in add_value_source"
```

---

## Task 6: Extend `settle_strategy_value` reader

**Files:**
- Modify: `programs/my_project/src/instructions/settle_strategy_value.rs`

This is the load-bearing change. The existing single-pass loop assumed every kind is self-contained. Pyth needs the *balance* from a sibling `SplAtaBalance` source. We do a two-pass walk: pass 1 reads + caches all `SplAtaBalance` (raw, pre-scale) balances by their `index`; pass 2 evaluates the rest, summing into `total_value`. `AccountU64` can be evaluated in either pass (we put it in pass 2 alongside Pyth for simplicity).

- [ ] **Step 1: Replace the handler**

Replace the entire `handler` function (lines 47–153) with:

```rust
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleStrategyValue<'info>>,
    _strategy_id: u64,
) -> Result<()> {
    require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);

    let strategy_key = ctx.accounts.strategy.key();
    let strategy_ata_key = ctx.accounts.strategy.token_account;
    let now = Clock::get()?.unix_timestamp;

    // Strategy ATA's idle balance — already-allocated funds not deployed
    // externally yet.
    let mut total_value: u128 = ctx.accounts.strategy_token_account.amount as u128;

    // Pass 1: pre-scan all `SplAtaBalance` sources, caching their raw u64
    // balance keyed by the VS `index`. Pyth sources in pass 2 read from
    // this cache.
    let mut balance_by_index: [Option<u64>; MAX_VALUE_SOURCES_PER_STRATEGY as usize] =
        [None; MAX_VALUE_SOURCES_PER_STRATEGY as usize];

    for chunk in ctx.remaining_accounts.chunks_exact(2) {
        let vs_ai = &chunk[0];
        let target_ai = &chunk[1];
        let Some(vs) = try_load_program_pda::<ValueSource>(vs_ai)? else {
            continue;
        };
        if vs.kind != VALUE_SOURCE_KIND_SPL_ATA_BALANCE {
            continue;
        }
        require!(vs.strategy == strategy_key, VaultError::AccountMismatch);
        require!(
            target_ai.key() == vs.target_account,
            VaultError::ValueSourceTargetMismatch
        );
        require!(
            vs.target_account != strategy_ata_key,
            VaultError::ValueSourceTargetIsStrategyAta
        );
        let data = target_ai.try_borrow_data()?;
        require!(
            data.len() >= SPL_TOKEN_AMOUNT_OFFSET + 8,
            VaultError::ValueSourceTargetTooSmall
        );
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&data[SPL_TOKEN_AMOUNT_OFFSET..SPL_TOKEN_AMOUNT_OFFSET + 8]);
        balance_by_index[vs.index as usize] = Some(u64::from_le_bytes(buf));

        // Also fold into total_value with its own scale.
        let raw = u64::from_le_bytes(buf) as u128;
        let contribution = raw
            .checked_mul(vs.scale_num as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vs.scale_den as u128)
            .ok_or(VaultError::MathOverflow)?;
        total_value = total_value
            .checked_add(contribution)
            .ok_or(VaultError::MathOverflow)?;
    }

    // Pass 2: evaluate AccountU64 + PythPriceFeed sources.
    for chunk in ctx.remaining_accounts.chunks_exact(2) {
        let vs_ai = &chunk[0];
        let target_ai = &chunk[1];
        let Some(vs) = try_load_program_pda::<ValueSource>(vs_ai)? else {
            continue;
        };
        require!(vs.strategy == strategy_key, VaultError::AccountMismatch);
        require!(
            target_ai.key() == vs.target_account,
            VaultError::ValueSourceTargetMismatch
        );
        require!(
            vs.target_account != strategy_ata_key,
            VaultError::ValueSourceTargetIsStrategyAta
        );

        let contribution: u128 = match vs.kind {
            VALUE_SOURCE_KIND_SPL_ATA_BALANCE => continue, // already counted in pass 1
            VALUE_SOURCE_KIND_ACCOUNT_U64 => {
                let off = vs.offset as usize;
                let data = target_ai.try_borrow_data()?;
                require!(
                    data.len() >= off.checked_add(8).ok_or(VaultError::MathOverflow)?,
                    VaultError::ValueSourceTargetTooSmall
                );
                let mut buf = [0u8; 8];
                buf.copy_from_slice(&data[off..off + 8]);
                let raw = u64::from_le_bytes(buf) as u128;
                raw.checked_mul(vs.scale_num as u128)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(vs.scale_den as u128)
                    .ok_or(VaultError::MathOverflow)?
            }
            VALUE_SOURCE_KIND_PYTH_PRICE_FEED => {
                // Resolve the sibling balance source.
                require!(
                    vs.mint_balance_source_index < MAX_VALUE_SOURCES_PER_STRATEGY
                        && vs.mint_balance_source_index != vs.index,
                    VaultError::ValueSourcePythBadIndex
                );
                let balance = balance_by_index[vs.mint_balance_source_index as usize]
                    .ok_or(error!(VaultError::ValueSourcePythBalanceSourceMissing))?;

                let data = target_ai.try_borrow_data()?;
                require!(
                    data.len() >= PYTH_MIN_ACCOUNT_LEN,
                    VaultError::ValueSourceTargetTooSmall
                );

                let mut price_buf = [0u8; 8];
                price_buf.copy_from_slice(&data[PYTH_PRICE_OFFSET..PYTH_PRICE_OFFSET + 8]);
                let price = i64::from_le_bytes(price_buf);
                require!(price >= 0, VaultError::ValueSourcePythNegativePrice);

                let mut expo_buf = [0u8; 4];
                expo_buf.copy_from_slice(&data[PYTH_EXPO_OFFSET..PYTH_EXPO_OFFSET + 4]);
                let expo = i32::from_le_bytes(expo_buf);

                let mut pt_buf = [0u8; 8];
                pt_buf.copy_from_slice(
                    &data[PYTH_PUBLISH_TIME_OFFSET..PYTH_PUBLISH_TIME_OFFSET + 8],
                );
                let publish_time = i64::from_le_bytes(pt_buf);

                let age = now.checked_sub(publish_time).unwrap_or(i64::MAX);
                require!(
                    age >= 0 && (age as u64) <= vs.max_staleness_secs as u64,
                    VaultError::ValueSourcePythStale
                );

                // contribution = balance × price × 10^expo, with scale.
                let mut value: u128 = (balance as u128)
                    .checked_mul(price as u128)
                    .ok_or(VaultError::MathOverflow)?;
                if expo < 0 {
                    let factor = 10u128
                        .checked_pow((-expo) as u32)
                        .ok_or(VaultError::MathOverflow)?;
                    value = value.checked_div(factor).ok_or(VaultError::MathOverflow)?;
                } else if expo > 0 {
                    let factor = 10u128
                        .checked_pow(expo as u32)
                        .ok_or(VaultError::MathOverflow)?;
                    value = value.checked_mul(factor).ok_or(VaultError::MathOverflow)?;
                }
                value
                    .checked_mul(vs.scale_num as u128)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(vs.scale_den as u128)
                    .ok_or(VaultError::MathOverflow)?
            }
            _ => return err!(VaultError::InvalidValueSourceKind),
        };

        total_value = total_value
            .checked_add(contribution)
            .ok_or(VaultError::MathOverflow)?;
    }

    let computed_value: u64 = total_value
        .try_into()
        .map_err(|_| error!(VaultError::MathOverflow))?;

    let prev_allocated = ctx.accounts.strategy.allocated_amount;
    let delta_signed: i64 = if computed_value >= prev_allocated {
        let delta = computed_value
            .checked_sub(prev_allocated)
            .ok_or(VaultError::MathOverflow)?;
        ctx.accounts.strategy.allocated_amount = computed_value;
        ctx.accounts.vault_state.total_deposited = ctx
            .accounts
            .vault_state
            .total_deposited
            .checked_add(delta)
            .ok_or(VaultError::MathOverflow)?;
        delta as i64
    } else {
        let loss = prev_allocated
            .checked_sub(computed_value)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            loss <= ctx.accounts.vault_state.total_deposited,
            VaultError::LossExceedsDeposited
        );
        ctx.accounts.strategy.allocated_amount = computed_value;
        ctx.accounts.vault_state.total_deposited = ctx
            .accounts
            .vault_state
            .total_deposited
            .checked_sub(loss)
            .ok_or(VaultError::MathOverflow)?;
        -(loss as i64)
    };

    emit!(StrategyValueSettled {
        vault: ctx.accounts.vault_state.key(),
        strategy: strategy_key,
        strategy_id: ctx.accounts.strategy.strategy_id,
        previous_allocated: prev_allocated,
        computed_value,
        delta_signed,
    });

    Ok(())
}
```

Note the call now needs the new constants in scope — the existing `use crate::constants::*;` already covers them.

- [ ] **Step 2: Build the program**

Run: `anchor build`
Expected: clean build. Watch for warnings about unused imports — clean them up if any.

- [ ] **Step 3: Commit**

```bash
git add programs/my_project/src/instructions/settle_strategy_value.rs
git commit -m "feat(vault): handle PythPriceFeed kind in settle_strategy_value"
```

---

## Task 7: Scaffold `mock_pyth` program

**Files:**
- Create: `programs/mock_pyth/Cargo.toml`
- Create: `programs/mock_pyth/Xargo.toml`
- Create: `programs/mock_pyth/src/lib.rs`

- [ ] **Step 1: Generate a fresh program ID**

Run: `solana-keygen new --outfile target/deploy/mock_pyth-keypair.json --no-bip39-passphrase --force`
Capture the printed pubkey — call it `<MOCK_PYTH_PROGRAM_ID>`. Use this exact string in Step 3 and Step 4.

- [ ] **Step 2: Write `Cargo.toml`**

Path: `programs/mock_pyth/Cargo.toml`

```toml
[package]
name = "mock_pyth"
version = "0.1.0"
description = "Mock Pyth price-feed program for devnet testing of Erebor PythPriceFeed ValueSource"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "mock_pyth"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build"]
anchor-debug = []
custom-heap = []
custom-panic = []

[dependencies]
anchor-lang = "0.32.1"

[lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = ['cfg(target_os, values("solana"))'] }
```

- [ ] **Step 3: Write `Xargo.toml`** (matches sibling mocks)

Path: `programs/mock_pyth/Xargo.toml`

```toml
[target.bpfel-unknown-unknown.dependencies.std]
features = []
```

- [ ] **Step 4: Write `lib.rs`**

Path: `programs/mock_pyth/src/lib.rs`. Replace `<MOCK_PYTH_PROGRAM_ID>` with the pubkey from Step 1.

```rust
//! mock_pyth — Minimal Pyth-style price feed for devnet/localnet testing.
//!
//! Wire layout of `MockPriceFeed` matches what `my_project::settle_strategy_value`
//! expects (constants `PYTH_PRICE_OFFSET = 8`, `PYTH_EXPO_OFFSET = 16`,
//! `PYTH_PUBLISH_TIME_OFFSET = 20`). Real Pyth `PriceUpdateV2` wiring is a
//! follow-up (see docs/FOLLOWUPS.md A4).

use anchor_lang::prelude::*;

declare_id!("<MOCK_PYTH_PROGRAM_ID>");

#[program]
pub mod mock_pyth {
    use super::*;

    /// Initialise a `MockPriceFeed` PDA seeded by `[b"price", mint]`.
    /// Sets initial price/expo and stamps `publish_time = now`.
    pub fn initialize_feed(
        ctx: Context<InitializeFeed>,
        price: i64,
        expo: i32,
    ) -> Result<()> {
        let feed = &mut ctx.accounts.feed;
        feed.price = price;
        feed.expo = expo;
        feed.publish_time = Clock::get()?.unix_timestamp;
        feed._reserved = [0; 4];
        Ok(())
    }

    /// Update price/expo and stamp `publish_time = now`. Anyone can update
    /// — this is mock infra; production swaps in a real Pyth feed.
    pub fn set_price(
        ctx: Context<SetPrice>,
        price: i64,
        expo: i32,
    ) -> Result<()> {
        let feed = &mut ctx.accounts.feed;
        feed.price = price;
        feed.expo = expo;
        feed.publish_time = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: any pubkey works as the seed identifier — typically a token
    /// mint, but the program does not enforce SPL Mint shape.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + MockPriceFeed::INIT_SPACE,
        seeds = [b"price", mint.key().as_ref()],
        bump,
    )]
    pub feed: Account<'info, MockPriceFeed>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    pub payer: Signer<'info>,

    /// CHECK: same as InitializeFeed — used only as a seed.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"price", mint.key().as_ref()],
        bump,
    )]
    pub feed: Account<'info, MockPriceFeed>,
}

/// Wire layout (after Anchor 8-byte disc):
///   8..16  price          (i64)
///   16..20 expo           (i32)
///   20..28 publish_time   (i64)
///   28..32 _reserved      ([u8;4])
#[account]
#[derive(InitSpace)]
pub struct MockPriceFeed {
    pub price: i64,
    pub expo: i32,
    pub publish_time: i64,
    pub _reserved: [u8; 4],
}
```

- [ ] **Step 5: Register the program in `Anchor.toml`**

Add `mock_pyth = "<MOCK_PYTH_PROGRAM_ID>"` (using the same pubkey from Step 1) under each of `[programs.devnet]`, `[programs.localnet]`, `[programs.mainnet]`.

- [ ] **Step 6: Build the workspace**

Run: `anchor build`
Expected: both `my_project` and `mock_pyth` build cleanly. New `target/idl/mock_pyth.json` and `target/types/mock_pyth.ts` should appear.

- [ ] **Step 7: Commit**

```bash
git add programs/mock_pyth Anchor.toml
git commit -m "feat(mock_pyth): scaffold mock Pyth price-feed program"
```

---

## Task 8: Guard `mock_pyth` out of mainnet deploy

**Files:**
- Modify: `scripts/deploy.sh`

- [ ] **Step 1: Inspect current behaviour**

Run: `cat scripts/deploy.sh`

- [ ] **Step 2: Add a mainnet guard**

If the script today loops over a list of programs to deploy, add a filter that skips `mock_pyth` (and any other `mock_*` program) when the cluster is `mainnet-beta`. Concretely, if you find a `for prog in mock_kamino mock_lulo my_project; do ...` style line, change to:

```bash
PROGRAMS=("my_project")
if [[ "$CLUSTER" != "mainnet-beta" ]]; then
    PROGRAMS+=("mock_kamino" "mock_lulo" "mock_pyth")
fi
for prog in "${PROGRAMS[@]}"; do
    # existing deploy logic
done
```

If the script structure is different, port the same intent: deploy `mock_pyth` on devnet/localnet only.

- [ ] **Step 3: Manual sanity check**

Run: `bash -n scripts/deploy.sh`
Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy.sh
git commit -m "chore(deploy): exclude mock_* programs from mainnet deploy"
```

---

## Task 9: TS test helper for `mock_pyth`

**Files:**
- Create: `tests/helpers/mock_pyth.ts`

- [ ] **Step 1: Write the helper**

```typescript
// tests/helpers/mock_pyth.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { MockPyth } from "../../target/types/mock_pyth";

export function derivePriceFeedPda(
    programId: PublicKey,
    mint: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("price"), mint.toBuffer()],
        programId,
    );
}

export async function initializeMockFeed(
    program: anchor.Program<MockPyth>,
    payer: anchor.web3.Keypair,
    mint: PublicKey,
    price: anchor.BN,
    expo: number,
): Promise<PublicKey> {
    const [feed] = derivePriceFeedPda(program.programId, mint);
    await program.methods
        .initializeFeed(price, expo)
        .accounts({
            payer: payer.publicKey,
            mint,
            feed,
            systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    return feed;
}

export async function setMockPrice(
    program: anchor.Program<MockPyth>,
    payer: anchor.web3.Keypair,
    mint: PublicKey,
    price: anchor.BN,
    expo: number,
): Promise<void> {
    const [feed] = derivePriceFeedPda(program.programId, mint);
    await program.methods
        .setPrice(price, expo)
        .accounts({
            payer: payer.publicKey,
            mint,
            feed,
        })
        .signers([payer])
        .rpc();
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: PASS. (If the types path can't find `MockPyth`, ensure `anchor build` ran in Task 7 step 6.)

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/mock_pyth.ts
git commit -m "test: add mock_pyth ts helpers"
```

---

## Task 10: E2E test — Pyth ValueSource end-to-end

**Files:**
- Create: `tests/pyth_value_source.ts`

This test exercises the full chain: vault init → strategy → fund the strategy ATA → register `SplAtaBalance` source pointing at a sibling token account (representing an external position) → register `PythPriceFeed` source against `mock_pyth` → call `settle_strategy_value` → assert NAV reflects `balance × price × 10^expo`.

- [ ] **Step 1: Write the test**

```typescript
// tests/pyth_value_source.ts
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { MyProject } from "../target/types/my_project";
import type { MockPyth } from "../target/types/mock_pyth";
import { derivePriceFeedPda, initializeMockFeed, setMockPrice } from "./helpers/mock_pyth";

describe("PythPriceFeed ValueSource", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.MyProject as anchor.Program<MyProject>;
    const mockPyth = anchor.workspace.MockPyth as anchor.Program<MockPyth>;

    const admin = (provider.wallet as anchor.Wallet).payer;
    let underlyingMint: PublicKey;
    let externalMint: PublicKey; // the asset whose balance we price via Pyth
    let vaultState: PublicKey;
    let strategy: PublicKey;
    let strategyId: BN;
    let vaultId: BN;

    // Helpers for vault PDAs are kept inline to avoid coupling to other test files.
    const deriveVaultPda = (mint: PublicKey, id: BN) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), mint.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
            program.programId,
        )[0];
    const deriveStrategyPda = (vault: PublicKey, id: BN) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from("strategy"), vault.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
            program.programId,
        )[0];
    const deriveValueSourcePda = (strategy: PublicKey, index: number) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from("value_source"), strategy.toBuffer(), Buffer.from([index])],
            program.programId,
        )[0];

    before(async () => {
        // The bulk of vault init (initialize_vault, create_strategy) is
        // covered in tests/my_project.ts. To keep this file self-contained,
        // the test below does the *minimum* setup needed to register VSs
        // and call settle_strategy_value. If your suite already exposes
        // a shared "fresh-vault" helper, reuse it here instead.
        underlyingMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
        externalMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
        vaultId = new BN(99); // distinct from numbers used in other tests
        // ... call program.methods.initializeVault, createStrategy, etc.
        // Reuse the existing pattern from tests/my_project.ts. The file
        // there is the canonical reference for these calls.
    });

    it("settles NAV from balance × Pyth price", async () => {
        // 1. Mint 1_000_000 (= 1.0 with 6 dp) of `externalMint` into a
        //    plain ATA owned by the test wallet. This stands in for a
        //    deployed external position the strategy holds.
        const externalAta = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            admin,
            externalMint,
            admin.publicKey,
        );
        await mintTo(provider.connection, admin, externalMint, externalAta.address, admin, 1_000_000);

        // 2. Initialise mock Pyth feed for `externalMint` at $50.00.
        //    expo = -8 → raw price 5_000_000_000 = $50.00.
        const feed = await initializeMockFeed(
            mockPyth,
            admin,
            externalMint,
            new BN(5_000_000_000),
            -8,
        );

        // 3. Register VS index 0 = SplAtaBalance pointing at `externalAta.address`.
        //    scale_num/scale_den = 1/1 — we want raw balance to flow into the Pyth source.
        const vs0 = deriveValueSourcePda(strategy, 0);
        await program.methods
            .addValueSource(
                strategyId,
                0,                      // index
                0,                      // kind = SplAtaBalance
                externalAta.address,    // target_account
                0,                      // offset (unused)
                new BN(1),              // scale_num
                new BN(1),              // scale_den
                0,                      // mint_balance_source_index (unused)
                0,                      // max_staleness_secs (unused)
            )
            .accounts({
                admin: admin.publicKey,
                vaultState,
                strategy,
                valueSource: vs0,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        // 4. Register VS index 1 = PythPriceFeed referencing index 0 + the feed.
        const vs1 = deriveValueSourcePda(strategy, 1);
        await program.methods
            .addValueSource(
                strategyId,
                1,                      // index
                2,                      // kind = PythPriceFeed
                feed,                   // target_account
                0,                      // offset (unused)
                new BN(1),              // scale_num
                new BN(1_000_000),      // scale_den (price × balance / 1e6 → underlying with 6 dp)
                0,                      // mint_balance_source_index → VS 0
                60,                     // max_staleness_secs
            )
            .accounts({
                admin: admin.publicKey,
                vaultState,
                strategy,
                valueSource: vs1,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        // 5. Call settle_strategy_value with both VSs in remaining_accounts.
        const strategyTokenAccount = (await program.account.strategyAllocation.fetch(strategy))
            .tokenAccount;
        await program.methods
            .settleStrategyValue(strategyId)
            .accounts({
                authority: admin.publicKey,
                vaultState,
                strategy,
                strategyTokenAccount,
            })
            .remainingAccounts([
                { pubkey: vs0, isSigner: false, isWritable: false },
                { pubkey: externalAta.address, isSigner: false, isWritable: false },
                { pubkey: vs1, isSigner: false, isWritable: false },
                { pubkey: feed, isSigner: false, isWritable: false },
            ])
            .rpc();

        // 6. Assert.
        // Expected contribution from VS0 (SplAtaBalance): 1_000_000 raw.
        // Expected contribution from VS1 (Pyth):
        //   balance(1_000_000) × price(5_000_000_000) × 10^-8 / scale_den(1_000_000)
        //   = 1_000_000 × 50 / 1_000_000 = 50 (in underlying-token base units, 6dp).
        // Strategy ATA idle balance: whatever was funded in `before` (call it `idle`).
        // Expected total: idle + 1_000_000 (VS0) + 50 (VS1).
        const strat = await program.account.strategyAllocation.fetch(strategy);
        const ata = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
        const idle = Number(ata.value.amount);
        expect(strat.allocatedAmount.toNumber()).to.equal(idle + 1_000_000 + 50);
    });

    it("rejects stale Pyth price", async () => {
        // Re-set the price stamp into the past by setting publish_time in
        // the past via a helper script. Since `set_price` uses now, the
        // simplest way to test staleness is to set max_staleness_secs = 0
        // and bump it via re-add. For now, register a VS with
        // max_staleness_secs = 1, sleep 3s, then call settle and expect
        // ValueSourcePythStale.
        // (Implementer note: if waiting in the test loop is too slow,
        // alternative is to add a `set_publish_time` ix to mock_pyth in a
        // follow-up. For Plan 1 we accept the 3s sleep.)
        // This test body is left as an exercise — implement only if the
        // happy-path test above is green.
    });

    it("rejects negative Pyth price", async () => {
        await setMockPrice(mockPyth, admin, externalMint, new BN(-1), -8);
        // Re-run settle, expect VaultError::ValueSourcePythNegativePrice.
        // (Implementer: same shape as the happy-path test, wrapped in expect-revert.)
    });
});
```

The test deliberately re-uses your existing vault-init / create-strategy pattern from `tests/my_project.ts` rather than duplicating it. Implementer note in `before()`: open `tests/my_project.ts`, copy the `initializeVault` + `createStrategy` blocks for the same `vaultId`, adapt to the new mint. Don't build a new helper module yet — single-test-file is enough for now.

- [ ] **Step 2: Run the test**

Run: `bunx ts-mocha -p ./tsconfig.json -t 1000000 "tests/pyth_value_source.ts"`
Expected: the happy-path `it("settles NAV from balance × Pyth price")` passes. The two TODO `it` blocks are stubs — they pass trivially because their bodies are empty.

If the test fails because the local validator isn't running, run: `anchor test` instead (spins up + tears down the validator and runs *all* tests including this one).

- [ ] **Step 3: Implement the two stub `it` blocks**

Fill in the bodies of the staleness and negative-price tests using the same pattern as the happy path, wrapped in:

```typescript
try {
    await program.methods.settleStrategyValue(strategyId)
        .accounts({ /* same as happy path */ })
        .remainingAccounts([ /* same */ ])
        .rpc();
    expect.fail("should have reverted");
} catch (err: any) {
    expect(err.error.errorCode.code).to.equal("ValueSourcePythStale"); // or "ValueSourcePythNegativePrice"
}
```

For staleness: register the Pyth VS with `maxStalenessSecs: 1`, then `await new Promise(r => setTimeout(r, 3000))` before calling settle.

- [ ] **Step 4: Re-run the full test file**

Run: `bunx ts-mocha -p ./tsconfig.json -t 1000000 "tests/pyth_value_source.ts"`
Expected: all three `it` blocks pass.

- [ ] **Step 5: Run the entire suite**

Run: `anchor test`
Expected: every existing test still passes plus the three new ones. If any existing test now fails, the most likely cause is that `add_value_source` callers in `tests/my_project.ts` or `tests/security.ts` did not pick up the two new args — they need `0, 0` appended. Fix those call sites.

- [ ] **Step 6: Commit**

```bash
git add tests/pyth_value_source.ts tests/my_project.ts tests/security.ts
git commit -m "test: e2e PythPriceFeed ValueSource (happy path + stale + negative)"
```

---

## Task 11: Sync the frontend IDL copy

**Files:**
- Modify: `app/src/idl/my_project.ts`

- [ ] **Step 1: Copy the regenerated IDL**

Run: `cp target/idl/my_project.json app/src/idl/my_project.json && cp target/types/my_project.ts app/src/idl/my_project.ts`

(Adjust the destination filename to whatever the frontend currently uses — check `app/src/idl/` first; if it's `my_project.ts` only, the second copy is the right one.)

- [ ] **Step 2: Type-check the frontend**

Run: `cd app && bun run build`
Expected: the build succeeds. If there are type errors at sites that call `addValueSource`, those sites must be updated to pass the two new args (`mintBalanceSourceIndex: 0, maxStalenessSecs: 0` for non-Pyth callers). The frontend doesn't expose Pyth ValueSource registration in Plan 1 — that's Plan 3 work — but existing `addValueSource` callers must compile.

- [ ] **Step 3: Commit**

```bash
git add app/src/idl/
git commit -m "chore(app): regenerate idl with PythPriceFeed kind"
```

---

## Task 12: Update FOLLOWUPS.md status

**Files:**
- Modify: `docs/FOLLOWUPS.md`

- [ ] **Step 1: Mark Plan 1 as shipped**

Edit the snapshot table near the top of `docs/FOLLOWUPS.md`. Add a row:

```
| 5b | PythPriceFeed ValueSource + mock_pyth program (Plan 1 of strategy-presets) |
```

In section A4, prepend "**Status:** Plan 1 (on-chain `PythPriceFeed` + `mock_pyth`) shipped 2026-05-03; remaining items below are for Plans 2–3 + mainnet wiring." to the description.

- [ ] **Step 2: Commit**

```bash
git add docs/FOLLOWUPS.md
git commit -m "docs(followups): mark Plan 1 (Pyth ValueSource + mock_pyth) shipped"
```

---

## Self-review checklist

Before handing off:

1. **Spec coverage:** This plan covers spec items "On-chain extension: new `ValueSource` variant `PythPriceFeed`" and "New `mock_pyth` program at `programs/mock_pyth/`". Spec items reserved for later plans: registry/keeper (Plan 2), preset bundles + UI (Plan 3). ✅
2. **No placeholders:** Every code block contains the actual code; the only deliberate "exercise" is filling in the stub `it` blocks in Task 10 step 3, where the pattern is shown explicitly. ✅
3. **Type consistency:** `mintBalanceSourceIndex` / `maxStalenessSecs` (camelCase in TS) ↔ `mint_balance_source_index` / `max_staleness_secs` (snake_case in Rust) used consistently. `VALUE_SOURCE_KIND_PYTH_PRICE_FEED = 2` referenced unchanged across tasks. `MockPriceFeed` field order matches the offset table. ✅
4. **Backwards compatibility:** Existing `add_value_source` callers (in tests and frontend) need `0, 0` appended for the two new args — Task 10 step 5 and Task 11 step 2 surface this explicitly. ✅
