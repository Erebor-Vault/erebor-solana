// monitor.ts — Main polling loop that drives the agent's decision cycle.
//
// This module implements the core agent loop:
//   1. Read on-chain state (strategy account + token balance)
//   2. Apply hard rules (no LLM needed): deactivation → withdraw all, signal file → withdraw
//   3. Detect state changes (balance delta from previous cycle)
//   4. If state changed → ask Claude Sonnet for a decision
//      If routine (no change) → every 10th cycle, ask Claude Haiku to re-evaluate yield
//   5. Execute the decision via the protocol adapter (mock or real Lulo)
//   6. Update tracking state and wait for next cycle
//
// Error handling: individual poll cycle failures increment a counter.
// After MAX_RETRIES consecutive failures, the loop enters a 60-second cooldown
// before resuming. This prevents rapid-fire failing calls that waste resources.

import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";
import type { MyProject } from "../../target/types/my_project.js";
import type {
  AgentConfig,
  LuloProtocol,
  MonitorState,
  StrategySnapshot,
  WithdrawSignal,
} from "./types.js";
import { fetchStrategy, fetchTokenBalance } from "./vault-client.js";
import { LLMAdvisor } from "./llm-advisor.js";

// Starts the infinite polling loop. This function never returns under normal operation.
// It catches errors per-cycle and implements backoff logic for consecutive failures.
export async function startMonitorLoop(
  program: Program<MyProject>,
  connection: Connection,
  config: AgentConfig,
  strategyPda: PublicKey,       // this agent's strategy PDA
  strategyTokenPda: PublicKey,  // the strategy's SPL token account PDA
  protocol: LuloProtocol,      // mock or real Lulo adapter
  advisor: LLMAdvisor           // Claude LLM decision engine
): Promise<void> {
  // Mutable state that persists across polling cycles (in-memory only).
  // lastBalance starts at -1 to indicate "first run" (no previous data).
  const state: MonitorState = {
    lastBalance: -1,
    lastDecisionTime: 0,
    consecutiveErrors: 0,
    routineCycleCount: 0,
    lastSnapshot: null,
  };

  console.log("Monitor loop started. Polling every", config.pollIntervalMs / 1000, "seconds.\n");

  // Infinite loop — runs until process exit (SIGINT, SIGTERM, or strategy deactivation).
  while (true) {
    try {
      await pollCycle(
        program,
        connection,
        config,
        strategyPda,
        strategyTokenPda,
        protocol,
        advisor,
        state
      );
      state.consecutiveErrors = 0; // reset on success
    } catch (error) {
      state.consecutiveErrors++;
      console.error(
        `[ERROR] Poll cycle failed (${state.consecutiveErrors}/${config.maxRetries}):`,
        error
      );

      // After too many consecutive failures, cool down for 60 seconds.
      // This handles scenarios like RPC provider outages or rate limiting.
      if (state.consecutiveErrors >= config.maxRetries) {
        console.error("[ERROR] Too many failures, cooling down for 60s...");
        await sleep(60_000);
        state.consecutiveErrors = 0;
      }
    }

    await sleep(config.pollIntervalMs);
  }
}

// Executes a single polling cycle. Called every POLL_INTERVAL_MS.
async function pollCycle(
  program: Program<MyProject>,
  connection: Connection,
  config: AgentConfig,
  strategyPda: PublicKey,
  strategyTokenPda: PublicKey,
  protocol: LuloProtocol,
  advisor: LLMAdvisor,
  state: MonitorState
): Promise<void> {
  const now = new Date();
  console.log(`--- ${now.toISOString()} ---`);

  // ── Step 1: Read on-chain state ──────────────────────────────────────────
  // Fetch the strategy account (metadata) and the actual token balance.
  // These are independent RPC calls to the Solana validator.
  const strategy = await fetchStrategy(program, strategyPda);
  const tokenBalance = await fetchTokenBalance(connection, strategyTokenPda);

  const snapshot: StrategySnapshot = {
    allocatedAmount: (strategy as any).allocatedAmount.toNumber(),
    tokenBalance,
    isActive: strategy.isActive,
    timestamp: Date.now(),
  };

  // ── Step 2: Hard rules (no LLM needed) ────────────────────────────────────
  // These take priority over any LLM decision and execute immediately.

  // HARD RULE: Strategy deactivated → withdraw all from lending protocol and exit.
  // Deactivation is permanent (set by admin via deactivate_strategy).
  // The agent has no purpose once its strategy is inactive.
  if (!snapshot.isActive) {
    console.log("  Strategy DEACTIVATED. Withdrawing all from protocol...");
    const lentBalance = await protocol.getLentBalance();
    if (lentBalance > 0) {
      await protocol.execute({ action: "WITHDRAW", amount: lentBalance });
    }
    console.log("  Agent shutting down — strategy is permanently inactive.");
    process.exit(0);
  }

  // HARD RULE: Withdrawal signal file from the vault authority.
  // The authority creates a JSON file to tell the agent to withdraw a specific amount.
  // This enables the authority to coordinate: withdraw from Lulo → deallocate → user withdraws.
  const signal = readWithdrawSignal(config.withdrawSignalPath);
  if (signal) {
    console.log(
      `  Withdraw signal detected: ${(signal.amount / 1e6).toFixed(2)} USDC (requested by ${signal.requestedBy})`
    );
    await protocol.execute({ action: "WITHDRAW", amount: signal.amount });
    // Delete the signal file after processing to prevent re-execution.
    deleteWithdrawSignal(config.withdrawSignalPath);
    state.lastBalance = tokenBalance;
    state.lastSnapshot = snapshot;
    return;
  }

  // ── Step 3: Detect state changes ──────────────────────────────────────────
  // Compare current balance to previous cycle. A balance change means:
  // - The authority allocated more funds (positive delta)
  // - The authority deallocated funds (negative delta)
  // - Yield was reported (positive delta, smaller magnitude)
  const isFirstRun = state.lastBalance === -1;
  const balanceDelta = isFirstRun ? 0 : tokenBalance - state.lastBalance;
  const stateChanged = isFirstRun || balanceDelta !== 0;

  // Fetch current yield and lent balance from the protocol adapter.
  const yieldRate = await protocol.getCurrentYield();
  const lentBalance = await protocol.getLentBalance();

  console.log(
    `  Balance: ${(tokenBalance / 1e6).toFixed(2)} USDC | Lent: ${(lentBalance / 1e6).toFixed(2)} USDC | Yield: ${(yieldRate * 100).toFixed(2)}% APY${
      balanceDelta !== 0 ? ` | Delta: ${balanceDelta >= 0 ? "+" : ""}${(balanceDelta / 1e6).toFixed(2)}` : ""
    }`
  );

  // ── Step 4: LLM Decision ──────────────────────────────────────────────────
  // Only consult the LLM when something meaningful happened:
  // - State changed: new funds, balance delta, first run
  // - Routine re-evaluation: every 10th cycle with no changes (re-check yield)
  let shouldConsult = false;

  if (stateChanged) {
    shouldConsult = true;
  } else {
    state.routineCycleCount++;
    // Every 10th routine cycle (~20 minutes at 2-min intervals), re-evaluate
    // yield conditions using the cheaper Haiku model.
    if (state.routineCycleCount >= 10) {
      shouldConsult = true;
      state.routineCycleCount = 0;
    }
  }

  // Model selection: use Sonnet only when the balance change exceeds 250 USDC
  // (250_000_000 micro-USDC). Large allocations from the authority deserve
  // deeper reasoning. Everything else (yield accrual, small changes, routine
  // checks) uses Haiku — cheaper and fast enough for simple decisions.
  const SONNET_THRESHOLD = 250_000_000; // 250 USDC in micro-USDC
  const useSonnet = stateChanged && Math.abs(balanceDelta) >= SONNET_THRESHOLD;

  if (shouldConsult) {
    const decision = await advisor.getDecision(
      snapshot,
      state.lastSnapshot,
      yieldRate,
      lentBalance,
      useSonnet
    );

    if (decision.action === "LEND") {
      // Safety: cap the lend amount at the idle balance (tokens not already lent).
      // This prevents the LLM from accidentally trying to lend more than available.
      const idleBalance = tokenBalance - lentBalance;
      const amount = Math.min(decision.amount, idleBalance);
      if (amount >= config.minLendAmount) {
        await protocol.execute({ action: "LEND", amount });
      } else {
        console.log(
          `  Skipping LEND — amount ${(amount / 1e6).toFixed(2)} below minimum ${(config.minLendAmount / 1e6).toFixed(2)}`
        );
      }
    } else if (decision.action === "WITHDRAW") {
      // Safety: cap the withdraw amount at the lent balance.
      const amount = Math.min(decision.amount, lentBalance);
      if (amount > 0) {
        await protocol.execute({ action: "WITHDRAW", amount });
      } else {
        console.log("  Skipping WITHDRAW — nothing lent");
      }
    }
    // HOLD: do nothing, just log (already logged by the advisor)
  } else {
    console.log("  No changes — holding.");
  }

  // ── Step 5: Update tracking state ─────────────────────────────────────────
  state.lastBalance = tokenBalance;
  state.lastSnapshot = snapshot;
}

// =============================================================================
// WITHDRAWAL SIGNAL FILE
// The vault authority coordinates withdrawals by writing a JSON file:
//   { "amount": 5000000, "requestedAt": "2026-04-06T...", "requestedBy": "admin" }
// The agent reads it, withdraws from Lulo, and deletes the file.
// =============================================================================

// Reads and validates the withdrawal signal file. Returns null if not found or invalid.
function readWithdrawSignal(path: string): WithdrawSignal | null {
  try {
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, "utf-8");
    const signal = JSON.parse(raw) as WithdrawSignal;
    if (typeof signal.amount !== "number" || signal.amount <= 0) return null;
    return signal;
  } catch {
    return null;
  }
}

// Deletes the signal file after it's been processed.
// Silently handles the case where it's already gone.
function deleteWithdrawSignal(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // File already deleted or doesn't exist — not an error
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
