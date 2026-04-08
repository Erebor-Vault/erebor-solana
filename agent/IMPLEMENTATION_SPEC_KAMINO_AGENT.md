# Kamino Looping Agent — Implementation Specification

> **Purpose of this document:** This is the complete specification for an AI coding agent to implement the Kamino Looping Agent. Every section is structured as actionable instructions. If something is not specified here, make a reasonable choice and document it in a `DECISIONS.md` file.

---

## 1. System Summary

Build a TypeScript/Node.js agent that runs as a long-lived process on a server. Every 5 minutes it:

1. Reads on-chain state (Kamino positions, APYs, health factor)
2. Decides whether to open/close/adjust leveraged lending loops
3. Executes transactions on Solana via the Erebor vault's `execute_strategy_action` CPI

The agent is a **delegate** on one Erebor vault strategy slot. It cannot move funds freely — every on-chain action is a CPI routed through the vault program, constrained to a whitelist of allowed (program, instruction) pairs.

---

## 2. Tech Stack & Dependencies

```
Runtime:           Node.js / Bun
Language:          TypeScript (strict mode)
Solana SDK:        @solana/web3.js ^1.95
Anchor:            @coral-xyz/anchor ^0.32.1
Kamino SDK:        @kamino-finance/klend-sdk
Jupiter SDK:       @jup-ag/api
Agent framework:   solana-agent-kit (v2.0) + Anthropic Claude
Logging:           pino (structured JSON logs)
Config:            .env file + typed config module
```

Install all dependencies via `bun install`. Do not use yarn or npm.

---

## 3. Project Structure

Create the following file structure inside an `agent/` directory:

```
agent/
├── src/
│   ├── index.ts                  # Entry point: load config, start main loop
│   ├── config.ts                 # Environment variables + typed constants
│   ├── types.ts                  # All shared TypeScript types and interfaces
│   ├── loop/
│   │   ├── mainLoop.ts           # 5-minute eval cycle orchestrator
│   │   └── hysteresis.ts         # Hysteresis filter logic
│   ├── chain/
│   │   ├── kamino.ts             # Read Kamino state: APYs, positions, HF
│   │   ├── jupiter.ts            # Build swap transactions via Jupiter API
│   │   ├── vault.ts              # Build execute_strategy_action transactions
│   │   └── transactions.ts       # Sign, send, confirm transactions
│   ├── strategy/
│   │   ├── apyScanner.ts         # Fetch and compute net loop APYs
│   │   ├── allocator.ts          # 70/30 split decision engine
│   │   ├── leverageManager.ts    # Open/close/adjust loops
│   │   ├── hedgeManager.ts       # Delta-neutral hedge open/close/resize
│   │   ├── healthMonitor.ts      # Health factor checks + emergency deleverage
│   │   └── rewardHarvester.ts    # Claim + swap incentive tokens
│   └── utils/
│       ├── logger.ts             # Pino logger setup with structured events
│       └── math.ts               # BPS, leverage, APY calculations
├── .env.example                  # Template for required env vars
├── package.json
├── tsconfig.json
└── DECISIONS.md                  # Log of implementation decisions not covered by spec
```

---

## 4. Configuration (`config.ts`)

Define a single exported `Config` object loaded from environment variables. Fail fast on startup if any required variable is missing.

### 4.1 Environment Variables

```env
# Required
SOLANA_RPC_URL=                   # Solana RPC endpoint (helius, triton, etc.)
AGENT_KEYPAIR_PATH=               # Path to delegate keypair JSON file
VAULT_PROGRAM_ID=                 # Erebor vault program ID
VAULT_STATE_ADDRESS=              # Vault state PDA address
STRATEGY_INDEX=                   # This agent's strategy index (0-based)
KAMINO_MARKET_ADDRESS=            # Kamino lending market to operate on
CLUSTER=devnet                    # devnet | mainnet-beta

# Optional (defaults shown)
EVAL_INTERVAL_MS=300000           # 5 minutes
MAX_LEVERAGE=3.0
TARGET_LEVERAGE_MIN=2.0
TARGET_LEVERAGE_MAX=2.5
STABLE_TARGET_PCT=70
MIN_LOOP_NET_APY_PCT=1.5
DN_ENTRY_PREMIUM_PCT=10
DN_EXIT_PREMIUM_PCT=5
APY_HYSTERESIS_PCT=0.5
ALLOCATION_HYSTERESIS_PCT=3
LEVERAGE_HYSTERESIS=0.2
HF_COMFORTABLE=1.8
HF_WARNING=1.3
PRICE_SHOCK_BUFFER_PCT=15
REWARD_MIN_VALUE_USD=1.0
SWAP_MAX_SLIPPAGE_BPS=100
```

### 4.2 Config Type

```typescript
export interface Config {
  rpcUrl: string;
  agentKeypair: Keypair;
  vaultProgramId: PublicKey;
  vaultStateAddress: PublicKey;
  strategyIndex: number;
  kaminoMarketAddress: PublicKey;
  cluster: "devnet" | "mainnet-beta";

  evalIntervalMs: number;
  maxLeverage: number;
  targetLeverageMin: number;
  targetLeverageMax: number;
  stableTargetPct: number;          // 70
  volatileMaxPct: number;           // 30 (derived: 100 - stableTargetPct)
  minLoopNetApyPct: number;         // 1.5
  dnEntryPremiumPct: number;        // 10 (relative %)
  dnExitPremiumPct: number;         // 5  (relative %)
  apyHysteresisPct: number;         // 0.5 (absolute %)
  allocationHysteresisPct: number;  // 3
  leverageHysteresis: number;       // 0.2
  hfComfortable: number;            // 1.8
  hfWarning: number;                // 1.3
  priceShockBufferPct: number;      // 15
  rewardMinValueUsd: number;        // 1.0
  swapMaxSlippageBps: number;       // 100
}
```

---

## 5. Types (`types.ts`)

Define these types. All other modules import from here.

```typescript
export type Asset = "USDC" | "BTC" | "SOL";

export interface AssetMints {
  USDC: PublicKey;
  BTC: PublicKey;   // wBTC on Solana
  SOL: PublicKey;   // native SOL or wrapped SOL
}

export interface ApyData {
  asset: Asset;
  supplyApy: number;   // annualized, e.g. 0.06 = 6%
  borrowApy: number;
}

export interface LoopApyResult {
  asset: Asset;
  leverage: number;          // e.g. 2.5
  netApy: number;            // after leverage
  rawSupplyApy: number;
  rawBorrowApy: number;
}

export interface DeltaNeutralApyResult {
  volatileAsset: Asset;      // BTC or SOL
  loopNetApy: number;        // on the volatile side
  hedgeCostApy: number;      // USDC lend APY - volatile borrow APY (can be negative = cost)
  combinedApy: number;       // loopNetApy + hedgeCostApy
  leverage: number;
}

export interface PortfolioState {
  totalValueUsd: number;
  stableBucketUsd: number;
  volatileBucketUsd: number;
  stablePct: number;
  volatilePct: number;
  activeLoops: ActiveLoop[];
  activeHedges: ActiveHedge[];
  healthFactor: number;
}

export interface ActiveLoop {
  asset: Asset;
  suppliedAmount: number;     // in asset units
  borrowedAmount: number;
  leverage: number;
  currentNetApy: number;
}

export interface ActiveHedge {
  volatileAsset: Asset;       // what is being hedged
  usdcLent: number;
  volatileBorrowed: number;
  hedgeCostApy: number;
}

export type HealthLevel = "comfortable" | "cautious" | "warning" | "emergency";

export interface EvalResult {
  action: "NONE" | "OPEN_LOOP" | "CLOSE_LOOP" | "ADJUST_LEVERAGE" |
          "OPEN_HEDGE" | "CLOSE_HEDGE" | "RESIZE_HEDGE" |
          "EMERGENCY_DELEVERAGE" | "HARVEST_REWARDS" | "SWITCH_ASSET";
  details: Record<string, unknown>;
}

// Structured log events — every log line must use one of these
export type LogEvent =
  | { event: "LOOP_OPENED";           asset: Asset; leverage: number; supplyApy: number; borrowApy: number; netApy: number; amountUsd: number }
  | { event: "LOOP_CLOSED";           asset: Asset; reason: "apy_drop" | "rebalance" | "emergency" | "switch_asset"; pnlEstimateUsd: number }
  | { event: "HEDGE_OPENED";          volatileAsset: Asset; usdcLent: number; volatileBorrowed: number; hedgeCostApy: number }
  | { event: "HEDGE_CLOSED";          volatileAsset: Asset; reason: string }
  | { event: "REBALANCE_SKIPPED";     reason: string; currentVsTarget: Record<string, number> }
  | { event: "HEALTH_FACTOR_WARNING"; currentHf: number; level: HealthLevel; actionTaken: string }
  | { event: "APY_SCAN";              timestamp: number; usdcLoopApy: number; btcLoopApy: number; solLoopApy: number }
  | { event: "REWARDS_CLAIMED";       tokenMint: string; amountClaimed: number; usdcReceived: number }
  | { event: "EVAL_CYCLE_START";      cycle: number; timestamp: number }
  | { event: "EVAL_CYCLE_END";        cycle: number; durationMs: number; actionsTaken: number }
  | { event: "ERROR";                 module: string; message: string; stack?: string };
```

---

## 6. Module Specifications

### 6.1 `mainLoop.ts` — Orchestrator

```
FUNCTION startMainLoop(config: Config): void

  cycle = 0

  EVERY config.evalIntervalMs:
    cycle++
    LOG { event: "EVAL_CYCLE_START", cycle, timestamp: now }
    startTime = now

    TRY:
      // Step 1: Safety first
      portfolio = await readPortfolioState(config)
      healthLevel = classifyHealthLevel(portfolio.healthFactor, config)

      IF healthLevel == "emergency":
        await emergencyDeleverage(config, portfolio)
        CONTINUE to next cycle

      IF healthLevel == "warning":
        await partialDeleverage(config, portfolio)
        // continue to APY scan — may still adjust other positions

      // Step 2: Scan APYs
      apyData = await scanApys(config)
      loopApys = computeAllLoopApys(apyData, config)
      dnApys = computeDeltaNeutralApys(apyData, loopApys, config)

      // Step 3: Harvest rewards (independent of other decisions)
      await harvestRewardsIfAvailable(config)

      // Step 4: Decide allocation
      decision = decideAllocation(portfolio, loopApys, dnApys, config)

      // Step 5: Apply hysteresis — may downgrade decision to NONE
      filteredDecision = applyHysteresis(decision, portfolio, previousState, config)

      // Step 6: Execute
      IF filteredDecision.action != "NONE":
        await executeDecision(filteredDecision, config)

      previousState = portfolio

    CATCH error:
      LOG { event: "ERROR", module: "mainLoop", message: error.message }

    LOG { event: "EVAL_CYCLE_END", cycle, durationMs: now - startTime, actionsTaken: ... }
```

### 6.2 `apyScanner.ts`

```
FUNCTION scanApys(config: Config): Promise<ApyData[]>

  Use @kamino-finance/klend-sdk to fetch reserve data for USDC, BTC, SOL
  from config.kaminoMarketAddress.

  For each asset, extract:
    - supplyApy (annualized)
    - borrowApy (annualized)

  RETURN array of ApyData

FUNCTION computeAllLoopApys(apyData: ApyData[], config: Config): LoopApyResult[]

  For each asset in apyData:
    For leverage in [2.0, 2.5, 3.0] (up to config.maxLeverage, step 0.5):
      netApy = (supplyApy * leverage) - (borrowApy * (leverage - 1))
      IF netApy >= config.minLoopNetApyPct / 100:
        add to results

  RETURN results sorted by netApy descending

FUNCTION computeDeltaNeutralApys(
  apyData: ApyData[],
  loopApys: LoopApyResult[],
  config: Config
): DeltaNeutralApyResult[]

  usdcSupplyApy = apyData.find(USDC).supplyApy

  For each volatile asset loop in loopApys where asset != USDC:
    volatileBorrowApy = apyData.find(loop.asset).borrowApy
    hedgeCostApy = usdcSupplyApy - volatileBorrowApy
    combinedApy = loop.netApy + hedgeCostApy

    add DeltaNeutralApyResult to results

  RETURN results sorted by combinedApy descending
```

### 6.3 `allocator.ts` — The 70/30 Decision Engine

```
FUNCTION decideAllocation(
  portfolio: PortfolioState,
  loopApys: LoopApyResult[],
  dnApys: DeltaNeutralApyResult[],
  config: Config
): EvalResult

  bestUsdcLoop = loopApys.find(asset == USDC, highest netApy)
  bestDnCombo = dnApys[0]  // highest combinedApy

  // If no loop meets minimum threshold → just single-side lend USDC
  IF bestUsdcLoop is null:
    IF portfolio has active loops:
      RETURN { action: "CLOSE_LOOP", details: { reason: "below_min_apy", fallback: "single_side_lend" } }
    ELSE:
      RETURN { action: "NONE" }

  // Determine if delta-neutral is worth it
  usdcLoopApy = bestUsdcLoop.netApy
  dnWorthIt = false

  IF bestDnCombo exists:
    relativePremium = (bestDnCombo.combinedApy - usdcLoopApy) / usdcLoopApy * 100

    IF portfolio has NO active volatile position:
      dnWorthIt = relativePremium >= config.dnEntryPremiumPct          // 10% to enter
    ELSE:
      dnWorthIt = relativePremium >= config.dnExitPremiumPct           // 5% to stay (hysteresis)

  // Check volatile bucket capacity
  currentVolatilePct = portfolio.volatilePct
  volatileCapAvailable = currentVolatilePct < config.volatileMaxPct    // under 30%

  // Decision tree:
  IF dnWorthIt AND volatileCapAvailable:
    RETURN open/adjust volatile loop + hedge
  ELSE IF portfolio has active volatile position AND NOT dnWorthIt:
    RETURN close volatile loop + hedge, move to USDC loop
  ELSE:
    RETURN open/adjust USDC loop for stable bucket

  // For each bucket, pick optimal leverage within [targetMin, targetMax]
  // that keeps simulated HF >= hfComfortable after config.priceShockBufferPct shock
```

**Important implementation detail for the allocator:**

When the agent has no positions and starts fresh, execution order is:
1. Open USDC loop with 70% of funds (stable bucket)
2. If delta-neutral is profitable, open volatile loop with up to 30% of funds + open hedge using part of the stable USDC lend position

### 6.4 `leverageManager.ts`

```
FUNCTION openLoop(asset: Asset, amount: number, targetLeverage: number, config: Config): Promise<void>

  // Execute iterative loop via vault CPI:
  // Iteration 1: supply `amount` of asset to Kamino
  // Iteration 2: borrow (amount * (1 - 1/LTV)) of same asset, supply again
  // Repeat until targetLeverage reached
  //
  // Each step is one execute_strategy_action call:
  //   Step A: Kamino deposit (supply)
  //   Step B: Kamino borrow
  //   Step C: If cross-asset, Jupiter swap borrowed → supply asset
  //   Step D: Kamino deposit (re-supply)
  //
  // Track total supplied and total borrowed to calculate actual leverage

  LOG { event: "LOOP_OPENED", ... }

FUNCTION closeLoop(asset: Asset, config: Config): Promise<void>

  // Reverse the loop:
  // 1. Withdraw some collateral
  // 2. Repay some debt
  // Repeat until fully unwound
  // If cross-asset: swap supply asset → borrow asset before repaying

  LOG { event: "LOOP_CLOSED", ... }

FUNCTION adjustLeverage(asset: Asset, currentLev: number, targetLev: number, config: Config): Promise<void>

  IF targetLev > currentLev:
    // Borrow more, supply more (partial loop iteration)
  ELSE:
    // Withdraw some, repay some (partial unwind)
```

### 6.5 `hedgeManager.ts`

```
FUNCTION openHedge(volatileAsset: Asset, exposureAmount: number, config: Config): Promise<void>

  // 1. Already have USDC supplied in Kamino (from stable bucket)
  // 2. Borrow `volatileAsset` against USDC collateral
  //    Amount to borrow = exposureAmount (matching the volatile loop's collateral value)
  // 3. Swap borrowed volatile → USDC via Jupiter
  //    (USDC proceeds stay in strategy or get re-supplied)

  // All 3 steps go through execute_strategy_action:
  //   Step 1: Kamino borrow(volatileAsset, amount)
  //   Step 2: Jupiter swap(volatileAsset → USDC)
  //   Step 3: Kamino deposit(USDC, swapProceeds)  [optional: re-lend the USDC]

  LOG { event: "HEDGE_OPENED", ... }

FUNCTION closeHedge(volatileAsset: Asset, config: Config): Promise<void>

  // Reverse:
  // 1. Withdraw some USDC from Kamino
  // 2. Swap USDC → volatileAsset via Jupiter
  // 3. Repay volatileAsset debt on Kamino

  LOG { event: "HEDGE_CLOSED", ... }

FUNCTION resizeHedge(volatileAsset: Asset, currentExposure: number, newExposure: number, config: Config): Promise<void>

  diff = newExposure - currentExposure
  IF diff > 0: openHedge(volatileAsset, diff, config)     // increase
  ELSE:        partialCloseHedge(volatileAsset, -diff, config)  // decrease
```

### 6.6 `healthMonitor.ts`

```
FUNCTION classifyHealthLevel(hf: number, config: Config): HealthLevel

  IF hf >= config.hfComfortable:   RETURN "comfortable"     // >= 1.8
  IF hf >= 1.5:                    RETURN "cautious"         // 1.5 – 1.8
  IF hf >= config.hfWarning:       RETURN "warning"          // 1.3 – 1.5
  RETURN "emergency"                                         // < 1.3

FUNCTION simulateHealthAfterShock(portfolio: PortfolioState, shockPct: number): number

  // For each volatile position (BTC, SOL):
  //   Reduce collateral value by shockPct
  //   Increase debt value by shockPct (if borrow is volatile)
  //   Recompute health factor
  // USDC positions are unaffected by price shock

  RETURN simulatedHf

FUNCTION emergencyDeleverage(config: Config, portfolio: PortfolioState): Promise<void>

  // Priority order:
  // 1. Close all volatile loops (highest risk first)
  // 2. Close all hedges
  // 3. Reduce USDC loop leverage to 1.0 (single-side lend)

  LOG { event: "HEALTH_FACTOR_WARNING", level: "emergency", ... }

FUNCTION partialDeleverage(config: Config, portfolio: PortfolioState): Promise<void>

  // Reduce leverage on highest-leverage position by 0.5x
  // Repeat until simulated HF >= config.hfComfortable

  LOG { event: "HEALTH_FACTOR_WARNING", level: "warning", ... }
```

### 6.7 `hysteresis.ts`

```
FUNCTION applyHysteresis(
  decision: EvalResult,
  currentPortfolio: PortfolioState,
  previousPortfolio: PortfolioState | null,
  config: Config
): EvalResult

  // Override: safety actions ALWAYS pass through
  IF decision.action == "EMERGENCY_DELEVERAGE": RETURN decision

  // Filter 1: APY change too small
  IF decision is about APY-driven rebalance:
    apyDelta = |newNetApy - currentNetApy|
    IF apyDelta < config.apyHysteresisPct / 100:
      LOG { event: "REBALANCE_SKIPPED", reason: "apy_within_hysteresis" }
      RETURN { action: "NONE" }

  // Filter 2: Allocation drift too small
  IF decision is about allocation rebalance:
    driftPct = |currentPortfolio.stablePct - config.stableTargetPct|
    IF driftPct < config.allocationHysteresisPct:
      LOG { event: "REBALANCE_SKIPPED", reason: "allocation_within_hysteresis" }
      RETURN { action: "NONE" }

  // Filter 3: Leverage drift too small
  IF decision is about leverage adjustment:
    levDelta = |currentLeverage - targetLeverage|
    IF levDelta < config.leverageHysteresis:
      LOG { event: "REBALANCE_SKIPPED", reason: "leverage_within_hysteresis" }
      RETURN { action: "NONE" }

  RETURN decision
```

### 6.8 `rewardHarvester.ts`

```
FUNCTION harvestRewardsIfAvailable(config: Config): Promise<void>

  // 1. Query Kamino for claimable reward tokens on this obligation
  claimable = await getClaimableRewards(config)

  FOR EACH reward in claimable:
    estimatedUsd = reward.amount * reward.priceUsd

    IF estimatedUsd < config.rewardMinValueUsd:
      CONTINUE  // skip dust

    // 2. Claim via execute_strategy_action → Kamino claim_rewards
    await claimReward(reward, config)

    // 3. Swap to USDC via execute_strategy_action → Jupiter route
    usdcReceived = await swapToUsdc(reward.mint, reward.amount, config)

    // 4. Re-deposit USDC into Kamino supply
    await depositToKamino("USDC", usdcReceived, config)

    LOG { event: "REWARDS_CLAIMED", tokenMint: reward.mint, amountClaimed: reward.amount, usdcReceived }
```

### 6.9 `vault.ts` — Erebor CPI Builder

```
FUNCTION buildExecuteStrategyAction(
  config: Config,
  targetProgramId: PublicKey,
  instructionData: Buffer,
  remainingAccounts: AccountMeta[]
): TransactionInstruction

  // Build the Anchor instruction for execute_strategy_action:
  //
  // Accounts (from Erebor IDL):
  //   - vault_state: config.vaultStateAddress
  //   - strategy: PDA derived from [vault_state, strategy_index]
  //   - strategy_token_account: ATA of strategy PDA for USDC mint
  //   - caller: config.agentKeypair.publicKey (delegate)
  //   - target_program: targetProgramId
  //   - system_program, token_program
  //   - ...remaining accounts required by target instruction
  //
  // Instruction data:
  //   Anchor discriminator for execute_strategy_action +
  //   serialized inner instruction data

  RETURN instruction
```

### 6.10 `kamino.ts` — On-Chain State Reader

```
FUNCTION readPortfolioState(config: Config): Promise<PortfolioState>

  // 1. Load Kamino market via klend-sdk
  // 2. Find obligation for this strategy's PDA
  // 3. Extract:
  //    - All deposit positions (asset, amount, value USD)
  //    - All borrow positions (asset, amount, value USD)
  //    - Health factor from obligation
  // 4. Classify into stable vs volatile bucket
  // 5. Compute leverage per position

  RETURN PortfolioState

FUNCTION getReserveApys(config: Config): Promise<ApyData[]>

  // Use klend-sdk to read reserve state for USDC, BTC, SOL
  // Extract supply APY and borrow APY from each reserve

  RETURN ApyData[]
```

### 6.11 `jupiter.ts`

```
FUNCTION buildSwapTransaction(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
  maxSlippageBps: number,
  config: Config
): Promise<{ instruction: TransactionInstruction; expectedOutput: number }>

  // 1. Call Jupiter Quote API: GET /quote?inputMint=...&outputMint=...&amount=...&slippageBps=...
  // 2. Call Jupiter Swap API: POST /swap with quoteResponse
  // 3. Deserialize the returned transaction to extract the swap instruction
  // 4. Return the instruction (will be wrapped in execute_strategy_action)

  RETURN { instruction, expectedOutput }
```

---

## 7. Transaction Execution (`transactions.ts`)

```
FUNCTION sendAndConfirm(
  instructions: TransactionInstruction[],
  config: Config
): Promise<string>

  // 1. Build VersionedTransaction with recent blockhash
  // 2. Sign with config.agentKeypair
  // 3. Send with { skipPreflight: false, maxRetries: 3 }
  // 4. Confirm with "confirmed" commitment
  // 5. If failure: log error, return null
  // 6. If success: return transaction signature

  RETURN txSignature
```

**Critical constraint:** Each `execute_strategy_action` CPI is one instruction. If a loop iteration requires supply + borrow + swap, that is 3 separate transactions (or 3 instructions in one transaction if the vault program supports it — check IDL). Do NOT assume they can be batched; build them sequentially and confirm each before the next.

---

## 8. Whitelisted Actions Reference

The vault admin must whitelist these (program, instruction_discriminator) pairs for this strategy before the agent can operate. Document the exact discriminators in `DECISIONS.md` after deriving them from the Kamino and Jupiter IDLs.

| Program | Instruction | Purpose |
|---|---|---|
| Kamino kLend | `deposit` | Supply collateral |
| Kamino kLend | `withdraw` | Redeem collateral |
| Kamino kLend | `borrow` | Take loan |
| Kamino kLend | `repay` | Repay loan |
| Kamino kLend | `refresh_reserve` | Update reserve state before operations |
| Kamino kLend | `refresh_obligation` | Update obligation state before operations |
| Kamino Rewards | `claim_rewards` | Claim incentive tokens |
| Jupiter v6 | `route` | Execute swap |
| Jupiter v6 | `shared_accounts_route` | Execute swap (shared accounts variant) |

---

## 9. Decision Logic Parameters

All parameters below must be configurable via `config.ts` (loaded from `.env`). The values shown are defaults.

| Parameter | Default | Type | Unit |
|---|---|---|---|
| `EVAL_INTERVAL_MS` | 300000 | integer | milliseconds |
| `MAX_LEVERAGE` | 3.0 | float | multiplier |
| `TARGET_LEVERAGE_MIN` | 2.0 | float | multiplier |
| `TARGET_LEVERAGE_MAX` | 2.5 | float | multiplier |
| `STABLE_TARGET_PCT` | 70 | integer | % of total funds |
| `MIN_LOOP_NET_APY_PCT` | 1.5 | float | % annualized |
| `DN_ENTRY_PREMIUM_PCT` | 10 | float | % relative to USDC loop APY |
| `DN_EXIT_PREMIUM_PCT` | 5 | float | % relative to USDC loop APY |
| `APY_HYSTERESIS_PCT` | 0.5 | float | % absolute |
| `ALLOCATION_HYSTERESIS_PCT` | 3 | float | % absolute |
| `LEVERAGE_HYSTERESIS` | 0.2 | float | leverage multiplier |
| `HF_COMFORTABLE` | 1.8 | float | health factor |
| `HF_WARNING` | 1.3 | float | health factor |
| `PRICE_SHOCK_BUFFER_PCT` | 15 | float | % price drop |
| `REWARD_MIN_VALUE_USD` | 1.0 | float | USD |
| `SWAP_MAX_SLIPPAGE_BPS` | 100 | integer | basis points (1%) |

---

## 10. Decision Flowchart

Implement this exact flow in `mainLoop.ts`. Every path must be covered.

```
┌─────────────────────────────────┐
│         EVAL CYCLE START        │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│   Read portfolio state + HF     │
└────────────┬────────────────────┘
             ▼
        ┌────────────┐
        │  HF < 1.3? │──YES──▶ EMERGENCY DELEVERAGE ──▶ END CYCLE
        └─────┬──────┘
              │ NO
              ▼
        ┌────────────┐
        │ HF < 1.5?  │──YES──▶ PARTIAL DELEVERAGE (then continue)
        └─────┬──────┘
              │ NO
              ▼
┌─────────────────────────────────┐
│   Scan APYs for USDC, BTC, SOL │
│   Compute net loop APYs         │
│   Compute delta-neutral APYs    │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│   Harvest rewards if available  │
└────────────┬────────────────────┘
             ▼
        ┌────────────────────┐
        │ Any loop ≥ 1.5%    │──NO──▶ Close all loops,
        │ net APY?           │        single-side lend USDC ──▶ END
        └─────┬──────────────┘
              │ YES
              ▼
┌─────────────────────────────────┐
│  Best USDC loop APY = U        │
│  Best DN combo APY = D         │
│  Relative premium = (D-U)/U    │
└────────────┬────────────────────┘
             ▼
        ┌───────────────────────────┐
        │ Volatile bucket < 30%     │
        │ AND premium ≥ entry (10%) │──YES──▶ Open/keep volatile loop
        │ OR (has position AND      │         + delta-neutral hedge
        │     premium ≥ exit (5%))  │         with up to 30% of funds
        └─────┬─────────────────────┘
              │ NO
              ▼
┌─────────────────────────────────┐
│  Close any volatile positions   │
│  Allocate 100% to USDC loop    │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  For chosen strategy:           │
│  Pick leverage in [2.0, 2.5]    │
│  that maximizes net APY         │
│  AND keeps simulated HF ≥ 1.8  │
│  after 15% price shock          │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  Apply hysteresis filters       │
│  (APY, allocation, leverage)    │
│  Skip if change < threshold     │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  Execute transactions           │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│         EVAL CYCLE END          │
└─────────────────────────────────┘
```

---

## 11. Error Handling

| Error Type | Handling |
|---|---|
| RPC timeout / failure | Retry up to 3 times with exponential backoff (1s, 2s, 4s). If all fail, skip cycle and log error. |
| Transaction failure | Log full error. If it's a slippage error on swap, retry with 50% larger slippage (up to 2%). If simulation fails, skip that action. |
| Health factor read failure | Treat as emergency — do NOT open new positions. Attempt deleverage if any positions exist. |
| Kamino SDK error | Log and skip cycle. Do not retry kamino reads more than twice. |
| Jupiter API unavailable | Skip any swap-dependent actions (hedging, reward harvesting). Continue with non-swap actions. |
| Invalid config on startup | `process.exit(1)` with clear error message naming the missing variable. |

---

## 12. Testing Strategy

### 12.1 Unit Tests

Write unit tests (vitest) for pure logic modules:

| Module | What to test |
|---|---|
| `apyScanner` | `computeAllLoopApys` returns correct net APY at various leverages. Edge: negative net APY. |
| `allocator` | Decision tree: USDC-only, DN entry, DN exit, no-loop fallback. Edge: all APYs below threshold. |
| `hysteresis` | Filters correctly suppress small changes. Edge: safety overrides hysteresis. |
| `healthMonitor` | `classifyHealthLevel` returns correct levels. `simulateHealthAfterShock` math is correct. |
| `math` | BPS conversions, leverage calculations. |

### 12.2 Integration Tests

Test against Solana devnet with a real Erebor vault and Kamino devnet deployment:

| Test | Description |
|---|---|
| Full cycle — no action | Agent reads state, decides no action needed, logs REBALANCE_SKIPPED |
| Open USDC loop | Agent supplies USDC, borrows USDC, re-supplies. Verify leverage ~2x. |
| Emergency deleverage | Manually set HF low (by withdrawing collateral externally), verify agent unwinds. |
| Reward harvest | If devnet has rewards, verify claim + swap + re-deposit flow. |

### 12.3 Simulation / Dry-Run Mode

Implement a `DRY_RUN=true` environment variable. When enabled:
- All read operations execute normally
- All write operations (transactions) are logged but NOT sent
- Log output shows exactly what would have been executed

---

## 13. Startup Sequence (`index.ts`)

```typescript
async function main() {
  // 1. Load and validate config (exit on failure)
  const config = loadConfig();

  // 2. Verify RPC connection
  const connection = new Connection(config.rpcUrl);
  await connection.getLatestBlockhash(); // will throw if RPC is down

  // 3. Verify vault state exists and strategy is active
  const vaultState = await fetchVaultState(connection, config);
  assert(vaultState.strategies[config.strategyIndex].isActive);

  // 4. Verify agent keypair matches strategy delegate
  const strategy = vaultState.strategies[config.strategyIndex];
  assert(strategy.delegate.equals(config.agentKeypair.publicKey));

  // 5. Read initial portfolio state
  const portfolio = await readPortfolioState(config);
  logger.info({ portfolio }, "Initial portfolio state");

  // 6. Start main loop
  startMainLoop(config);
}

main().catch((err) => {
  logger.fatal(err, "Agent failed to start");
  process.exit(1);
});
```

---

## 14. Out of Scope (v1)

Do NOT implement these. They are listed here to prevent scope creep:

- Multiple Kamino markets (agent targets a single market)
- DEX LP positions (only lending/borrowing loops)
- Cross-protocol routing (no Drift, MarginFi, etc.)
- Multi-strategy coordination (agent is independent)
- Per-action on-chain parameter constraints (Erebor roadmap item)
- Web UI or API server (agent is a headless process)
- Automatic vault deposit/withdrawal (users handle this separately)

---

## 15. Definition of Done

The implementation is complete when:

- [ ] All files in Section 3 exist and compile with `tsc --noEmit`
- [ ] Config loads from `.env` and fails fast on missing required vars
- [ ] Unit tests pass for all pure logic modules (Section 12.1)
- [ ] `DRY_RUN=true` mode executes a full eval cycle against devnet, logging all decisions without sending transactions
- [ ] At least one real devnet cycle completes: agent opens a USDC loop, logs the result, and the on-chain position is verifiable
- [ ] Structured JSON logs match the `LogEvent` type for every action
- [ ] `DECISIONS.md` documents any implementation choices not covered by this spec
- [ ] `README.md` in `agent/` documents how to configure and run the agent
