# Kamino Looper Agent — Deferred Features

This file tracks features from [IMPLEMENTATION_SPEC_KAMINO_AGENT.md](IMPLEMENTATION_SPEC_KAMINO_AGENT.md) that were intentionally deferred from the MVP. The MVP implements: USDC-only single-iteration loops, basic HF check, and a simple decision engine.

---

## Strategy features

### 1. Multi-iteration leverage loops (>2x)
**Spec section:** 6.4 `leverageManager.ts`
**Current state:** `openUsdcLoop` only supports leverage 1.0–2.0 (single deposit + borrow + redeposit).
**TODO:** Implement iterative loops to reach 2.5x or 3.0x leverage. Each iteration borrows against the new collateral and redeposits. Need to compute optimal iteration count from target leverage and protocol LTV.

### 2. Cross-asset loops (BTC, SOL)
**Spec section:** 6.4 `leverageManager.ts`, 5 types
**Current state:** Only USDC loops are supported in `allocator.ts` and `leverageManager.ts`.
**TODO:** Extend `openLoop`/`closeLoop` to handle BTC and SOL. For cross-asset loops, the borrow side may need a Jupiter swap before redepositing.

### 3. Delta-neutral hedges
**Spec section:** 6.5 `hedgeManager.ts`
**Current state:** Not implemented. `mock_jupiter` program is deployed but the agent never calls it.
**TODO:** Implement `openHedge`/`closeHedge`/`resizeHedge`. A hedge means: borrow the volatile asset against USDC collateral, swap to USDC via Jupiter. This neutralizes price exposure on the volatile loop.

### 4. Delta-neutral allocation logic
**Spec section:** 6.3 `allocator.ts` (the 70/30 decision engine)
**Current state:** Allocator only considers USDC loops. No 70/30 stable/volatile split.
**TODO:** Implement `decideAllocation` with stable/volatile bucket logic, DN entry/exit premium, and capacity checks.

### 5. Hysteresis filters
**Spec section:** 6.7 `hysteresis.ts`
**Current state:** No hysteresis. Every cycle re-evaluates from scratch.
**TODO:** Implement `applyHysteresis` with three filters: APY change (`APY_HYSTERESIS_PCT`), allocation drift (`ALLOCATION_HYSTERESIS_PCT`), and leverage drift (`LEVERAGE_HYSTERESIS`). Safety actions must bypass hysteresis.

### 6. Health monitor with shock simulation
**Spec section:** 6.6 `healthMonitor.ts`
**Current state:** Basic HF check only (`hf < hfWarning` → emergency deleverage).
**TODO:**
- `classifyHealthLevel` returning comfortable/cautious/warning/emergency
- `simulateHealthAfterShock` to model HF after a 15% price drop
- `partialDeleverage` to reduce highest-leverage position by 0.5x
- Use simulated HF when picking leverage (must stay >= 1.8 after shock)

### 7. Reward harvester
**Spec section:** 6.8 `rewardHarvester.ts`
**Current state:** Not implemented.
**TODO:** Query Kamino for claimable rewards, claim via `execute_strategy_action`, swap to USDC via Jupiter, redeposit. Skip dust below `REWARD_MIN_VALUE_USD`. Note: `mock_kamino` doesn't have a rewards system yet — would need to extend the program.

### 8. APY scanner — leverage range
**Spec section:** 6.2 `apyScanner.ts`
**Current state:** Loops from 1.5x to maxLeverage in 0.5x steps.
**TODO:** Spec says step from 2.0 to 3.0 in 0.5 steps. Currently we start at 1.5. Reconcile with spec or document the deviation.

### 9. Switch asset action
**Spec section:** 5 types `EvalResult.action`
**Current state:** `EvalAction` doesn't include `SWITCH_ASSET`.
**TODO:** When best asset changes (e.g., BTC loop becomes more attractive than USDC), close the current loop and open the new one in a single decision.

---

## Operational features

### 10. DRY_RUN mode
**Spec section:** 12.3 Simulation
**Current state:** `config.dryRun` exists and `mainLoop` checks it before executing actions, but it's not fully tested. All read paths execute normally.
**TODO:** Verify dry-run produces a complete execution log without side effects. Add explicit `[DRY RUN]` markers to all decision logs.

### 11. Structured logging with pino
**Spec section:** 5 types `LogEvent`, 4 deps
**Current state:** Plain `console.log` everywhere. `pino` is in `package.json` but not used.
**TODO:** Replace `console.log` with `pino` logger emitting structured JSON events that match the `LogEvent` discriminated union from the spec (`LOOP_OPENED`, `LOOP_CLOSED`, `HEDGE_OPENED`, `EVAL_CYCLE_START`, etc.).

### 12. RPC retry with exponential backoff
**Spec section:** 11 Error Handling
**Current state:** No retry logic. RPC failures bubble up and skip the cycle.
**TODO:** Wrap connection calls in a retry helper with 3 attempts and 1s/2s/4s backoff.

### 13. Slippage retry on swaps
**Spec section:** 11 Error Handling
**Current state:** N/A (no swaps in agent yet).
**TODO:** When implementing hedges/rewards, retry slippage failures with 50% larger slippage up to 2%.

### 14. Per-cycle action counter for logs
**Spec section:** 6.1 `mainLoop.ts`
**Current state:** Cycle counter exists but `actionsTaken` isn't tracked per cycle.
**TODO:** Track and log how many actions were taken per cycle in `EVAL_CYCLE_END`.

### 15. Health factor read failure handling
**Spec section:** 11 Error Handling
**Current state:** If oracle fetch fails, cycle skips silently.
**TODO:** Treat HF read failure as emergency — do NOT open new positions; attempt deleverage if positions exist.

---

## Mock program limitations

### 16. mock_kamino — interest accrual on interactions
**Current state:** `accrue_yield` is admin/crank only. Borrowed amounts don't grow over time on-chain.
**TODO (optional):** Track `last_update_slot` on Obligation and accrue compound interest on every deposit/withdraw/borrow/repay. More realistic but more complex.

### 17. mock_kamino — utilization-based rates
**Current state:** Reserve APYs are fixed (set on `initialize_reserve`).
**TODO (optional):** Compute `supply_apy` and `borrow_apy` from `total_borrowed / total_supplied` using a kink model.

### 18. mock_kamino — rewards system
**Current state:** No claim_rewards instruction.
**TODO:** Add a Reward PDA per (mint, strategy) tracking accrued reward tokens. Add `claim_rewards` instruction. Required for the reward harvester (#7).

### 19. mock_jupiter — Jupiter API mock
**Current state:** The on-chain swap works but there's no off-chain "quote" API. Real Jupiter has a quote endpoint that returns expected output and route info.
**TODO:** When the agent needs to integrate, either compute expected output client-side (using the same formula as the program) or stub a quote function in `chain/jupiter.ts`.

---

## Out of scope (per spec section 14)

These are explicitly out of scope for v1 — listed here so they're not accidentally implemented:

- Multiple Kamino markets (single market only)
- DEX LP positions
- Cross-protocol routing (no Drift, MarginFi, etc.)
- Multi-strategy coordination
- Per-action on-chain parameter constraints (Erebor roadmap item)
- Web UI / API server
- Automatic vault deposit/withdrawal (users handle this separately)
