# Erebor EVM — Build Spec & Prompt

> **Use this file as the seed input for a fresh Foundry repo.** It is a complete specification for porting the Erebor multi-strategy AI-agent vault from Solana/Anchor to EVM/Solidity. Every section is written so a competent Solidity engineer (or an AI coding assistant) can implement it end-to-end without needing to read the original Solana source.

---

## 1. What you are building

A **non-custodial multi-strategy yield vault** for ERC-20 tokens (USDC by default) where:

- Users deposit a single asset and receive ERC-4626 vault shares.
- A curator (admin) creates **strategies** — logical slots where AI agents are authorized to manage allocated funds.
- Each strategy has exactly one **delegate** (an EOA / agent wallet). The delegate cannot move tokens directly. Instead, the vault exposes `executeStrategyAction(...)` which validates the requested call against a per-strategy **action whitelist** of `(target, selector)` pairs and executes it from the vault's own context.
- The vault automatically rebalances funds across strategies based on per-strategy target weights set by the admin.

The whole point of the architecture is to **let AI agents operate on real capital with bounded blast radius**: a rogue agent can only move funds via pre-whitelisted external calls into pre-approved protocols, and even then can only touch its own slice (its `allocatedAmount`).

This is the EVM equivalent of the `B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z` Anchor program. The reference implementation (Solana/Anchor) lives at <https://github.com/xrave110/Erebor> — read [README.md](README.md), [overview.md](overview.md), and [agent/lulo/LULO.md](agent/lulo/LULO.md) for the full design rationale.

---

## 2. Solana → EVM translation

| Concept (Solana)                       | Concept (EVM)                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Anchor program                         | `Vault.sol` contract (UUPS upgradeable optional)                                             |
| `VaultState` PDA                       | Storage in `Vault.sol`                                                                       |
| Share Mint PDA                         | ERC-4626 / ERC-20 shares minted by `Vault.sol` itself                                        |
| Reserve ATA                            | `IERC20(asset).balanceOf(address(this))` minus sum of strategy allocations                   |
| `StrategyAllocation` PDA               | `mapping(uint256 strategyId => Strategy)` in `Vault.sol`                                     |
| Strategy token account (separate PDA)  | Logical-only — the vault holds all funds, bookkeeping tracks per-strategy allocations       |
| `AllowedAction` PDA                    | `mapping(uint256 strategyId => mapping(address target => mapping(bytes4 selector => bool)))` |
| `execute_strategy_action` + invoke_signed | `executeStrategyAction(strategyId, target, data)` in `Vault.sol` using `target.call(data)` |
| Anchor delegate model (SPL approve)    | `msg.sender == strategy.delegate` check inside `executeStrategyAction`                       |
| Vault PDA signing CPI                  | The vault contract itself is `msg.sender` to the target protocol                             |
| `target_weight_bps`                    | Same field, same meaning (uint16, basis points 0–10000)                                      |
| `rebalance_strategy`                   | `rebalanceStrategy(uint256 strategyId)` — diff target vs actual, top up or pull              |
| `report_yield`                         | `reportYield(uint256 strategyId)` — pull idle profit from strategy slot back into reserve    |

**Key simplification on EVM:** Solana's "one delegate per token account" constraint forced separate token accounts per strategy. EVM has no such constraint — `approve()` is per `(owner, spender)` pair, but here the vault is always the owner _and_ the caller. So strategies are pure bookkeeping in a single contract. There are no per-strategy ERC-20 balances; we track `allocatedAmount` and the asset's actual location (idle in vault, or sitting in some external protocol like Aave/Morpho).

**Key constraint to preserve:** the agent must never be able to move funds outside the whitelisted (target, selector) set. On Solana this is enforced by `execute_strategy_action` validating the discriminator. On EVM, enforce it by extracting the `bytes4` selector from `data[:4]` and checking the whitelist before the `call`.

---

## 3. Roles

| Role          | EVM equivalent                                                            | Permissions                                                                       |
| ------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Admin**     | `DEFAULT_ADMIN_ROLE` / `admin` storage var                                | Create/deactivate strategies, set delegate, set weight, manage allowed actions    |
| **Authority** | `AUTHORITY_ROLE` (default = admin)                                        | Allocate/deallocate, rebalance, report yield                                      |
| **Delegate**  | `strategy.delegate` (single address per strategy, NOT a role)             | Call `executeStrategyAction` for that strategy only                               |
| **User**      | Anyone holding shares                                                     | `deposit`, `mint`, `withdraw`, `redeem`                                           |

Use OpenZeppelin `AccessControl` for admin/authority. Delegates are stored per-strategy, not as a global role.

---

## 4. Required contracts

### 4.1 `src/Vault.sol`

ERC-4626 compliant vault (inherit `ERC4626Upgradeable` or `ERC4626` from OpenZeppelin).

**Storage:**
```solidity
struct Strategy {
    address delegate;          // AI agent EOA
    uint256 allocatedAmount;   // Tokens currently working in this strategy
    uint16  targetWeightBps;   // 0–10000
    bool    isActive;          // false = permanently disabled
    uint64  actionCount;       // not strictly needed on EVM, kept for parity
}

uint256 public strategyCount;
mapping(uint256 => Strategy) public strategies;
mapping(uint256 => mapping(address => mapping(bytes4 => bool))) public allowedActions;
address public authority;
uint256 public totalAllocated; // sum of all strategies.allocatedAmount

// ERC-4626 already provides `asset()`, `totalAssets()`, share accounting.
// Override totalAssets() to return: idle + totalAllocated + sum of yield held in adapters
```

**Vault operations** (override ERC-4626 hooks if needed):
- `deposit(uint256 assets, address receiver) → shares`
- `withdraw(uint256 assets, address receiver, address owner) → shares`
- `mint(uint256 shares, address receiver) → assets`
- `redeem(uint256 shares, address receiver, address owner) → assets`

**Strategy management:**
- `createStrategy(address delegate) external onlyAdmin returns (uint256 strategyId)`
- `updateStrategyDelegate(uint256 strategyId, address newDelegate) external onlyAdmin`
- `setStrategyWeight(uint256 strategyId, uint16 weightBps) external onlyAdmin` — require `weightBps <= 10_000`
- `deactivateStrategy(uint256 strategyId) external onlyAdmin` — pull all funds, mark inactive permanently
- `transferAdmin(address newAdmin) external onlyAdmin`
- `setAuthority(address newAuthority) external onlyAdmin`

**Allocation & rebalancing:**
- `allocateToStrategy(uint256 strategyId, uint256 amount) external onlyAuthority`
- `deallocateFromStrategy(uint256 strategyId, uint256 amount) external onlyAuthority`
- `rebalanceStrategy(uint256 strategyId) external onlyAuthority` — compute `target = totalAssets() * weightBps / 10000`, top up or pull
- `reportYield(uint256 strategyId) external onlyAuthority` — sweep idle profit from the strategy slot back to the reserve

**Action whitelisting:**
- `addAllowedAction(uint256 strategyId, address target, bytes4 selector) external onlyAdmin`
- `removeAllowedAction(uint256 strategyId, address target, bytes4 selector) external onlyAdmin`
- `executeStrategyAction(uint256 strategyId, address target, bytes calldata data) external returns (bytes memory result)`

**`executeStrategyAction` validation order** (CRITICAL — match Solana implementation in `programs/my_project/src/instructions/execute_strategy_action.rs`):

1. `require(strategies[strategyId].isActive)`
2. `require(msg.sender == strategies[strategyId].delegate || msg.sender == authority)`
3. `require(data.length >= 4)`
4. Extract `bytes4 selector = bytes4(data[:4])`
5. `require(allowedActions[strategyId][target][selector])`
6. **Anti-theft check** — before the call, snapshot `IERC20(asset).balanceOf(address(this))`. After the call, the new balance must satisfy `newBalance + (amount sent to target) >= oldBalance` — i.e., the call must not have rerouted assets to an arbitrary recipient. Equivalent to Solana's `UnauthorizedDestination` check that scans writable token accounts for the caller as authority.
7. Use OpenZeppelin `ReentrancyGuard`'s `nonReentrant`.
8. `(bool ok, bytes memory result) = target.call(data); require(ok)`.
9. Emit `StrategyActionExecuted(strategyId, target, selector, dataHash)`.

**Events:** mirror the Solana program — `VaultInitialized`, `Deposited`, `Withdrawn`, `StrategyCreated`, `Allocated`, `Deallocated`, `StrategyDeactivated`, `WeightSet`, `Rebalanced`, `YieldReported`, `AllowedActionAdded`, `AllowedActionRemoved`, `StrategyActionExecuted`, `AdminTransferred`, `AuthoritySet`, `DelegateUpdated`.

### 4.2 `src/VaultFactory.sol` (optional but recommended)

Deploys per-asset vault instances behind ERC-1967 proxies. The Solana program supports multiple vaults per token via `vault_id` — replicate this with one proxy per `(asset, vaultId)` pair. Factory keeps a registry: `mapping(address asset => mapping(uint256 vaultId => address vault))`.

### 4.3 `src/adapters/` (per-protocol adapters — optional)

If the agent will lend into Aave, Morpho, etc., consider thin adapter contracts that expose a clean `(target, selector)` surface so admins can whitelist them per-strategy. Keep adapters stateless and ownerless. Alternatively, whitelist the protocol contracts directly — the adapter pattern is purely ergonomic.

### 4.4 `src/interfaces/IVault.sol`

External interface for the vault — useful for frontends, agents, and adapters.

---

## 5. Repository structure (Foundry)

```
erebor-evm/
├── foundry.toml
├── remappings.txt
├── .env.example
├── README.md
├── lib/                          # forge install targets
│   ├── forge-std/
│   ├── openzeppelin-contracts/
│   └── openzeppelin-contracts-upgradeable/
├── src/
│   ├── Vault.sol
│   ├── VaultFactory.sol
│   ├── interfaces/
│   │   └── IVault.sol
│   └── adapters/                 # optional
├── script/
│   ├── Deploy.s.sol              # deploy vault + factory
│   ├── InitVault.s.sol           # create per-asset vault instance
│   └── SetupStrategy.s.sol       # create strategy + whitelist actions
├── test/
│   ├── unit/
│   │   ├── VaultDeposit.t.sol
│   │   ├── VaultWithdraw.t.sol
│   │   ├── VaultStrategy.t.sol
│   │   ├── VaultRebalance.t.sol
│   │   ├── VaultActionWhitelist.t.sol
│   │   └── VaultRoles.t.sol
│   ├── integration/
│   │   └── AaveV3Adapter.t.sol   # forked-mainnet test against real protocol
│   ├── invariant/
│   │   └── VaultInvariants.t.sol # share price monotonicity, total accounting
│   └── helpers/
│       ├── MockProtocol.sol
│       └── TestUtils.sol
├── frontend/                     # optional Next.js app (mirror app/ from Solana repo)
└── agent/                        # optional off-chain agent (mirror agent/lulo/)
```

`foundry.toml`:
```toml
[profile.default]
src       = "src"
out       = "out"
libs      = ["lib"]
solc      = "0.8.27"
optimizer = true
optimizer_runs = 1_000_000
via_ir    = true
fs_permissions = [{ access = "read", path = "./" }]

[fuzz]
runs = 1024

[invariant]
runs = 256
depth = 32
fail_on_revert = false

[rpc_endpoints]
mainnet = "${MAINNET_RPC_URL}"
sepolia = "${SEPOLIA_RPC_URL}"

[etherscan]
mainnet = { key = "${ETHERSCAN_API_KEY}" }
sepolia = { key = "${ETHERSCAN_API_KEY}" }
```

---

## 6. Test plan

You must reach **≥95% line coverage** on `src/Vault.sol` and 100% on `executeStrategyAction`. Use `forge coverage --report summary` to track.

### Unit tests (`test/unit/`)

**Deposit/withdraw (ERC-4626 compliance):**
- First depositor receives shares 1:1 with assets
- Subsequent depositors get shares proportional to `shares * totalSupply / totalAssets`
- `withdraw` burns the right number of shares for a given asset amount
- `redeem` returns the right asset amount for a given share count
- Reverts on zero amount, on insufficient shares, on insufficient liquidity in reserve
- Share price monotonicity: `sharePrice` only goes up (until losses)
- Inflation attack mitigation (donate-to-vault attack — verify decimals offset or virtual shares)

**Strategy lifecycle:**
- `createStrategy` increments `strategyCount`, stores delegate
- Only admin can create / deactivate / set delegate / set weight
- Reverts on `weightBps > 10000`
- Deactivation pulls all funds back to reserve and is permanent (subsequent activation reverts)
- `updateStrategyDelegate` only callable by admin

**Allocation & rebalancing:**
- `allocateToStrategy` reverts if reserve insufficient
- `deallocateFromStrategy` reverts if strategy underfunded
- `rebalanceStrategy` correctly computes target and moves the diff
- Rebalancing respects active flag (inactive strategy → revert or no-op)
- `totalAssets()` always equals reserve + sum of strategy allocations + protocol-held yield

**Action whitelisting (CRITICAL — port the Solana edge cases verbatim):**
- `executeStrategyAction` succeeds when (target, selector) is whitelisted, called by delegate, on active strategy
- Reverts when caller is not the delegate (and not authority)
- Reverts when strategy is inactive
- Reverts when (target, selector) is not whitelisted
- Reverts when `data.length < 4`
- Reverts when the call would route assets to the caller's own address (anti-theft check)
- Authority can also call `executeStrategyAction` (matches Solana behavior)
- `addAllowedAction` and `removeAllowedAction` are admin-only
- Removed action reverts immediately on next call
- Re-entrancy: target attempts to call back into the vault → reverts via `nonReentrant`

**Roles:**
- Admin transfer is two-step (or single-step matching Solana — pick one and document it)
- Authority can be set by admin
- Non-admin / non-authority calls revert with explicit error

### Integration tests (`test/integration/`)

Use `vm.createSelectFork(vm.envString("MAINNET_RPC_URL"), <block>)` to test against real Aave V3 / Morpho deployments. Mirror the Lulo agent flow:

1. Deploy vault with USDC as asset
2. Admin creates strategy with delegate = test EOA
3. Admin whitelists `aaveV3Pool.supply.selector` and `aaveV3Pool.withdraw.selector`
4. User deposits 100k USDC
5. Authority allocates 50k USDC to strategy
6. Delegate calls `executeStrategyAction(supply)` → vault has aUSDC
7. Time-warp 30 days (`vm.warp`)
8. Delegate calls `executeStrategyAction(withdraw)` → vault has more USDC than 50k
9. Authority calls `reportYield` to surface profit into reserve
10. User redeems shares → receives more USDC than deposited

### Invariant tests (`test/invariant/`)

- `totalAssets() >= totalSupply * 1` (share price never < 1, ignoring losses)
- `sum(strategies[i].allocatedAmount) == totalAllocated`
- `IERC20(asset).balanceOf(vault) == totalAssets() - sum(allocatedAmount in external protocols)`
- `convertToAssets(convertToShares(x)) <= x` (rounding always favors the vault)

---

## 7. Frontend (optional, Next.js)

Mirror the Solana repo's `app/` directory. Required pages:

- **Dashboard** — list of available vaults, TVL, share price, strategies, allocation pie chart
- **Deposit/Withdraw** — ERC-4626 forms with allowance handling
- **Admin** — strategy CRUD, weight setting, allowed-action management

Stack: Next.js 16, wagmi v2, viem, RainbowKit. No need for Tailwind 4 specifically — match the Solana app's structure if you want visual parity.

Look at the Solana repo's `app/src/components/admin/AllocationChart.tsx` and `app/src/hooks/useStrategies.ts` for the data shape — port them to viem reads.

---

## 8. Off-chain AI agent (optional)

Port `agent/lulo/` from the Solana repo. Same architecture:

```
agent-evm/
├── src/
│   ├── index.ts          # entry, validation, monitor loop
│   ├── config.ts         # env loading
│   ├── strategy.ts       # AaveProtocol adapter calling vault.executeStrategyAction
│   ├── monitor.ts        # polling loop, state-change detection, hard rules
│   └── llm-advisor.ts    # Claude Haiku/Sonnet selection, rate limiting
├── package.json
└── .env.example
```

Differences from the Solana agent:
- Use `viem` + `ethers` instead of `@solana/web3.js`
- Read state via `publicClient.readContract({...})` instead of Anchor account fetches
- Send txs via `walletClient.writeContract({ functionName: 'executeStrategyAction', ... })`
- Bookkeeping is simpler — no PDAs to derive, no signer seeds

Reuse the LLM advisor logic verbatim — Claude doesn't care which chain it's on. See [agent/lulo/LULO.md](agent/lulo/LULO.md).

---

## 9. Acceptance criteria

You are done when **every one** of these is true:

- [ ] `forge build` passes with no warnings
- [ ] `forge test -vv` passes 100%
- [ ] `forge coverage` shows ≥95% line coverage on `src/Vault.sol`, 100% on `executeStrategyAction`
- [ ] `forge test --match-path test/integration/AaveV3Adapter.t.sol --fork-url $MAINNET_RPC_URL` passes
- [ ] Slither runs cleanly (`slither .`) — fix or document every high/medium finding
- [ ] No `unchecked` blocks except where overflow is mathematically impossible (with a comment proving it)
- [ ] `executeStrategyAction` is `nonReentrant` and the anti-theft check is unit-tested
- [ ] Deactivation is irreversible (test asserts `revert` on attempted reactivation)
- [ ] Admin/authority transfer is tested
- [ ] Inflation-attack mitigation in place (decimals offset or virtual assets)
- [ ] All custom errors use Solidity custom-error syntax (`error Foo()`), not `require` strings
- [ ] All external functions have NatSpec comments
- [ ] `script/Deploy.s.sol` deploys to Sepolia successfully and verifies on Etherscan

---

## 10. Implementation prompt sequence

If you're driving this with an AI coding assistant, give it these prompts in order. Don't combine — let each step settle and pass tests before moving on.

1. **Scaffold the repo.** `forge init erebor-evm`, install OpenZeppelin contracts, create the directory structure from §5, write `foundry.toml` and `.env.example`. Commit.
2. **Build `Vault.sol` minimal ERC-4626.** Asset, deposit/withdraw/mint/redeem, totalAssets, decimals offset for inflation protection. Add `VaultDeposit.t.sol` and `VaultWithdraw.t.sol`. All ERC-4626 compliance tests must pass.
3. **Add roles.** OpenZeppelin AccessControl, admin/authority. Tests for role transitions and revert paths.
4. **Add strategy storage and lifecycle.** `createStrategy`, `updateStrategyDelegate`, `setStrategyWeight`, `deactivateStrategy`. `VaultStrategy.t.sol`. Make sure deactivation is permanent.
5. **Add allocation tracking.** `allocateToStrategy`, `deallocateFromStrategy`. Update `totalAssets()` to include allocated funds. Tests for over/under allocation.
6. **Add rebalancing.** `rebalanceStrategy`, `reportYield`. `VaultRebalance.t.sol` covering top-up, pull-back, weight=0, weight=10000.
7. **Add action whitelist.** `addAllowedAction`, `removeAllowedAction`, `executeStrategyAction` with full validation chain from §4.1. `VaultActionWhitelist.t.sol` covering every revert path. Test with a `MockProtocol.sol` helper.
8. **Add anti-theft check.** Snapshot/diff balance pattern. Add a malicious mock that tries to route funds to `msg.sender` and verify the call reverts.
9. **Add re-entrancy guard.** OpenZeppelin `ReentrancyGuard`. Add a re-entrant mock that tries to call `deposit` from inside a strategy action and verify revert.
10. **Add events for everything.** Mirror the Solana program's event surface. Re-run all tests.
11. **Add `VaultFactory.sol`** if you want multi-asset / multi-vault support. Otherwise skip.
12. **Write integration tests.** Forked mainnet against Aave V3 USDC pool. End-to-end deposit → allocate → lend → time warp → withdraw → redeem flow.
13. **Write invariant tests.** Share price monotonicity, allocation accounting consistency.
14. **Write deploy scripts.** `Deploy.s.sol` for the vault, `InitVault.s.sol` for per-asset instances, `SetupStrategy.s.sol` for whitelisting actions.
15. **Run Slither.** Fix or annotate every finding.
16. **Deploy to Sepolia.** Verify on Etherscan. Smoke-test with a real wallet.
17. **Optional: build the agent and frontend** following §7 and §8.

---

## 11. What you must NOT change from the Solana design

These are load-bearing decisions that took multiple iterations on the Solana side. Don't relitigate them:

- **Delegate sandboxing.** The delegate must never get token approval. All movement goes through `executeStrategyAction`.
- **Permanent deactivation.** Once a strategy is deactivated, it stays deactivated. No reactivation, ever.
- **Admin / Authority separation.** They can be the same address by default, but the contract must support splitting them.
- **Anti-theft check.** The vault must verify that whitelisted calls don't reroute assets to the caller's own address.
- **One delegate per strategy.** If you want multi-agent strategies, create multiple strategies — don't add a delegate set per strategy.
- **Per-strategy whitelist.** Allowed actions are scoped to one strategy. Whitelisting Aave on strategy 0 must NOT allow strategy 1's delegate to call Aave.
- **Strategies are bookkeeping, not contracts.** Don't deploy a contract per strategy. Storage in `Vault.sol` is enough.

---

## 12. References

- **Solana source repo:** <https://github.com/xrave110/Erebor>
- **Reference instruction handlers:** `programs/my_project/src/instructions/` in the Solana repo — read these whenever you're unsure about validation logic or error semantics
- **Action whitelist deep dive:** the `execute_strategy_action.rs` handler is the canonical reference for the validation order
- **Live Solana app:** <https://ereborvault.netlify.app/> (devnet) — useful for understanding the user flow you're replicating
- **OpenZeppelin ERC-4626:** <https://docs.openzeppelin.com/contracts/5.x/erc4626>
- **Foundry Book:** <https://book.getfoundry.sh/>

---

## 13. License

MIT or BUSL-1.1 — match whatever the parent organization uses. The Solana reference is BUSL-1.1.
