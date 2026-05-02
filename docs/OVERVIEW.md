# Erebor — High-Level Overview

> **One line.** A non-custodial, multi-strategy Solana vault that
> isolates each AI-agent strategy in its own PDA + SPL token account,
> so a compromised agent can lose at most the funds inside its own
> strategy slot — never the rest of the vault, never another strategy,
> never another user.
>
> **Status note.** This document describes both *what is shipped today*
> and *what the spec calls for*. Sections that are aspirational are
> marked with a ⚠ callout linking to [MISMATCHES.md](MISMATCHES.md);
> trust the code, not the spec, when they disagree. The
> [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) build spec is the
> longer aspirational reference.

---

## 1. The problem

You want **autonomous AI agents** to actively manage Solana DeFi
positions — lend on Marginfi / Lulo / Drift, swap on Jupiter, loop on
Kamino, rebalance — **on behalf of many users at once**.

Three concerns make this hard:

| Concern              | What can go wrong                                                              |
| -------------------- | ------------------------------------------------------------------------------ |
| **Custody**          | Agent keys get phished → the agent drains the vault.                           |
| **Silent misuse**    | The agent signs an "innocent" tx that quietly reroutes funds to an attacker.   |
| **Spread of damage** | One bad strategy shouldn't hurt users who chose a different strategy.          |

Erebor answers them with one design decision: **every strategy lives
in its own pair of PDAs (one state, one token account), and the agent
delegated to that strategy can only spend from its own ATA**. The
program ships the full `execute_action` curation gateway from
[SOLANA_VAULT_SPEC.md §7.7](SOLANA_VAULT_SPEC.md): an `AllowedAction`
whitelist seeded by `(strategy, target_program, discriminator)`,
required `expected_recipient_index`, balance-snapshot anti-theft on
both caller and delegate ATAs, and Solana-native sibling-instruction
introspection via the instructions sysvar — same-transaction
instructions touching the strategy ATA are rejected.

---

## 2. The design in one picture

```mermaid
flowchart LR
    subgraph UsersSide["Users"]
        U1[User A]
        U2[User B]
    end

    subgraph VaultSide["Vault PDA (program: my_project)"]
        V[VaultState PDA<br/>- mints/burns shares<br/>- holds reserve ATA<br/>- admin + authority pubkeys]
    end

    subgraph Sandboxes["Strategy slots — one Strategy PDA per strategy"]
        S0[Strategy 0 PDA<br/>+ strategy 0 ATA<br/>holds its own funds<br/>weight 60%]
        S1[Strategy 1 PDA<br/>+ strategy 1 ATA<br/>holds its own funds<br/>weight 40%]
    end

    subgraph Protocols["External Solana DeFi"]
        L[Lulo / Marginfi]
        D[Drift]
        K[Kamino]
    end

    subgraph Offchain["Off-chain principals"]
        DEL0((Delegate 0<br/>AI agent keypair))
        DEL1((Delegate 1<br/>AI agent keypair))
        ADM((Admin))
        AUTH((Authority))
    end

    U1 -- deposit USDC --> V
    U2 -- deposit USDC --> V
    V -. allocate / rebalance .-> S0
    V -. allocate / rebalance .-> S1

    DEL0 -- spends from strategy 0 ATA<br/>via SPL delegate --> L
    DEL1 -- spends from strategy 1 ATA<br/>via SPL delegate --> D

    ADM -. create / set weight / deactivate / set delegate .-> V
    AUTH -. allocate / deallocate / rebalance .-> V
```

**In short:**

- Users only interact with the **VaultState PDA** (`deposit` →
  receive SPL share tokens; `withdraw` → burn shares).
- The vault PDA owns **one ATA per strategy** plus the **reserve ATA**.
- An admin creates each strategy slot and approves the corresponding
  AI agent as the **SPL delegate** of that strategy's ATA. The agent
  can spend from that ATA only.
- Funds move between reserve and strategy ATAs via authority-gated
  `allocate_to_strategy` / `deallocate_from_strategy` /
  `rebalance_strategy`.

> **Spec vs. code.** [SOLANA_VAULT_SPEC.md §5](SOLANA_VAULT_SPEC.md)'s
> per-strategy authority PDAs are shipped: `vault_authority` (one per
> vault, owns the reserve ATA + share mint) and `strategy_authority[i]`
> (one per strategy, owns strategy *i*'s ATA and signs the inner CPI of
> `execute_action`). `vault_state` itself never signs. The full
> `execute_action` gateway — `AllowedAction` whitelist, balance-snapshot
> anti-theft, sibling-instruction introspection, per-action loss cap +
> cooldown — is shipped.

---

## 3. Three core ideas

### 3.1 Each strategy is its own pair of PDAs, not just a ledger row

Most multi-strategy vaults track per-strategy ownership in a lookup
table on the vault. **Erebor derives a separate `StrategyAllocation`
PDA + a separate strategy ATA per strategy id**:

```mermaid
flowchart LR
    P[my_project program]
    V[VaultState PDA<br/>seeds: vault, token_mint, vault_id]
    C0[Strategy 0 PDA<br/>seeds: strategy, vault, 0]
    A0[Strategy 0 ATA<br/>seeds: strategy_token, vault, 0]
    C1[Strategy 1 PDA]
    A1[Strategy 1 ATA]
    C2[Strategy 2 PDA]
    A2[Strategy 2 ATA]

    P -- create_strategy --> C0
    P -- creates and owns --> A0
    P --> C1
    P --> A1
    P --> C2
    P --> A2
```

**Why this matters:** strategy 0's delegate has SPL approval over
strategy 0's ATA only. They cannot touch strategy 1's funds, the
reserve, or the share mint — the program won't sign those CPIs for
them.

There is no minimal-proxy / `delegatecall` analogue (Solana doesn't
have one). The unit of code is the program; the unit of isolation is
the PDA.

### 3.2 Agents act via SPL delegate, gated by an `execute_action` whitelist

When an admin calls `create_strategy(delegate)`, the program signs
`spl-token approve(amount = u64::MAX)` on the strategy ATA (signed by
`strategy_authority[i]`) so the agent's keypair can spend. To actually
move funds, the agent calls `execute_action(strategy_id)`. The program
validates against an `AllowedAction` PDA seeded by
`(strategy, target_program, discriminator)`, requires
`expected_recipient_index` to pin the strategy ATA into the relayed
instruction, then `invoke_signed`s the inner CPI with
`strategy_authority[i]` seeds.

### 3.3 Anti-theft: balance snapshot + sibling-instruction introspection + per-action limits

`execute_action` snapshots **both** `caller_token_ata.amount` and
`delegate_token_ata.amount` before the inner CPI, then reverts with
`AntiTheft` if either grew after the call. Combined with the required
`expected_recipient_index` (the account at that index must equal
`strategy.token_account`), this prevents proceeds from being routed
to the delegate.

The program also walks the **instructions sysvar** before the CPI
fires and rejects with `SiblingInstructionForbidden` any other
instruction in the same transaction whose account metas list the
strategy ATA. This is the spec's [§7.7](SOLANA_VAULT_SPEC.md) Solana-
native guarantee — a hostile relayed program cannot bundle a sibling
SPL transfer signed by the delegate against the strategy's own ATA.

Two additional per-action gates live on `AllowedAction`:

- **`loss_per_call_bps_cap`** — strategy ATA outflow during a single
  `execute_action` call cannot exceed
  `strategy.allocated_amount × cap_bps / 10_000`. `0` disables.
  Program-level cap: 5 000 bps (50%). Reverts with `ActionLossExceedsCap`.
- **`cooldown_secs`** — minimum seconds between successful invocations
  of this `(strategy, target, discriminator)`. The program stamps
  `last_executed_at` on every successful call and reverts with
  `ActionCooldownActive` on early re-entry. `0` disables.

---

## 4. Roles

```mermaid
flowchart TB
    subgraph Onchain
        direction LR
        ADM[VaultState.admin: Pubkey<br/><b>Admin</b>]
        AUT[VaultState.authority: Pubkey<br/><b>Authority</b>]
        DEL[StrategyAllocation.delegate<br/><b>Delegate</b><br/>per-strategy]
        USR[<b>Users</b><br/>anyone holding share tokens]
    end

    ADM --> |create_strategy,<br/>set_strategy_weight,<br/>deactivate_strategy,<br/>update_strategy_delegate,<br/>add/remove_allowed_action,<br/>set/clear_auto_action_config,<br/>add/remove_value_source,<br/>set_paused, set_performance_fee_bps,<br/>propose_admin / propose_authority| Caps1[Vault + strategy config]
    AUT --> |allocate_to_strategy,<br/>deallocate_from_strategy,<br/>rebalance_strategy,<br/>rebalance_with_delta,<br/>report_yield, report_loss,<br/>settle_strategy_value| Caps2[Fund movement<br/>+ NAV reporting]
    DEL --> |spends from its own<br/>strategy ATA via SPL delegate| Caps3[Protocol interaction]
    USR --> |deposit, withdraw| Caps4[SPL share token mgmt]
```

| Role          | Held by                       | Can do                                                                     | Cannot do                                                              |
| ------------- | ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Admin**     | Multisig (Squads) / EOA       | Create / configure / deactivate strategies, rotate delegates, propose admin / authority transfer (two-step) | Move funds directly                                                    |
| **Authority** | Operator EOA / keeper         | Push/pull funds between reserve ↔ any strategy, trigger weight-driven rebalance, signed-delta rebalance, report yield/loss, settle live NAV via value sources | Change roles, configs, or delegates                                    |
| **Delegate**  | AI agent keypair (per strategy) | Spend from its own strategy ATA via SPL approval                          | Touch any other strategy / the reserve / the share mint                |
| **User**      | Anyone holding shares         | `deposit`, `withdraw`                                                      | Anything privileged                                                    |

Admin and authority can be the same key; they're separated so a hot
operator key (authority) can rebalance without holding configuration
control (admin). Delegates are *not* a role — each delegate is a
single `Pubkey` stored on its own `StrategyAllocation` PDA.

The current program initializes `admin == authority == initializer`
at vault init. Rotating either is a **two-step handoff**:
`propose_admin(new)` writes to `vault_state.pending_admin`, and the
new key must call `accept_admin` from its own keypair before the live
field changes (same shape for `propose_authority` / `accept_authority`).

---

## 5. User flow — deposit

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant V as my_project program (vault)
    participant R as Reserve ATA
    participant S as Share Mint
    participant USR as User Share ATA

    U->>V: deposit(amount, [strategy pairs in remaining_accounts]?)
    V->>V: shares = amount × (supply + VIRTUAL_SHARES) / (assets + 1)<br/>VIRTUAL_SHARES = 1_000_000
    V->>R: token::transfer(user → reserve, amount) [user signs]
    V->>S: token::mint_to(share_mint → user_share_ata, shares) [vault_authority signs]
    Note over V: total_deposited += amount
    opt remaining_accounts pairs present
        V->>V: for each [strategy_pda, strategy_token_account] pair:<br/>share = amount × strategy.weight_bps / 10_000<br/>transfer reserve → strategy ATA [vault_authority signs]<br/>strategy.allocated_amount += share
    end
```

> **Auto-fan-out.** When the caller passes
> `[strategy_pda, strategy_token_account]` pairs in `remaining_accounts`,
> `deposit` distributes the deposited amount across active strategies
> using each strategy's `target_weight_bps` over 10 000 (so a sum of
> e.g. 8 000 deploys 80% and leaves 20% in reserve as withdrawal
> buffer). Inactive or zero-weight strategies are silently skipped.
> Empty `remaining_accounts` is a no-op for back-compat.

---

## 6. User flow — withdraw

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant V as my_project program (vault)
    participant USH as User Share ATA
    participant R as Reserve ATA
    participant USR as User Token ATA

    U->>V: withdraw(shares_to_burn, [strategy triples in remaining_accounts]?)
    V->>V: underlying = shares × (assets + 1) / (supply + VIRTUAL_SHARES)
    opt reserve < underlying
        V->>V: walk [strategy, strategy_authority, strategy_token_account] triples<br/>pull min(strategy_ata.amount, shortfall) from each<br/>[strategy_authority signs]
        V->>V: revert InsufficientLiquidity if shortfall remains
    end
    V->>USH: token::burn(user_shares, shares_to_burn) [user signs]
    V->>R: token::transfer(reserve → treasury_ata, treasury_fee) [vault_authority signs, if > 0]
    V->>R: token::transfer(reserve → admin_token_ata, curator_fee) [vault_authority signs, if > 0]
    V->>R: token::transfer(reserve → user_token_ata, net) [vault_authority signs]
    Note over V: total_deposited -= gross
```

> **Auto-pull (Phase-4b).** When the reserve can't cover the
> requested underlying, `withdraw` walks
> `[strategy_pda, strategy_authority, strategy_token_account]` triples
> in `remaining_accounts` in id order, pulling
> `min(strategy_ata.amount, shortfall)` from each strategy ATA into
> the reserve until the gap closes. Reverts with `InsufficientLiquidity`
> if the chain still can't cover. Funds parked in *external* protocols
> (Lulo cTokens, Drift sub-accounts, Kamino reserve shares) aren't
> touched by this loop — the agent / frontend redeems via
> `execute_action(<protocol>_withdraw, …)` first; the redeemed funds
> land in the strategy ATA and the next withdraw sweeps them.

---

## 7. Agent flow — `execute_action` validation chain

> **Status.** The full chain below is **shipped**, including
> sibling-instruction introspection (`Intro`) and the post-call
> balance snapshot (`Anti`). The chain also enforces the per-action
> cooldown (before `Caller`) and per-action loss cap (after `Anti`,
> before `Emit`) — omitted from the diagram for clarity.

```mermaid
flowchart TB
    Start([delegate calls execute_action<br/>strategy_id])

    Caller{caller == strategy.delegate<br/>OR vault.authority?}
    Active{strategy.is_active?}
    Guard{target_program not in<br/>guarded set?}
    WL{AllowedAction PDA exists<br/>strategy, target, disc?}
    Recip{recipient_account_index<br/>set?}
    RecipCheck{accounts[idx] ==<br/>expected_recipient?}
    Snap[snapshot delegate.asset_ata.amount<br/>before]
    Intro[iterate Sysvar1nstructions...<br/>reject hostile siblings]
    Call[invoke_signed<br/>strategy_authority seeds]
    Anti{delegate.asset_ata.amount<br/>did not increase?}
    Emit[emit ActionExecuted]

    Done([return])
    R1([NotDelegateNorAuthority])
    R2([StrategyInactive])
    R3([TargetGuarded])
    R4([ActionNotAllowed])
    R5([RecipientMustBeStrategy])
    R6([DelegateSignedSplTransferInTx])
    R7([CallFailed])
    R8([AntiTheft])

    Start --> Caller
    Caller -- no --> R1
    Caller -- yes --> Active
    Active -- no --> R2
    Active -- yes --> Guard
    Guard -- no --> R3
    Guard -- yes --> WL
    WL -- no --> R4
    WL -- yes --> Recip
    Recip -- no --> Snap
    Recip -- yes --> RecipCheck
    RecipCheck -- no --> R5
    RecipCheck -- yes --> Snap
    Snap --> Intro
    Intro -- hostile sibling --> R6
    Intro -- ok --> Call
    Call -- failed --> R7
    Call -- ok --> Anti
    Anti -- no --> R8
    Anti -- yes --> Emit --> Done

    classDef guard fill:#fff3cd,stroke:#b38500;
    classDef danger fill:#f8d7da,stroke:#842029;
    classDef happy fill:#d1e7dd,stroke:#0f5132;
    class Caller,Active,Guard,WL,Recip,RecipCheck,Intro,Anti guard
    class R1,R2,R3,R4,R5,R6,R7,R8 danger
    class Emit,Done happy
```

The spec orders the guards exactly as drawn (do not reorder when
implementing). The **instruction-introspection** branch is the
strongest new claim relative to the EVM port: without it, a hostile
relayed program could trick the same transaction into bundling an SPL
transfer signed by the delegate against their own ATA, even though
the post-call balance check would still pass. With it, any sibling
instruction whose account metas list the strategy ATA reverts with
`SiblingInstructionForbidden` before the inner CPI fires.

---

## 8. NAV — how the vault knows what it's worth

**Share price** is `total_deposited / share_supply` (with the
virtual-shares offset). `total_deposited` advances via
`deposit` / `report_yield` / `settle_strategy_value` and retreats via
`withdraw` / `report_loss` / `settle_strategy_value`.

**Live NAV via `ValueSource` PDAs (shipped).** A strategy registers
up to 16 value sources, each describing how to read deployed-position
value from an external account:

- **`SplAtaBalance` (kind=0)** — read the SPL Token Account `amount`
  field of `target_account` (offset 64..72). Use for any aToken /
  cToken / Drift sub-account collateral that lives in a token account.
- **`AccountU64` (kind=1)** — read a `u64` at `target_account.data[offset..offset+8]`.
  Use for protocol-specific balance fields (Mango deposit balance,
  custom adapter accounting).

Each source has a `scale_num / scale_den` ratio applied to convert the
raw read into underlying-token units (e.g. cToken × exchange-rate).

`settle_strategy_value(strategy_id)` (authority-only, pause-gated)
walks the registered VSs for one strategy, sums `strategy_token_account.amount`
plus each scaled VS contribution, and books the delta vs.
`strategy.allocated_amount` into both the strategy and
`vault_state.total_deposited` — yield path adds, loss path subtracts
(reverting `LossExceedsDeposited` if it would underflow). Emits
`StrategyValueSettled { previous_allocated, computed_value, delta_signed }`.

**Per spec ([§8](SOLANA_VAULT_SPEC.md)):** the read structure looks like:

```mermaid
flowchart LR
    subgraph V["vault.total_assets() — spec"]
        IDLE[reserve_ata.amount]
        S0V[Strategy 0.total_value]
        S1V[Strategy 1.total_value]
        SUM((+))
    end

    subgraph S0["Strategy 0.total_value() — spec"]
        I0[strategy_idle_ata.amount]
        VS0a[ValueSource: aToken-equiv .balanceOf strategy]
        VS0b[ValueSource: leveraged-loop helper net value]
        S0SUM((+))
    end

    IDLE --> SUM
    S0V --> SUM
    S1V --> SUM

    I0 --> S0SUM
    VS0a --> S0SUM
    VS0b --> S0SUM

    S0SUM --> S0V
```

> **Still deferred.** Auto-walking value sources from inside
> `deposit`/`withdraw` (so share price reflects live NAV without an
> explicit settle call), and the `MangoLoopValue` kind. Today an
> authority must call `settle_strategy_value` per strategy to refresh
> `total_deposited` from VS readings. See [MISMATCHES.md §2.1, §2.2](MISMATCHES.md).

---

## 9. Deployment topology

```mermaid
flowchart TB
    subgraph Once["Per program deployment"]
        D[deploy script.sh<br/>anchor deploy]
        D --> P[my_project program<br/>id: B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z]
    end

    subgraph PerVault["Per vault (admin)"]
        IV[initialize_vault token_mint, vault_id]
        IV --> VS[VaultState PDA + share_mint PDA + reserve ATA]
    end

    subgraph PerStrategy["Per strategy (admin)"]
        CS[create_strategy delegate]
        CS --> ST[StrategyAllocation PDA + strategy ATA<br/>delegate approved with u64::MAX]
        ST --> SW[set_strategy_weight bps]
    end

    subgraph Testnet["Devnet yield simulation"]
        SY[scripts/simulate-yield.ts]
        CY[scripts/crank-yield.ts]
        SY -- mints to strategy ATA, then report_yield --> ST
        CY -- same but in a loop --> ST
    end
```

On **devnet** (see [DEPLOYMENT.md](DEPLOYMENT.md)):

- One program at `B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z`.
- Five vaults today (per [app/src/lib/constants.ts](app/src/lib/constants.ts)),
  all on the same USDC test mint, indexed by `vault_id: 0..4`:
  *AT trader agent*, *Conservative*, *Aggressive Vault*, *Stablecoin
  Yield*, *DeFi Alpha*.
- Mock yield via [scripts/simulate-yield.ts](scripts/simulate-yield.ts)
  / [scripts/crank-yield.ts](scripts/crank-yield.ts). Real protocol
  integrations (Lulo / Marginfi / Drift / Kamino) are roadmap items
  ([AI_PLAN.md](AI_PLAN.md)).

On **mainnet**: same program code, swap the asset mint to real USDC.
No production deployment yet (slot reserved in
[DEPLOYMENT.md](DEPLOYMENT.md)).

---

## 10. Security model

| Threat                                                                             | Mitigation                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent key is stolen and tries to drain the vault                                   | Agent has SPL delegate over its strategy ATA only + `execute_action` whitelist limits calls to admin-curated `(target_program, discriminator)` pairs            |
| A whitelisted call tries to reroute funds to the delegate                          | Pre/post balance snapshot of caller AND delegate ATAs (audit #30) + required `expected_recipient_index` pinning the strategy ATA                                |
| A hostile sibling instruction in the same tx steals from the strategy ATA          | Instruction-sysvar introspection rejects any sibling whose metas list the strategy ATA                                                                          |
| Strategy A's delegate tries to move strategy B's funds                             | Per-strategy `strategy_authority[i]` PDA owns ATA *i*; even via `execute_action`, the inner CPI's signer seeds bind to a single strategy                        |
| Compromised agent issues many small drains                                         | Per-`AllowedAction` `loss_per_call_bps_cap` (max strategy ATA outflow per call) and `cooldown_secs` (min seconds between calls)                                 |
| Re-entrancy during fund movement                                                   | Solana account-locking prevents the EVM re-entrancy class                                                                                                       |
| Inflation attack on a fresh vault (donate-to-vault first depositor)                | OpenZeppelin virtual-shares offset (`VIRTUAL_SHARES = 1_000_000`) on both deposit and withdraw                                                                  |
| Admin makes a mistake and wants to "turn off" a strategy                           | `deactivate_strategy` revokes delegate, requires `allocated_amount == 0 && strategy_token_account.amount == 0`, marks inactive — permanent                       |
| Strategy reactivation after deactivation                                           | Permanent — no reactivation path                                                                                                                                |
| Configuration drift between strategies                                             | Single program, single source of truth; admin/authority pubkeys live on `vault_state`                                                                           |
| Off-chain agent compromise                                                         | Authority can rotate via `update_strategy_delegate`                                                                                                             |
| Hostile takeover via single-step admin transfer                                    | Two-step `propose_admin` + `accept_admin` (and authority equivalents) — recipient must accept from their own keypair                                            |
| Token-2022 transfer-hook smuggling                                                 | `initialize_vault` rejects mints carrying `TransferHook` or `PermanentDelegate` extensions                                                                      |
| Agent pivots strategy into a worthless / malicious mint via a swap-style action    | `AllowedAction.output_mint_index` pins the output mint slot; the program checks the pinned mint has a live protocol-level `AllowedToken` PDA before the CPI fires |

---

## 11. Fee model

> **Status.** A single recurring fee is **shipped**: the
> withdrawal-time **performance fee** (default 5%, capped at 20%,
> per-vault changeable). Everything else in this section — deposit
> fees, vault/strategy creation fees, treasury and governance —
> remains spec-only and is flagged inline.

### 11.1 Why the protocol needs revenue

A vault that earns zero gets one product cycle of charity time
before its operator loses interest. The fees below pay for:

- protocol audits + ongoing security review (the headline cost),
- on-call indexers + RPC bills,
- a curator-rebate budget so admins are paid to research agents
  rather than chase yield directly,
- a buffer for emergency redemption (e.g. covering a strategy's
  insolvency from the protocol treasury rather than socializing
  the loss to share-holders).

The shipped model is **one recurring fee** charged at withdrawal
time. The rest of the model — a deposit fee, a treasury & multisig,
and the one-time creation fees — remains designed but unimplemented;
each is flagged below.

### 11.2 Recurring fees

| Fee              | Default          | Per-vault cap     | When charged                                         | Routed to                  | Status             |
| ---------------- | ---------------- | ----------------- | ---------------------------------------------------- | -------------------------- | ------------------ |
| **Performance fee** | **500 bps (5%)** | **2000 bps (20%)** | inside `withdraw`, on the redeemed underlying        | vault admin's ATA          | ✅ shipped          |
| Deposit fee         | 0 bps           | 50 bps (0.5%)     | inside `deposit`, on the underlying amount           | (future) `protocol_treasury` | ❌ deferred         |

#### Performance fee — `VaultState.performance_fee_bps` (shipped)

Charged on the gross redemption at `withdraw` time, *before* the
user receives the funds. Concretely: a user redeeming shares worth
100 USDC at a 5% fee receives 95 USDC and the vault admin's ATA
gains 5 USDC. The fee leaves `total_deposited` together with the
user's redemption (so the vault's share-price denominator stays
honest).

Mechanics:

```
gross   = shares_to_burn × total_deposited / share_supply
fee     = gross × performance_fee_bps / 10_000
net     = gross − fee
reserve_ata --(fee)--> admin_token_ata     // skipped if fee == 0
reserve_ata --(net)--> user_token_ata
total_deposited −= gross
```

Notes:

- Charging at withdrawal (not at `report_yield` time) is a deliberate
  trade-off: users see a single fee event tied to their own
  redemption rather than silent fees during opaque yield reports,
  and continuous-yield accounting bugs are avoided. The cost is
  that the fee is **flat on redemption** rather than a true
  performance fee on the user's individual cost basis — admins can
  set the rate to 0 for a stablecoin / principal-preserving vault
  to avoid charging users who never realised yield.
- The fee CPI is **skipped** when `performance_fee_bps == 0`, so
  fee-free vaults pay no extra compute and don't strictly need an
  initialised admin ATA.
- The fee splits in two at withdraw time (Phase-4a): a constant
  protocol cut sized by `ProtocolConfig.protocol_fee_bps` (default
  200 = 2%) routes to `ProtocolConfig.treasury`'s underlying ATA, and
  the remainder routes to the **vault admin's** underlying ATA. If
  admin is rotated via the two-step `propose_admin` / `accept_admin`
  flow, future curator fees flow to the new admin automatically.
- The default is **5%**, set in the program as
  `DEFAULT_PERFORMANCE_FEE_BPS = 500`. The cap is `MAX_PERFORMANCE_FEE_BPS
  = 2000`. Both are program constants — admins can change a vault's
  rate within `[0, 2000]` via `set_performance_fee_bps`, but raising
  the program-level cap requires a program upgrade.
- Adding `performance_fee_bps: u16` to `VaultState` is a
  layout-breaking change. Vaults from previous deployments that
  didn't have the field cannot be upgraded in place; the devnet
  registry was repointed at a fresh test mint. See
  [DEPLOYMENT.md](DEPLOYMENT.md).

The default of 5% positions Erebor on the lower-mid end of the
market. Compare:

| Protocol                | Performance fee | Notes                                     |
| ----------------------- | --------------- | ----------------------------------------- |
| TradFi hedge funds      | **20%** ("2-and-20") | Industry baseline                          |
| Yearn V2 vaults (EVM)   | **20%**         | Plus 2% management                          |
| Convex Finance          | **17%**         | On Curve LP rewards                         |
| Kamino Multiply         | **~10%**        | Typical                                     |
| Sanctum LSTs            | **4 – 7%**      | Per LST, validator-set                      |
| Marinade staking        | **6%**          | On SOL staking rewards                      |
| **Erebor (default)**    | **5%**          | Low-friction default; admin can scale up    |
| Beefy Finance           | **4.5%**        | Aggressive low-fee positioning              |

The cap of **20%** mirrors the "20" of "2-and-20" so a curator
running an institutional-grade actively-managed agent can match
hedge-fund pricing without forking the program. We deliberately do
*not* support a 30%+ fee band; vaults that want that should fork.

A true per-user-cost-basis performance fee (only charge fee on the
*gain* portion of a withdrawal) would need a `UserPosition` PDA per
depositor — sensible v2 work; out of scope for v1.

#### Deposit fee — `deposit_fee_bps` (deferred)

> **Not implemented.** Designed for a future upgrade. The numbers
> below are spec; nothing in the program reads or writes a deposit
> fee yet.

Charged on the underlying amount the user deposits, *before* shares
are minted. Default 0 bps, cap 50 bps (0.5%). Routed to a future
`protocol_treasury` ATA. Why so low? Protocols that charge deposit
fees in DeFi land between 0 and 50 bps; anything beyond that hurts
TVL more than it helps revenue. We optimize for TVL first.

### 11.3 One-time fees — *not in scope for v1*

When the protocol is mature enough to need spam-deterrence and a
self-funded ops budget, two flat fees gate vault and strategy
creation:

| Action                | One-time fee | Paid to                        | Rationale                                                                                         |
| --------------------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `initialize_vault`    | **50 USDC**  | `protocol_treasury` ATA         | Each vault costs the protocol audit + frontend integration time; flat fee discourages spam vaults |
| `create_strategy`     | **10 USDC**  | `protocol_treasury` ATA         | Each strategy adds one set of allowed-action whitelist entries that need curator review            |

Mechanics, when implemented:

- `initialize_vault` takes a `payer_token_ata` account, transfers
  50 USDC to `protocol_treasury_ata` before initialising the
  `VaultState` PDA, and reverts the whole transaction if the
  payer's balance is short.
- `create_strategy` does the same with 10 USDC.
- Both fees are **constants in the program** (not per-vault), so an
  admin can't "set their fee to 0" for the same vault. Changing the
  fee requires a program upgrade (auditor change-control).
- The fees are denominated in the **vault's** underlying token, so
  a SOL-denominated vault charges 50 SOL-equivalent / 10
  SOL-equivalent (or the protocol can pin it to a stablecoin
  mint — design choice deferred).

Why these numbers? The 50 / 10 ratio mirrors the relative review
effort: vault creation needs end-to-end protocol checks; strategy
creation reuses most of the vault context but adds one new SPL
delegate + one new ATA. Both are small enough that legitimate
curators won't blink and hostile spammers will.

These fees are explicitly **not implemented in v1** and are not on
the §12 "out of scope" list either — they're future product
moves once the protocol has revenue from the recurring fees and
needs spam-deterrence.

### 11.4 Treasury & governance

**Today (shipped).** A singleton `ProtocolConfig` PDA at seeds
`["protocol_config"]` carries `governance`, `treasury`, and
`protocol_fee_bps`. At withdraw time, the performance fee splits:
`protocol_fee_bps × gross / 10_000` lands in `treasury`'s underlying
ATA (init-if-needed) and the remainder
`(performance_fee_bps − protocol_fee_bps) × gross / 10_000` lands in
the vault admin's ATA. `set_treasury` / `set_protocol_fee_bps` /
`set_governance` instructions are gated by `protocol_config.governance`.

Different vaults can charge different *total* rates because each
admin sets `vault_state.performance_fee_bps` within
`[protocol_fee_bps, MAX_PERFORMANCE_FEE_BPS]` — `set_performance_fee_bps`
reverts with `PerformanceFeeBelowProtocolFee` if a curator tries to
underwrite the protocol cut.

The frontend reads `vault_state.performance_fee_bps` and surfaces
it in two places: a card on the per-vault admin route
(`/vault/[address]/admin`) for the admin to change the value, and
inline in the withdraw form preview ("Gross / Performance fee /
You will receive").

**Future (deferred).** Wiring the `governance` / `treasury` keys to
a hardware-wallet multisig (target: Squads) at mainnet deploy time —
this is a deployment task, not a program change. The deposit fee
(when shipped) routes to the same `treasury`.

### 11.5 Program changes

**Shipped (this upgrade):**

- `VaultState.performance_fee_bps: u16` — added (default 500, cap 2000).
- `pub const DEFAULT_PERFORMANCE_FEE_BPS: u16 = 500;`
- `pub const MAX_PERFORMANCE_FEE_BPS: u16 = 2000;`
- `set_performance_fee_bps(new_bps: u16)` — admin, capped.
- `withdraw` — splits the redemption; transfers the fee to the
  admin's ATA when non-zero. Skips the fee CPI on zero-fee vaults.
- New events: `PerformanceFeeCharged`, `PerformanceFeeSet`.
- New error: `FeeExceedsMax`.

**Shipped (Phase-4a — protocol fee split):**

- `ProtocolConfig` singleton at seeds `["protocol_config"]` with
  `governance`, `treasury`, `protocol_fee_bps` (default 200).
- `initialize_protocol_config`, `set_treasury`, `set_protocol_fee_bps`,
  `set_governance` instructions.
- `withdraw` splits the performance fee into a treasury cut and a
  curator (vault-admin) cut.
- New events: `ProtocolConfigInitialized`, `TreasurySet`,
  `ProtocolFeeBpsSet`, `GovernanceSet`. `PerformanceFeeCharged`
  extended with `treasury_fee` / `curator_fee`.
- New errors: `UnauthorizedGovernance`, `TreasuryMismatch`,
  `PerformanceFeeBelowProtocolFee`.

**Deferred:**

- `VaultState.deposit_fee_bps: u16` + `set_deposit_fee_bps` + the
  deposit-side split + `DepositFeeCharged` / `DepositFeeSet` events.
- 50 USDC vault-creation fee + 10 USDC strategy-creation fee
  pre-flights inside `initialize_vault` / `create_strategy`.

---

## 12. What's not in scope

The following are **deliberately deferred** — see [MISMATCHES.md](MISMATCHES.md)
and [SOLANA_VAULT_SPEC.md §15](SOLANA_VAULT_SPEC.md):

- **Live NAV in share-price math.** `ValueSource` PDAs and
  `settle_strategy_value` are shipped, but the share-price denominator
  is `vault_state.total_deposited`, which only updates on explicit
  `settle_strategy_value` / `report_yield` / `report_loss` calls. The
  spec wants `deposit`/`withdraw` to walk VSs inline. See [MISMATCHES.md §2.1, §2.2](MISMATCHES.md).
- **`AutoActionConfig` on-chain auto-invoke.** The PDA + set/clear
  instructions are shipped as declarative state — the agent reads the
  config off-chain and calls `execute_action` with the recorded
  `(target, disc, ix_data)`. Auto-CPI from inside `deposit` /
  `rebalance` is a future phase.
- **Per-strategy post-call mint check** — the *protocol-level*
  `AllowedToken` PDA + `output_mint_index` gate is shipped (the agent
  cannot pivot a strategy into a non-allowlisted mint via a curated
  swap-style action). A per-strategy variant — scanning every token
  account the strategy might hold after the call — is not.
- **`MangoLoopValue` value-source kind** — the spec lists it alongside
  `SplAtaBalance` and `AccountU64`. Today only the latter two are
  implemented; most leveraged-loop accounting fits inside
  `AccountU64` with the right offset and scale.
- **Deposit fee** — designed in §11 above; performance fee shipped
  but deposit fee remains unimplemented.
- **Vault / strategy creation fees (50 / 10 USDC)** — designed in
  §11.3, explicitly not in v1 scope.
- **Protocol treasury Squads multisig.** A `ProtocolConfig.treasury`
  pubkey + `protocol_fee_bps` cut on the performance fee are shipped
  (Phase-4a); the actual hardware-multisig wiring as the treasury
  owner is a deployment task.
- A `VaultFactory`-style on-chain registry (today the frontend's
  registry is build-time; see [FRONTEND.md](FRONTEND.md)).
- Off-chain AI agent (scaffold only — see [AI_PLAN.md](AI_PLAN.md)).

The core vault + strategy lifecycle is shipped; everything in this
list is additive.

---

## 13. How to pitch it

If you get 60 seconds:

> Erebor is a Solana vault that lets AI agents move real money under
> a curator's supervision. Each strategy lives in its own PDA + token
> account; the agent assigned to that strategy is the SPL delegate of
> that token account and only that token account, and every spend
> goes through an `execute_action` whitelist with a balance-snapshot
> anti-theft check, sibling-instruction introspection via the
> instructions sysvar, per-action loss caps, and per-action cooldowns.
> Users deposit USDC once (optionally fanning out to active strategies
> by weight in the same transaction), an authority rebalances or
> settles live NAV via registered value sources, and a withdraw burns
> shares to redeem proportional underlying — pulling from strategy
> ATAs in id order if the reserve is short.

If you get 5 minutes: §2, §3, §7 (the validation chain), §10.

If they have engineers in the room: also §8 (NAV) and §6 (withdraw
fallback).

---

## 14. Further reading

- [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) — original build spec;
  partly aspirational, cross-check with [MISMATCHES.md](MISMATCHES.md).
- [MISMATCHES.md](MISMATCHES.md) — every place the spec drifts from
  the code.
- [CLAUDE.md](../CLAUDE.md) — contributor guide (commands + invariants).
- [FRONTEND.md](FRONTEND.md) — current dashboard implementation.
- [FRONTEND_PLAN.md](FRONTEND_PLAN.md) — frontend roadmap + open
  questions.
- [README.md](../README.md) — terse user-facing intro.
- [DEPLOYMENT.md](DEPLOYMENT.md) — live devnet program + per-vault
  PDA derivations.
- [AI_PLAN.md](AI_PLAN.md) — AI agent design.
- [PLAN.md](PLAN.md) — historical implementation checklist.
