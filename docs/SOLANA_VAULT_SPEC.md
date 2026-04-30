# Erebor — Solana Build Spec

> **Purpose.** Translate the EVM vault architecture
> ([OVERVIEW.md](OVERVIEW.md), *EVM_VAULT_SPEC.md (not present in this repo)*)
> into a faithful Anchor / SPL implementation that preserves the same
> security invariants:
> 1. Each strategy lives in its **own sandboxed environment** (its own
>    set of PDAs and its own SPL token vaults).
> 2. The AI agent (delegate) cannot move funds outside an
>    admin-curated whitelist of `(program_id, instruction_discriminator)`
>    pairs scoped to its sandbox.
> 3. Every privileged action validates **anti-theft**: the delegate's
>    asset balance must not increase as a result of the call, and any
>    admin-required recipient account must equal the strategy's vault
>    PDA.
> 4. NAV is read live: `vault.total_assets() = idle + Σ strategy.total_value()`,
>    where each strategy sums its idle balance + a list of value-source
>    CPI reads.
>
> This document is the analogue of *EVM_VAULT_SPEC.md (not present in this repo)*:
> a single source of truth for engineers building Erebor on Solana.

---

## 1. Why a different design

EVM gives us four primitives we lean on hard:

- `delegatecall` + EIP-1167 minimal proxies → cheap per-strategy cloning.
- `CALL` to arbitrary contract addresses with arbitrary calldata, with
  reverts that bubble up cleanly.
- A single `msg.sender` per call frame → easy "anti-theft snapshot".
- `staticcall` to read uint256 from any contract → uniform value sources.

Solana doesn't have any of those, but it gives us something stronger:
**every account a transaction touches must be enumerated up front**, and
**instruction introspection** lets a program see every other instruction
in the same transaction. We use both to get an even tighter sandbox than
the EVM version: instead of having to *trust the call and verify after*,
the strategy sandbox can **structurally guarantee** that no unrelated
SPL transfer signed by its delegate is happening in the same
transaction.

---

## Status — what's implemented today

> ⚠ **This spec is partly aspirational.** The repo at
> [programs/my_project/src/lib.rs](programs/my_project/src/lib.rs)
> implements roughly §17 step 1 ("skeleton + share math") plus a
> slice of step 2 ("strategy lifecycle"); the agent layer
> (`execute_action`, allowed actions, value sources, anti-theft,
> instruction introspection) is **not yet built**. The gap list with
> file references is in [MISMATCHES.md](MISMATCHES.md). When the spec
> and the code disagree, trust the code.

Status legend: ✅ shipped · 🟡 partial / divergent · ❌ missing · ➕ extra (not in spec).

| Surface                                                          | Status | Notes                                                                                                          |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| **§5 Account layout — `vault_state` PDA, share mint, reserve ATA** | ✅      | Seeds match. Single-instance per `(asset_mint, vault_id)`.                                                     |
| **§5 Per-strategy `strategy_authority` signer PDA**              | ❌      | The current code uses `vault_state` itself as the universal CPI signer; per-strategy isolation is collapsed.    |
| **§5 Separate `vault_authority` signer PDA**                     | ❌      | Same — no separate signer PDA for vault-side moves.                                                            |
| **§5 `allowed_action` PDA per `(strategy, target_program, disc)`** | ❌      |                                                                                                                |
| **§5 `value_source` PDA**                                        | ❌      |                                                                                                                |
| **§6 `VaultState.paused`**                                       | ✅      | Added in this round. Toggled by `set_paused`. `_reserved` slack still ❌.                                       |
| **§6 `Strategy` fields (action_count, value_source_count, deposit_config, withdraw_config)** | ❌      | Code's `StrategyAllocation` has only `vault, strategy_id, delegate, allocated_amount, token_account, is_active, target_weight_bps, bump`. |
| **§6 `AllowedAction` / `ValueSource` / `AutoActionConfig`**      | ❌      |                                                                                                                |
| **§7.1 `initialize_vault`**                                      | ✅      | Caller becomes admin and authority; spec lets them differ at init.                                             |
| **§7.2 `deposit` (auto-rebalance into strategies)**              | 🟡     | Implemented as reserve-only deposit. **Auto-fan-out is missing** (spec §10).                                    |
| **§7.3 `withdraw` (auto-pull from strategies)**                  | 🟡     | Reverts `InsufficientReserve` instead of pulling from strategies in id order.                                   |
| **§7.4 `create_strategy`**                                       | ✅      | Approves delegate with `u64::MAX`. Strategy starts `active = true, weight_bps = 0`.                            |
| **§7.5 `set_strategy_weight`**                                   | ✅      | Caps at 10 000 bps per strategy. Sum cap intentionally not enforced.                                            |
| **§7.5 `deactivate_strategy`**                                   | ✅      | Now requires `allocated_amount == 0 && strategy_token_account.amount == 0` upfront (revert: `StrategyStillHoldsFunds`). Permanent ✅. Caller drains via `deallocate_from_strategy` first. |
| **`set_paused` (admin-only)**                                    | ✅      | New in this round. Toggles `vault_state.paused`. Gates `deposit`, `allocate_to_strategy`, `rebalance_strategy`. |
| **§7.5 `set_delegate`**                                          | 🟡     | Spelled `update_strategy_delegate` in code. Same semantics.                                                    |
| **§7.5 `add_allowed_action` / `remove_allowed_action`**          | ❌      |                                                                                                                |
| **§7.5 `set_deposit_config` / `set_withdraw_config`**            | ❌      |                                                                                                                |
| **§7.5 `add_value_source` / `remove_value_source`**              | ❌      |                                                                                                                |
| **§7.6 `rebalance(strategy_id, delta: i64)` (authority-only, signed delta)** | 🟡     | Code's `rebalance_strategy` is **permissionless** and **weight-driven**, not authority-only with explicit ±delta. |
| **§7.7 `execute_action` (the load-bearing instruction)**         | ❌      | Whole validation chain absent — caller / target guards / allowed-action / recipient / anti-theft / introspection / `invoke_signed` / post-check / event emission. |
| **§7.8 `push_funds` / `pull_funds` (internal helpers)**          | 🟡     | Exposed as **public** instructions `allocate_to_strategy` / `deallocate_from_strategy`. Spec wants them internal. |
| **§8 `compute_total_assets` (on-chain view)**                    | ❌      | Off-chain reads + a custom `report_yield` instruction stand in.                                                |
| **§8 NAV via value sources**                                     | ❌      | Yield surfaces only via `report_yield(strategy)` — see [MISMATCHES.md §2.2](MISMATCHES.md).                     |
| **§9 `VIRTUAL_SHARES = 1_000_000` offset**                       | ❌      | First-deposit math is `amount * supply / total_deposited`. Inflation attack unmitigated.                       |
| **§10 Auto-rebalance on deposit/withdraw**                       | ❌      | See §7.2/§7.3 above.                                                                                            |
| **§11 Custom errors**                                            | 🟡     | 11 of ~25 variants exist (the original 9 plus `VaultPaused`, `StrategyStillHoldsFunds`). All anti-theft / introspection / value-source errors absent. |
| **§11 `#[event]` emissions**                                     | 🟡     | 14 events emit today: `VaultInitialized`, `Deposited`, `Withdrawn`, `StrategyCreated`, `StrategyAllocated`, `StrategyDeallocated`, `StrategyWeightSet`, `DelegateUpdated`, `StrategyDeactivated`, `YieldReported`, `Rebalanced`, `AdminTransferred`, `AuthoritySet`, `PausedToggled`. Allowed-action / value-source events deferred until those features land. |
| **§13 Token-2022 transfer-hook rejection**                       | ❌      | Hook-equipped asset mints silently accepted at vault init.                                                     |
| **§14 Frontend (vault adapter, deposit/withdraw, allocation pie, admin guard, registry)** | 🟡     | Build-time vault registry + all-or-nothing `AdminGuard` shipped. Allowed-action / config / value-source editors and activity feed are blocked on the program work above. See [FRONTEND.md](FRONTEND.md). |
| **§15 Pause flag**                                               | ✅      | Implemented (see `set_paused` row above).                                                                      |
| **§15 Circuit breakers / fees / token allowlist / reactivation / yield drippers / VaultFactory** | ❌      | Still deferred.                                                                                                |
| **`report_yield`**                                               | ➕     | Not in this spec. Authority-only; reads strategy ATA balance, computes `actual - allocated_amount`, increments `total_deposited`. The current yield surfacing path. |

The §16 acceptance-criteria checklist still holds; treat it as the
production-deploy bar, not as a description of current state.

---

## 2. Naming and scope

| EVM term                     | Solana equivalent (in this spec)                                      |
| ---------------------------- | --------------------------------------------------------------------- |
| Vault contract               | `vault` PDA + a global `vault_state` account                          |
| Strategy clone               | `strategy` PDA per id (`seeds = [b"strategy", vault.key().as_ref(), &id.to_le_bytes()]`) |
| Vault asset (ERC-20)         | SPL **mint** of the underlying asset (e.g. USDC)                      |
| Vault shares (ERC-4626)      | SPL **mint** of the share token, mint authority = vault PDA           |
| Idle vault balance           | Token account `vault_idle_ata` (PDA-owned)                            |
| Strategy idle balance        | Token account `strategy_idle_ata` (PDA-owned, per strategy)            |
| `allowedActions` mapping     | One PDA per `(strategy, target_program, discriminator)` triple        |
| Value source list            | `Vec<ValueSource>` inside the strategy account (or one PDA per source for size scaling) |
| Deposit / withdraw config    | `auto_action_config` field inside the strategy account                |
| Delegate (AI agent EOA)      | `Pubkey` of an off-chain keypair stored on the strategy               |
| Authority (rebalancer)       | `Pubkey` stored on the vault — has `rebalance` + can co-sign delegate calls |
| `_decimalsOffset = 6`        | Vault math uses Mulberry-style `virtual_shares` constant — see §10    |
| Anti-theft snapshot          | Pre/post `delegate_ata.amount` check inside `execute_action`          |
| `recipientOffset` calldata   | "expected_recipient" field in the whitelist PDA, validated against an account index in the relayed instruction |

Anchor 0.30+ is assumed. `solana-program 1.18+`. Token-2022 (`spl-token-2022`)
optional but recommended for transfer hooks (see §13).

---

## 3. Roles

| Role          | On-chain representation                                                                                | Permissions                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Admin**     | `vault_state.admin: Pubkey`                                                                            | `create_strategy`, `set_strategy_weight`, `deactivate_strategy`, `add_allowed_action`, `set_deposit_config`, `set_withdraw_config`, `add_value_source`, `set_delegate`, `transfer_admin`, `set_authority` |
| **Authority** | `vault_state.authority: Pubkey`                                                                        | `rebalance(strategy_id, signed_delta)`, may co-sign `execute_action` as an override          |
| **Delegate**  | `strategy.delegate: Pubkey` (per-strategy, **not** a global role)                                      | `execute_action` on its own strategy only                                                    |
| **User**      | Any wallet                                                                                             | `deposit`, `mint`, `withdraw`, `redeem` against the vault's share mint                       |

There is no `AccessControl`-style role mapping; admin and authority are
single keys (or programs / Squads multisigs) stored on the vault state
account. Adding a multisig is a deployment choice, not a contract
change.

---

## 4. Program structure

One Anchor program: `agent_vault`. Recommended Cargo layout:

```
agent-vault-solana/
├── Anchor.toml
├── Cargo.toml
├── programs/
│   └── agent_vault/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                 # program entrypoint + instruction dispatch
│           ├── state.rs               # Vault, Strategy, AllowedAction, ValueSource, AutoActionConfig
│           ├── errors.rs              # custom errors, mirrors EVM custom errors 1:1
│           ├── events.rs              # #[event] structs
│           ├── math.rs                # ERC-4626-style share math with virtual_shares offset
│           ├── seeds.rs               # PDA seed helpers
│           ├── instructions/
│           │   ├── initialize_vault.rs
│           │   ├── transfer_admin.rs
│           │   ├── set_authority.rs
│           │   ├── deposit.rs
│           │   ├── withdraw.rs
│           │   ├── create_strategy.rs
│           │   ├── set_strategy_weight.rs
│           │   ├── deactivate_strategy.rs
│           │   ├── set_delegate.rs
│           │   ├── add_allowed_action.rs
│           │   ├── remove_allowed_action.rs
│           │   ├── set_deposit_config.rs
│           │   ├── set_withdraw_config.rs
│           │   ├── add_value_source.rs
│           │   ├── remove_value_source.rs
│           │   ├── push_funds.rs
│           │   ├── pull_funds.rs
│           │   ├── rebalance.rs
│           │   └── execute_action.rs  # ← the "blast radius" instruction
│           └── value_sources/
│               └── mango_v4_loop.rs   # optional helper accounts (cf. AaveV3LoopValue.sol)
├── tests/
│   ├── shared/
│   │   ├── fixtures.rs
│   │   └── mock_protocol.rs
│   ├── deposit.rs
│   ├── withdraw.rs
│   ├── rebalance.rs
│   ├── strategy_lifecycle.rs
│   ├── action_whitelist.rs
│   ├── value_sources.rs
│   ├── execute_action_anti_theft.rs
│   └── execute_action_introspection.rs
├── client-ts/                          # @solana/web3.js + Anchor IDL TS bindings
│   ├── src/
│   └── package.json
└── README.md
```

> **Why one program, not one per strategy.** EVM uses per-strategy
> contracts because an EVM contract is the unit of address isolation.
> On Solana, *the PDA is the unit of isolation*; the program is the
> code. One program with N strategy PDAs gives the same isolation
> guarantee at a fraction of the deployment cost.

---

## 5. Account layout (PDAs)

All PDAs are derived from seeds we control. Bump seeds are stored on the
parent account so dependent instructions don't have to find_program_address
at runtime.

| Account                              | Seeds (canonical)                                                              | Owned by                | Notes                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `vault_state`                        | `[b"vault", asset_mint.key().as_ref()]`                                        | `agent_vault` program   | Single instance per `(asset_mint)`                                               |
| `vault_authority` (signer PDA)       | `[b"vault-auth", vault_state.key().as_ref()]`                                  | `agent_vault` program   | The PDA that signs all CPI fund transfers from `vault_idle_ata`                  |
| `share_mint`                         | n/a (regular SPL mint, mint authority = `vault_authority` PDA)                 | SPL Token / Token-2022  | Created at vault init; mint and freeze authorities = `vault_authority`           |
| `vault_idle_ata`                     | ATA(`asset_mint`, `vault_authority`)                                           | SPL Token               | Vault's idle balance                                                             |
| `strategy`                           | `[b"strategy", vault_state.key().as_ref(), &id.to_le_bytes()]`                 | `agent_vault` program   | One per strategy id; stores config + value-source list                           |
| `strategy_authority` (signer PDA)    | `[b"strategy-auth", strategy.key().as_ref()]`                                  | `agent_vault` program   | The PDA that signs CPI from the strategy (e.g. `mango.deposit`)                  |
| `strategy_idle_ata`                  | ATA(`asset_mint`, `strategy_authority`)                                        | SPL Token               | Strategy's idle balance                                                          |
| `allowed_action`                     | `[b"allowed-action", strategy.key().as_ref(), target_program.as_ref(), &disc]` | `agent_vault` program   | One PDA per whitelisted action; `disc` is the 8-byte instruction discriminator   |
| `value_source`                       | `[b"value-source", strategy.key().as_ref(), &source_index.to_le_bytes()]`      | `agent_vault` program   | Optional — see §7.4                                                              |
| `user_share_ata`                     | ATA(`share_mint`, user)                                                        | SPL Token               | Per-user; init-on-first-deposit                                                  |
| `position_token_ata` (per protocol)  | ATA(`atoken_mint`, `strategy_authority`)                                       | SPL Token               | E.g. Marginfi shares accrue here; never to the delegate                          |

The `vault_authority` and `strategy_authority` PDAs are **the only
signers** for fund-moving CPI calls. Delegates *never* sign SPL
transfers; they sign program calls into `agent_vault` which then signs
the inner CPIs as the strategy PDA.

---

## 6. State accounts

```rust
// state.rs

#[account]
pub struct VaultState {
    pub bump: u8,
    pub authority_bump: u8,             // bump for the vault_authority PDA
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub idle_ata: Pubkey,               // ATA(asset_mint, vault_authority)
    pub admin: Pubkey,
    pub authority: Pubkey,              // analogue of AUTHORITY_ROLE
    pub strategy_count: u32,
    pub paused: bool,                   // (deferred; see §15)
    pub _reserved: [u8; 64],            // reserve space for future fields without realloc
}

#[account]
pub struct Strategy {
    pub bump: u8,
    pub authority_bump: u8,             // bump for the strategy_authority PDA
    pub vault: Pubkey,                  // VaultState pubkey
    pub id: u32,
    pub delegate: Pubkey,
    pub idle_ata: Pubkey,               // ATA(asset_mint, strategy_authority)
    pub weight_bps: u16,                // 0–10_000
    pub active: bool,
    pub action_count: u64,              // monotonic counter for indexers
    pub value_source_count: u32,
    pub deposit_config: AutoActionConfig,
    pub withdraw_config: AutoActionConfig,
    pub _reserved: [u8; 64],
}

#[account]
pub struct AllowedAction {
    pub bump: u8,
    pub strategy: Pubkey,
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],         // first 8 bytes of the relayed instruction.data
    pub recipient_account_index: Option<u8>,
                                         // if Some(i), accounts[i] in the relayed
                                         // instruction must equal `expected_recipient`
    pub expected_recipient: Pubkey,     // typically strategy_authority or strategy_idle_ata
}

#[account]
pub struct ValueSource {
    pub bump: u8,
    pub strategy: Pubkey,
    pub index: u32,
    pub kind: ValueSourceKind,          // SplAtaBalance, MangoLoopHelper, …
    pub data: Vec<u8>,                  // kind-specific (e.g. ata pubkey, oracle pubkey, mints)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ValueSourceKind {
    /// Read `Account::unpack(reader_ata).amount` directly. `data` = ata pubkey.
    SplAtaBalance,
    /// Net leveraged-loop value via a helper. `data` = bincode of helper params.
    MangoLoopValue,
    /// Read a serialized u64 from a known offset in a known account. `data` = (account, offset).
    AccountU64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct AutoActionConfig {
    pub target_program: Pubkey,         // 0x0 means "no auto config"
    pub discriminator: [u8; 8],
    pub data_template: Vec<u8>,         // patched at amount_offset before invoke
    pub amount_offset: u16,             // index inside data_template where u64 amount lives
    pub account_indices_to_resolve: Vec<u8>,
                                         // indices into remaining_accounts for the inner CPI
}
```

`_reserved` bytes let us add fields without `realloc` migrations.
Anchor's `#[account]` does not permit adding fields after deploy without
either rent-paying realloc or upfront slack.

---

## 7. Instructions

Every instruction follows the same Anchor pattern: typed `#[derive(Accounts)]`
struct + a handler. Fund-moving instructions sign CPIs with the relevant
PDA's seeds (`vault_authority` for vault-side moves, `strategy_authority`
for strategy-side moves).

### 7.1 `initialize_vault`

Inputs: `admin: Pubkey`, `authority: Pubkey`, `asset_mint`, share-token
metadata (`name`, `symbol`).

Effects:
- Creates `vault_state` PDA seeded by `(b"vault", asset_mint)`.
- Creates `share_mint` with `mint_authority = freeze_authority = vault_authority` PDA.
- Creates `vault_idle_ata` = ATA(asset_mint, vault_authority).
- Stores admin + authority + bumps.
- Emits `VaultInitialized`.

Reverts: `ZeroAddress` (Pubkey::default()), `MintAlreadyExists`.

### 7.2 `deposit(amount: u64) → shares: u64`

Mirrors `Vault.deposit(assets, receiver)`.

Account list (key ones):
- `user` (signer, payer)
- `vault_state` (mut)
- `vault_authority` (PDA)
- `vault_idle_ata` (mut)
- `share_mint` (mut)
- `user_asset_ata` (mut, owner = user)
- `user_share_ata` (mut, init_if_needed = true)
- `token_program`
- `system_program`
- **Then for each active strategy** (passed via `remaining_accounts` in
  registration order): `strategy`, `strategy_authority`,
  `strategy_idle_ata`, plus accounts required by that strategy's
  `deposit_config` (resolved via `account_indices_to_resolve`).

Logic:
1. `nonReentrant` semantics via Anchor's reentrancy-by-construction
   (Solana's account locking already prevents the EVM reentrancy class;
   keep an explicit `processing` flag for cross-program callbacks if a
   protocol uses callbacks — currently none in scope).
2. Compute `shares = math::convert_to_shares(amount, totalAssets, totalSupply)`
   with the `virtual_shares` offset (see §10). Round in vault's favour.
3. CPI `token::transfer(user_asset_ata → vault_idle_ata, amount)`.
4. CPI `token::mint_to(share_mint → user_share_ata, shares)` signed by
   `vault_authority`.
5. Run `_auto_rebalance_in(amount)`:
   - For each active strategy in id order, transfer
     `share = amount * weight_bps / 10_000` from `vault_idle_ata` to
     `strategy_idle_ata`, then `push_funds_into_strategy(strategy, share)`
     via internal helper. If a deposit config is set, the helper builds
     a CPI `Instruction { program_id: cfg.target_program, data: patched, accounts: cfg.resolved }`,
     signed by `strategy_authority`.

Emits: `Deposited`, `FundsPushed` per strategy.

Reverts: `InsufficientLiquidity` (downstream protocol fail bubbles),
overflow on `weight_bps * amount`.

### 7.3 `withdraw(amount: u64) → shares_burned: u64`

Mirrors `Vault.withdraw(assets, receiver, owner)`.

Logic:
1. Compute `shares = math::convert_to_shares_round_up(amount, …)`.
2. If `vault_idle_ata.amount < amount`, run `_auto_pull_from_strategies(amount - idle)`.
   For each active strategy in id order: `pull_funds_into_vault(strategy, request)`.
   Each strategy first runs its `withdraw_config` (if set) via CPI
   signed by `strategy_authority`, then transfers up to `request` from
   `strategy_idle_ata` to `vault_idle_ata`.
3. CPI `token::burn(share_mint, user_share_ata, shares)`.
4. CPI `token::transfer(vault_idle_ata → user_asset_ata, amount)` signed by
   `vault_authority`.

Reverts: `InsufficientLiquidity`, `BalanceTooLow`.

### 7.4 `create_strategy(delegate: Pubkey)`

Admin-only. Allocates the next strategy id, derives its PDAs, creates
`strategy_idle_ata`, stores `delegate`. `weight_bps = 0`, `active = true`.

```rust
let id = vault_state.strategy_count;
vault_state.strategy_count = vault_state.strategy_count.checked_add(1).ok_or(IdOverflow)?;
let (_, strategy_bump) = Pubkey::find_program_address(
    &[b"strategy", vault_state.key().as_ref(), &id.to_le_bytes()],
    program_id,
);
strategy.bump = strategy_bump;
…
emit!(StrategyCreated { id, strategy: strategy.key(), delegate });
```

### 7.5 Per-strategy admin instructions

All gated by `require!(ctx.accounts.signer.key() == vault_state.admin, NotAdmin)`.

- `set_strategy_weight(strategy_id, weight_bps)` — `weight_bps ≤ 10_000`.
- `deactivate_strategy(strategy_id)` — requires `total_value(strategy) == 0`,
  flips `active = false`, sets `weight_bps = 0`. **Permanent.**
- `set_delegate(strategy_id, new_delegate)`.
- `add_allowed_action(strategy_id, target_program, discriminator,
  recipient_account_index, expected_recipient)` — creates the
  `allowed_action` PDA. Constraints: `target_program != system_program`,
  `target_program != token_program`, `target_program != agent_vault`,
  `target_program != vault_state` (sanity), and `expected_recipient`
  must be one of the strategy's PDAs / ATAs (validated by passing them
  as named accounts).
- `remove_allowed_action(strategy_id, target_program, discriminator)` —
  closes the PDA; reclaims rent to the admin.
- `set_deposit_config(strategy_id, config)` / `set_withdraw_config(...)`.
- `add_value_source(strategy_id, kind, data)` / `remove_value_source(strategy_id, index)`.

### 7.6 `rebalance(strategy_id, delta: i64) → actual: u64`

Authority-only. Same semantics as
`Vault.rebalance`:
- `delta > 0` → transfer `delta` from `vault_idle_ata` to
  `strategy_idle_ata` and call the strategy's `push_funds` helper.
- `delta < 0` → call the strategy's `pull_funds` helper for `-delta`.
- `delta == 0` → no-op.

Reverts: `InsufficientIdle` for positive delta, `InsufficientLiquidity`
for negative, `StrategyInactive`, `StrategyDoesNotExist`.

### 7.7 `execute_action(strategy_id)` — the blast-radius instruction

This is the Solana analogue of `Strategy.executeAction(target, data)`,
and the most subtle to get right.

**Inputs:**

```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ExecuteActionArgs {
    pub target_program: Pubkey,
    pub discriminator: [u8; 8],
    pub data_after_disc: Vec<u8>,           // the relayed instruction's data, minus the 8-byte disc
    pub account_metas: Vec<RelayedAccountMeta>,
                                             // shape of the relayed instruction's account list,
                                             // referencing indices into remaining_accounts
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RelayedAccountMeta {
    pub remaining_account_index: u8,
    pub is_signer: bool,
    pub is_writable: bool,
}
```

**Accounts:**

- `delegate_or_authority` (signer): one of `strategy.delegate` or
  `vault_state.authority`.
- `vault_state`
- `strategy` (mut — for `action_count` increment)
- `strategy_authority` (PDA, signer for the inner CPI)
- `allowed_action` (PDA seeded by `(strategy, target_program, discriminator)`).
  Its mere presence means the action is whitelisted. If it doesn't
  exist, Anchor's PDA derivation will fail loudly.
- `delegate_asset_ata` (read-only — for the anti-theft snapshot)
- `instructions_sysvar` (`Sysvar1nstructions1111111111111111111111111`)
- `remaining_accounts`: every account the relayed instruction needs.

**Validation chain (do not reorder):**

1. `require!(signer == strategy.delegate || signer == vault_state.authority, NotDelegateNorAuthority)`.
2. `require!(strategy.active, StrategyInactive)`.
3. `require!(target_program != asset_mint && != strategy_authority &&
   != strategy_idle_ata && != vault_authority && != vault_idle_ata &&
   != share_mint && != program_id, TargetGuarded)`.
4. `require!(allowed_action.target_program == target_program &&
   allowed_action.discriminator == discriminator, ActionNotAllowed)`.
5. **Recipient check.** If
   `allowed_action.recipient_account_index.is_some()`, look up the
   `RelayedAccountMeta` at that index and require its
   `remaining_accounts[meta.remaining_account_index].key() == allowed_action.expected_recipient`.
6. **Anti-theft snapshot.** Read `delegate_asset_ata.amount` (deserialise
   the SPL Token account via `TokenAccount::try_deserialize`). Save as
   `before`.
7. **Instruction introspection.** Iterate the
   `instructions_sysvar` for every other instruction in the same
   transaction. For each one: if its `program_id == token_program`
   *and* its `accounts[3].key()` (Token's authority slot for `transfer`
   / `transferChecked`) `== strategy.delegate`, **revert
   `DelegateSignedSplTransferInTx`**. Optional but strongly recommended:
   also reject any other instruction whose accounts include
   `strategy_idle_ata` or any of the strategy's position ATAs unless its
   `program_id == agent_vault`. This makes "trick the delegate into
   wrapping a hostile transfer in the same tx" structurally impossible.
8. Build the relayed `Instruction` by assembling:
   - `program_id = target_program`
   - `data = [discriminator, data_after_disc].concat()`
   - `accounts = account_metas.iter().map(|m| AccountMeta { pubkey:
     remaining_accounts[m.remaining_account_index].key(), is_signer:
     m.is_signer, is_writable: m.is_writable }).collect()`
9. CPI `invoke_signed(&ix, &remaining_accounts, &[strategy_authority_seeds])`.
   The `strategy_authority` PDA signs the inner call. Bubble up errors
   as `CallFailed { code }`.
10. **Anti-theft re-read.** Reload `delegate_asset_ata`, take `after`,
    require `after <= before` (`AntiTheft { before, after }`).
11. `strategy.action_count = strategy.action_count.checked_add(1).ok_or(Overflow)?`.
12. Emit `ActionExecuted { target_program, discriminator, data_hash }`.

**Why introspection matters more on Solana than EVM.** EVM's anti-theft
check is enough because every transfer requires *the token contract* to
debit `msg.sender`, and `msg.sender` is the strategy. On Solana the
delegate signs the outer transaction, so without introspection a hostile
relayed program could trick the same transaction into bundling an SPL
transfer signed by the delegate against the *delegate's own* token
account. The introspection check shuts that down.

### 7.8 `push_funds` / `pull_funds`

Internal program helpers — not direct entrypoints, called from
`deposit` / `withdraw` / `rebalance`. Same semantics as the EVM
`Strategy.pushFunds` / `pullFunds`:

- `push_funds`: assumes the SPL transfer to `strategy_idle_ata` has
  already happened in the same instruction. If `strategy.deposit_config.target_program != Pubkey::default()`,
  build the templated CPI by patching the amount at `amount_offset`
  inside `data_template`, then `invoke_signed` with `strategy_authority`.
- `pull_funds`: if `strategy_idle_ata.amount < amount` and a withdraw
  config is set, run it (CPI to e.g. Marginfi withdraw) then transfer
  `min(idle, amount)` from `strategy_idle_ata` to `vault_idle_ata`.

---

## 8. Vault NAV — `total_value` view

Solana programs cannot return values from instructions in the EVM sense.
Two practical patterns:

1. **Off-chain reads.** Index every state-mutating event and read account
   balances directly from the client (`@solana/web3.js`'s
   `getMultipleAccounts`). NAV is computed off-chain. This is how the
   frontend should work by default.
2. **On-chain `compute_total_assets` instruction.** A view-style
   instruction that takes every active strategy + every value-source
   account in `remaining_accounts`, sums them, and writes the result to
   a small "scratch" PDA the caller passes. Cheap enough for keepers
   needing NAV before signing a tx.

Each `value_source` is resolved per `ValueSourceKind`:

```rust
fn resolve_value_source(src: &ValueSource, accounts: &[AccountInfo]) -> Result<u64> {
    match src.kind {
        ValueSourceKind::SplAtaBalance => {
            let ata_pubkey = Pubkey::try_from_slice(&src.data)?;
            let ata_account = accounts.iter().find(|a| a.key() == &ata_pubkey)
                .ok_or(MissingValueSourceAccount)?;
            let token_account = TokenAccount::try_deserialize(&mut ata_account.data.borrow().as_ref())?;
            Ok(token_account.amount)
        }
        ValueSourceKind::MangoLoopValue => mango_loop_helper::value_of(src, accounts),
        ValueSourceKind::AccountU64 => account_u64_helper::value_of(src, accounts),
    }
}
```

`Strategy.total_value() = strategy_idle_ata.amount + Σ resolve_value_source(s)`.

The `MangoLoopValue` helper (analogue of `AaveV3LoopValue.sol`)
returns net `collateral - debt` denominated in the asset, using a
per-helper Pyth oracle pubkey to convert collateral and debt into asset
units. Returns 0 when underwater (mirrors EVM behaviour for
monotonicity).

---

## 9. ERC-4626 share math on Solana

`spl-token` shares are u64; the underlying may be higher precision
(USDC = 6 decimals; SOL = 9). Use the same OpenZeppelin
inflation-attack mitigation: keep a `virtual_shares` constant that
shifts the share precision up by 6:

```rust
const VIRTUAL_SHARES: u128 = 1_000_000;          // 10^6 — same as EVM _decimalsOffset

pub fn convert_to_shares(
    assets: u64,
    total_assets: u64,
    total_supply: u64,
) -> Result<u64> {
    // shares = assets * (totalSupply + VIRTUAL_SHARES) / (totalAssets + 1)
    let numerator   = (assets as u128).checked_mul(total_supply as u128 + VIRTUAL_SHARES)
                                      .ok_or(MathOverflow)?;
    let denominator = (total_assets as u128).checked_add(1).ok_or(MathOverflow)?;
    Ok((numerator / denominator) as u64)
}
```

`convert_to_assets` is symmetric. Round in the vault's favour: `convert_to_shares`
truncates, `convert_to_shares_round_up` adds `denominator - 1` before
dividing. Mirror the `convertToAssets(convertToShares(x)) <= x`
invariant in tests.

---

## 10. Auto-rebalance on deposit / withdraw

Same semantics as EVM:

- **Deposit.** For each active strategy `i` in id order, transfer
  `share_i = amount * weight_bps_i / 10_000` from `vault_idle_ata` to
  `strategy_idle_ata_i`, then call the strategy's deposit config
  templated CPI (if set). The sum cap is intentionally **not** enforced
  (open question, see §15) — if active weights sum past 10 000, the
  mid-loop transfer fails on insufficient balance.
- **Withdraw.** Try to fill from `vault_idle_ata` first. Deficit triggers
  per-strategy `pull_funds` in id order, each running its withdraw
  config first if needed.

`weight_bps` is u16, capped at 10 000 by `set_strategy_weight`. Active
flag flips false on deactivation; `pull_funds` returns `actual` so
partial fills are observable.

Account-list size matters here: every active strategy's accounts must
be passed in `remaining_accounts`. Solana's transaction account limit
is currently 64 (and rising via SIMDs), so a vault with N strategies +
M accounts per strategy CPI must satisfy `N * M + base_accounts ≤ 64`.
Practical limits: ≤ 8 active strategies with simple deposit configs,
or use **address lookup tables (ALTs)** for higher fan-out (recommended
default).

---

## 11. Errors and events

Custom errors, mirroring the EVM 1:1:

```rust
#[error_code]
pub enum VaultError {
    #[msg("zero address")] ZeroAddress,
    #[msg("strategy does not exist")] StrategyDoesNotExist,
    #[msg("strategy inactive")] StrategyInactive,
    #[msg("strategy already deactivated")] StrategyAlreadyDeactivated,
    #[msg("strategy still holds funds")] StrategyStillHoldsFunds,
    #[msg("weight too high")] WeightTooHigh,
    #[msg("insufficient idle")] InsufficientIdle,
    #[msg("insufficient liquidity")] InsufficientLiquidity,
    #[msg("not vault")] NotVault,
    #[msg("not admin")] NotAdmin,
    #[msg("not delegate or authority")] NotDelegateNorAuthority,
    #[msg("data too short")] DataTooShort,
    #[msg("action not allowed")] ActionNotAllowed,
    #[msg("anti-theft check failed")] AntiTheft,
    #[msg("recipient must be strategy")] RecipientMustBeStrategy,
    #[msg("target is asset")] TargetIsAsset,
    #[msg("target is self")] TargetIsSelf,
    #[msg("target is vault")] TargetIsVault,
    #[msg("target is system program")] TargetIsSystemProgram,
    #[msg("target is token program")] TargetIsTokenProgram,
    #[msg("call failed")] CallFailed,
    #[msg("value source failed")] ValueSourceFailed,
    #[msg("delegate signed an SPL transfer in the same tx")] DelegateSignedSplTransferInTx,
    #[msg("math overflow")] MathOverflow,
    #[msg("not initialized")] NotInitialized,
    #[msg("already initialized")] AlreadyInitialized,
}
```

Events follow the same naming as *src/interfaces/IVault.sol*
and *src/interfaces/IStrategy.sol*:
`VaultInitialized`, `StrategyCreated`, `StrategyWeightSet`,
`StrategyDeactivated`, `Rebalanced`, `Deposited`, `Withdrawn`,
`AllowedActionAdded`, `AllowedActionRemoved`, `ActionExecuted`,
`ValueSourceAdded`, `ValueSourceRemoved`, `DepositConfigSet`,
`WithdrawConfigSet`, `FundsPushed`, `FundsPulled`, `DelegateUpdated`.

Use Anchor's `emit!` macro. Keep field shapes identical to the EVM
events so a single off-chain indexer schema works for both networks.

---

## 12. Testing strategy

Same coverage targets as EVM (≥ 95% on `vault.rs` + `strategy.rs`,
100% on `execute_action.rs`).

- **Unit tests** (Anchor `#[cfg(test)]`, in-process):
  - `deposit` first-depositor inflation-attack, share-price math.
  - `withdraw` round-trip including auto-pull from N strategies.
  - `rebalance` push/pull with all sign combinations.
  - Strategy lifecycle (create, weight, deactivate; reactivation impossible).
  - Action whitelist add/remove + every revert path in `execute_action`.
  - Value sources happy path + missing account + wrong owner.
- **Integration tests** (`solana-test-validator` + `litesvm`):
  - Full deposit → strategy executes mock Marginfi `deposit` →
    user redeems with profit (use a `MockLendingPool` Anchor program
    that emulates rebasing).
  - **Anti-theft**: ship a `MaliciousProtocol` program whose handler
    transfers `delegate_asset_ata` → `delegate` and verify
    `execute_action` reverts.
  - **Introspection**: bundle a hostile SPL `transfer` signed by the
    delegate in the same transaction as `execute_action`; verify
    `DelegateSignedSplTransferInTx` revert.
  - **PDA isolation**: verify Strategy 0's delegate cannot operate
    Strategy 1 even with identical whitelisted `(target_program,
    discriminator)`.
- **Differential / fuzz tests** (`proptest` over share-math inputs)
  against an EVM reference (port the OpenZeppelin ERC-4626 vector
  fixture).
- **Invariant tests** under `solana-test-validator` snapshots:
  - `total_assets == idle + Σ strategy.total_value()` for every reachable state.
  - Share price never decreases absent an external loss.
  - `convert_to_assets(convert_to_shares(x)) <= x`.

Use `litesvm` (or `Surfpool`) for fast iteration; reserve
`solana-test-validator` for the full integration suite.

---

## 13. Token-2022 considerations

Token-2022 adds **transfer hooks** that an attacker could weaponise to
sneak balance changes around the anti-theft check (a hook on the
target's response token could transfer something to the delegate
mid-instruction). Two defences:

1. The vault's `asset_mint` and `share_mint` are created **without
   transfer hooks** (just the standard Token-2022 program). The vault
   refuses to initialise against a mint with the `TransferHook`
   extension enabled.
2. For protocol-receipt tokens (e.g. mango shares) the strategy doesn't
   need to trust them — their *value* is read by the value-source CPI,
   not by transferring them. So even a hook-equipped receipt token can
   be safely registered as a value source, as long as it never gets
   transferred to the delegate (which the recipient check already
   enforces).

---

## 14. Off-chain client + frontend

Mirror the EVM frontend ([FRONTEND.md](FRONTEND.md)) with these
substitutions:

| EVM concept                             | Solana substitution                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| wagmi v2 + viem                         | `@solana/web3.js` + `@coral-xyz/anchor` (or `@solana/kit` for new code)            |
| RainbowKit `ConnectButton`              | Wallet Adapter (Phantom / Backpack / Solflare / Wallet Standard)                   |
| `useReadContract(vault, "totalAssets")` | `program.account.vaultState.fetch(vaultPda)` + a derived sum over strategies      |
| ERC-20 `balanceOf` / `decimals`         | `getMint(mint)` / `getAccount(ata)` from `@solana/spl-token`                       |
| `useWriteContract`                      | `program.methods.deposit(amount).accounts({…}).rpc()`                              |
| Server-side RPC proxy at `/api/rpc/...` | Same pattern; upstream Helius / Triton / Alchemy SOL                               |
| Vault registry keyed by `(chainId, address)` | Vault registry keyed by `(cluster, vault_pda)`                                     |
| Allowed-actions probe-by-mapping         | `program.account.allowedAction.all(filters)` over the strategy's PDA seeds         |
| `_decimalsOffset = 6`                    | `VIRTUAL_SHARES = 1_000_000` constant (§9)                                         |

The disable-not-hide UI pattern, the per-vault role badges, the deposit
allowance flow (replaced by an `Approve` step that funds an ATA if
missing), and the `AddCustomVaultDialog` (paste-and-validate by reading
`vault_state` on-chain) all carry over with no architectural change.

---

## 15. Deferred / open design questions (Solana-specific)

In addition to the EVM-side items in [TODO.md](MISMATCHES.md):

- **VaultFactory.** A second program that owns a registry of vault PDAs
  per asset mint. Necessary for the frontend to enumerate vaults
  on-chain instead of via env / localStorage.
- **Account-size budget per active strategy.** Picking the canonical
  account list for `deposit` so a 4-strategy vault fits in a single
  transaction without ALTs. Alternative: enforce ALT use up front.
- **Token allowlist.** Same as EVM — restrict the set of mints a
  strategy may end up holding after `execute_action`. Implementable as a
  per-strategy `allowed_output_mints: Vec<Pubkey>` with a post-call
  audit (compare strategy ATA list pre/post and revert on any new
  non-allowlisted mint balance > 0).
- **Cooldown / rate limit per `(strategy, target_program, discriminator)`.**
  Add `last_call_slot` + `min_interval_slots` to `AllowedAction`; check
  in `execute_action`.
- **Per-action loss caps.** Track strategy `total_value` pre-call;
  revert if delta exceeds `max_loss_bps`.
- **Vault-wide and per-strategy circuit breakers.** Snapshot share price
  on `deposit` / `withdraw` / `rebalance` into a ring buffer keyed by
  slot; freeze new deposits + `execute_action` if drawdown > 10% within
  a rolling window.
- **Pause role.** Mirror `PAUSER_ROLE`; a `paused` flag on `vault_state`
  short-circuits `deposit` and `execute_action`.
- **Yield drippers** for testnet — port `src/mocks/YieldDripper.sol`
  as a small Anchor program that periodically mints into a mock-aToken
  PDA, simulating interest accrual. Same `script/drip.sh` pattern.
- **Fees.** Constant vault-creation fee (charged at factory), deposit
  fee (bps to treasury PDA), performance fee (bps on positive yield).
  Define a `fee_manager` field on `vault_state`.
- **Reactivation path** — same answer as EVM: never. To "reactivate," create
  a new strategy id pointing at the same delegate.

---

## 16. Acceptance criteria for production deploy

- [ ] `anchor build` clean; deterministic IDL committed.
- [ ] `anchor test` 100% green on `litesvm` and `solana-test-validator`.
- [ ] Coverage ≥ 95% on `vault.rs` + `strategy.rs`, 100% on
      `execute_action.rs` (use `cargo-llvm-cov`).
- [ ] **Anti-theft** integration tests against the malicious-protocol
      mock pass.
- [ ] **Introspection** integration test (delegate-signed SPL transfer
      bundled in same tx) reverts `DelegateSignedSplTransferInTx`.
- [ ] **PDA isolation** test passes (Strategy 0's delegate cannot move
      Strategy 1's funds even with identical whitelist).
- [ ] **Inflation-attack** test passes at first-depositor boundary.
- [ ] **Deactivation irreversibility** asserted by test.
- [ ] All instructions emit events that match the EVM event schema.
- [ ] `anchor verify` against the committed source on a public build
      machine.
- [ ] Devnet deploy + `solana-program-info` verification + a public
      explorer link recorded in a Solana equivalent of
      [DEPLOYMENTS.md](DEPLOYMENT.md).
- [ ] Smoke test on devnet: deposit → push → `execute_action` against a
      mock lending pool → rebalance pull → withdraw with profit.

---

## 17. Implementation roadmap

In rough priority order (mirrors EVM §11 in *EVM_VAULT_SPEC.md (not present in this repo)*):

1. **Skeleton + share math.** `initialize_vault`, `deposit`, `withdraw`,
   share math with `VIRTUAL_SHARES`. No strategies yet.
2. **Strategy lifecycle.** `create_strategy`, `set_strategy_weight`,
   `deactivate_strategy`, idle ATA wiring. Auto-rebalance off.
3. **Auto-rebalance.** `_auto_rebalance_in` + `_auto_pull_from_strategies`,
   `push_funds` / `pull_funds` helpers. ALT support for high-fan-out
   vaults.
4. **Action whitelist.** `add_allowed_action`, `remove_allowed_action`,
   the `allowed_action` PDA seed pattern.
5. **`execute_action`.** Validation chain + introspection check + CPI
   `invoke_signed`. Anti-theft snapshot.
6. **Value sources.** `add_value_source`, `remove_value_source`,
   resolver per `ValueSourceKind`. Off-chain `total_assets` helper in
   the client.
7. **Mock protocol + tests.** Anchor `mock_protocol` mirroring
   *test/helpers/MockProtocol.sol*. Full
   integration test suite.
8. **Safety primitives** (deferred §15): pause, circuit breakers,
   emergency unwind. Same shape as the EVM TODO list.
9. **Fees** (deferred §15): factory + treasury + performance fees.
10. **VaultFactory + on-chain registry.**

Once steps 1–7 are green, the program is feature-complete with the
current EVM implementation and ready for testnet wiring.

---

## 18. References

- **Solana program model:** <https://solana.com/docs/programs>
- **Anchor:** <https://www.anchor-lang.com>
- **SPL Token / Token-2022:** <https://spl.solana.com/token>
- **Instruction introspection sysvar:** <https://docs.rs/solana-program/latest/solana_program/sysvar/instructions/index.html>
- **Pyth (oracle for value sources):** <https://docs.pyth.network>
- **Address Lookup Tables:** <https://solana.com/docs/advanced/lookup-tables>
- **EVM source of truth:** *EVM_VAULT_SPEC.md (not present in this repo)*, *src/Vault.sol*, *src/Strategy.sol*.

---

## 19. License

MIT. Match whatever the parent organization uses if that changes.
