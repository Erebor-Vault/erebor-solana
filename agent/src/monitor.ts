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

export async function startMonitorLoop(
  program: Program<MyProject>,
  connection: Connection,
  config: AgentConfig,
  strategyPda: PublicKey,
  strategyTokenPda: PublicKey,
  protocol: LuloProtocol,
  advisor: LLMAdvisor
): Promise<void> {
  const state: MonitorState = {
    lastBalance: -1,
    lastDecisionTime: 0,
    consecutiveErrors: 0,
    routineCycleCount: 0,
    lastSnapshot: null,
  };

  console.log("Monitor loop started. Polling every", config.pollIntervalMs / 1000, "seconds.\n");

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
      state.consecutiveErrors = 0;
    } catch (error) {
      state.consecutiveErrors++;
      console.error(
        `[ERROR] Poll cycle failed (${state.consecutiveErrors}/${config.maxRetries}):`,
        error
      );

      if (state.consecutiveErrors >= config.maxRetries) {
        console.error("[ERROR] Too many failures, cooling down for 60s...");
        await sleep(60_000);
        state.consecutiveErrors = 0;
      }
    }

    await sleep(config.pollIntervalMs);
  }
}

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

  // 1. Read on-chain state
  const strategy = await fetchStrategy(program, strategyPda);
  const tokenBalance = await fetchTokenBalance(connection, strategyTokenPda);

  const snapshot: StrategySnapshot = {
    allocatedAmount: (strategy as any).allocatedAmount.toNumber(),
    tokenBalance,
    isActive: strategy.isActive,
    timestamp: Date.now(),
  };

  // 2. Hard rules (no LLM)

  // Strategy deactivated — withdraw everything and exit
  if (!snapshot.isActive) {
    console.log("  Strategy DEACTIVATED. Withdrawing all from protocol...");
    const lentBalance = await protocol.getLentBalance();
    if (lentBalance > 0) {
      await protocol.execute({ action: "WITHDRAW", amount: lentBalance });
    }
    console.log("  Agent shutting down — strategy is permanently inactive.");
    process.exit(0);
  }

  // Withdrawal signal from authority
  const signal = readWithdrawSignal(config.withdrawSignalPath);
  if (signal) {
    console.log(
      `  Withdraw signal detected: ${(signal.amount / 1e6).toFixed(2)} USDC (requested by ${signal.requestedBy})`
    );
    await protocol.execute({ action: "WITHDRAW", amount: signal.amount });
    deleteWithdrawSignal(config.withdrawSignalPath);
    state.lastBalance = tokenBalance;
    state.lastSnapshot = snapshot;
    return;
  }

  // 3. Detect state changes
  const isFirstRun = state.lastBalance === -1;
  const balanceDelta = isFirstRun ? 0 : tokenBalance - state.lastBalance;
  const stateChanged = isFirstRun || balanceDelta !== 0;

  const yieldRate = await protocol.getCurrentYield();
  const lentBalance = await protocol.getLentBalance();

  console.log(
    `  Balance: ${(tokenBalance / 1e6).toFixed(2)} USDC | Lent: ${(lentBalance / 1e6).toFixed(2)} USDC | Yield: ${(yieldRate * 100).toFixed(2)}% APY${
      balanceDelta !== 0 ? ` | Delta: ${balanceDelta >= 0 ? "+" : ""}${(balanceDelta / 1e6).toFixed(2)}` : ""
    }`
  );

  // 4. Decision
  let shouldConsult = false;

  if (stateChanged) {
    shouldConsult = true;
  } else {
    state.routineCycleCount++;
    // Every 10th routine cycle, re-evaluate with Haiku
    if (state.routineCycleCount >= 10) {
      shouldConsult = true;
      state.routineCycleCount = 0;
    }
  }

  if (shouldConsult) {
    const decision = await advisor.getDecision(
      snapshot,
      state.lastSnapshot,
      yieldRate,
      lentBalance,
      stateChanged // use Sonnet for state changes, Haiku for routine
    );

    if (decision.action === "LEND") {
      // Validate: don't lend more than idle balance
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
      const amount = Math.min(decision.amount, lentBalance);
      if (amount > 0) {
        await protocol.execute({ action: "WITHDRAW", amount });
      } else {
        console.log("  Skipping WITHDRAW — nothing lent");
      }
    }
    // HOLD: do nothing
  } else {
    console.log("  No changes — holding.");
  }

  // 5. Update state
  state.lastBalance = tokenBalance;
  state.lastSnapshot = snapshot;
}

// --- Withdraw signal file ---

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

function deleteWithdrawSignal(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // Already deleted or doesn't exist
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
