// mainLoop.ts — Eval cycle orchestrator for the kamino_looper agent.
//
// Every EVAL_INTERVAL_MS:
//   1. Read portfolio state — strategy ATA balance, cToken ATA balance,
//      reserve totals, obligation debt.
//   2. Compute single-asset loop APYs from agent-side config.
//   3. Decide an action via the allocator.
//   4. Execute the decision (or log it in dry-run mode).
//
// Errors in a single cycle don't kill the loop — they're logged and the next
// cycle proceeds normally.

import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import type { MyProject } from "../../../../target/types/my_project.js";
import type { KaminoLooperConfig } from "../config.js";
import { fetchTokenBalance } from "../../../shared/vault-client.js";
import {
  deriveKaminoReservePda,
  fetchObligation,
  fetchReserve,
  fetchSuppliedLiquidity,
  type ReserveData,
} from "../chain/kamino.js";
import { computeUsdcLoopApys } from "../strategy/apyScanner.js";
import { decideAllocation, type PortfolioState } from "../strategy/allocator.js";
import { type KaminoActionContext } from "../chain/vault.js";
import { closeUsdcLoop, openUsdcLoop } from "../strategy/leverageManager.js";
import { bpsToDecimal } from "../utils/math.js";

export interface LoopContext {
  config: KaminoLooperConfig;
  connection: Connection;
  vaultProgram: Program<MyProject>;
  vaultPda: PublicKey;
  strategyPda: PublicKey;
  strategyTokenPda: PublicKey;
  strategyAuthorityPda: PublicKey;
  vaultProgramId: PublicKey;
  agentTokenAta: PublicKey;
}

export async function startMainLoop(loopCtx: LoopContext): Promise<void> {
  const { config } = loopCtx;
  let cycle = 0;

  console.log(
    `Monitor loop started. Polling every ${config.evalIntervalMs / 1000}s.\n`
  );

  while (true) {
    cycle++;
    const startTime = Date.now();
    console.log(`--- Cycle ${cycle} @ ${new Date().toISOString()} ---`);

    try {
      await pollCycle(loopCtx);
    } catch (err: any) {
      console.error(`[ERROR] cycle ${cycle}:`, err?.message || err);
    }

    const elapsed = Date.now() - startTime;
    console.log(`  Cycle ${cycle} done in ${elapsed}ms\n`);
    await sleep(config.evalIntervalMs);
  }
}

async function pollCycle(loopCtx: LoopContext): Promise<void> {
  const { config, connection, strategyTokenPda, strategyAuthorityPda } = loopCtx;
  const usdcMint = config.vaultTokenMint;
  const reservePda = deriveKaminoReservePda(usdcMint, config.kaminoProgramId);

  // ── Step 1: Read portfolio state ──────────────────────────────────────
  const [idleBalance, supplied, obligation, reserve] = await Promise.all([
    fetchTokenBalance(connection, strategyTokenPda).catch(() => 0),
    fetchSuppliedLiquidity(
      connection,
      usdcMint,
      strategyAuthorityPda,
      config.kaminoProgramId
    ),
    fetchObligation(
      connection,
      reservePda,
      strategyAuthorityPda,
      config.kaminoProgramId
    ),
    fetchReserve(connection, usdcMint, config.kaminoProgramId),
  ]);

  if (!reserve) {
    console.log("  Reserve not initialized — skipping cycle");
    return;
  }

  const ctokenBalance = supplied?.ctokenBalance ?? 0;
  const suppliedUsdc = supplied?.suppliedLiquidity ?? 0;
  const borrowedUsdc = obligation?.borrowedLiquidity ?? 0;
  const healthFactor = borrowedUsdc > 0 ? suppliedUsdc / borrowedUsdc : Infinity;
  const totalValueUsdc = idleBalance + suppliedUsdc - borrowedUsdc;

  const portfolio: PortfolioState = {
    idleUsdc: idleBalance,
    ctokenBalance,
    suppliedUsdc,
    borrowedUsdc,
    healthFactor,
    totalValueUsdc,
  };

  console.log(
    `  Idle: ${(portfolio.idleUsdc / 1e6).toFixed(2)} USDC | ` +
      `Supplied: ${(portfolio.suppliedUsdc / 1e6).toFixed(2)} | ` +
      `Borrowed: ${(portfolio.borrowedUsdc / 1e6).toFixed(2)} | ` +
      `HF: ${portfolio.healthFactor === Infinity ? "∞" : portfolio.healthFactor.toFixed(2)}`
  );

  // ── Step 2: Compute APYs (config-driven on the mock) ──────────────────
  const loopApys = computeUsdcLoopApys(
    bpsToDecimal(config.usdcSupplyApyBps),
    bpsToDecimal(config.usdcBorrowApyBps),
    config.minLoopNetApyPct,
    config.maxLeverage
  );

  if (loopApys.length > 0) {
    const top = loopApys[0];
    console.log(
      `  Best loop: USDC @ ${top.leverage}x → ${(top.netApy * 100).toFixed(2)}% net APY`
    );
  }

  // ── Step 3: Decide ────────────────────────────────────────────────────
  const decision = decideAllocation(portfolio, loopApys, {
    hfWarning: config.hfWarning,
    hfComfortable: config.hfComfortable,
    targetLeverageMin: config.targetLeverageMin,
    targetLeverageMax: config.targetLeverageMax,
    minIdleToOpen: 1_000_000, // 1 USDC minimum
  });

  console.log(`  Decision: ${decision.action} — ${decision.reason}`);

  // ── Step 4: Execute ───────────────────────────────────────────────────
  if (decision.action === "NONE") return;

  if (config.dryRun) {
    console.log("  [DRY RUN] Would execute:", decision);
    return;
  }

  const actionCtx: KaminoActionContext = {
    vaultProgram: loopCtx.vaultProgram,
    agentKeypair: config.agentKeypair,
    vaultPda: loopCtx.vaultPda,
    strategyPda: loopCtx.strategyPda,
    strategyTokenPda: loopCtx.strategyTokenPda,
    strategyAuthorityPda,
    vaultProgramId: loopCtx.vaultProgramId,
    kaminoProgramId: config.kaminoProgramId,
    liquidityMint: usdcMint,
    strategyId: config.strategyId,
    callerTokenAta: loopCtx.agentTokenAta,
    delegateTokenAta: loopCtx.agentTokenAta,
  };

  await executeDecision(decision, portfolio, reserve, actionCtx).catch((err) => {
    console.error(`  [EXEC FAIL] ${decision.action}:`, err?.message || err);
  });
}

async function executeDecision(
  decision: ReturnType<typeof decideAllocation>,
  portfolio: PortfolioState,
  reserve: ReserveData,
  ctx: KaminoActionContext
): Promise<void> {
  switch (decision.action) {
    case "OPEN_LOOP": {
      const sigs = await openUsdcLoop(
        ctx,
        decision.amount,
        decision.targetLeverage,
        (msg) => console.log(`    ${msg}`)
      );
      console.log(`  Opened loop in ${sigs.length} txs`);
      return;
    }
    case "CLOSE_LOOP":
    case "EMERGENCY_DELEVERAGE": {
      const sigs = await closeUsdcLoop(
        ctx,
        portfolio.borrowedUsdc,
        portfolio.ctokenBalance,
        reserve,
        (msg) => console.log(`    ${msg}`)
      );
      console.log(`  Closed loop in ${sigs.length} txs`);
      return;
    }
    default:
      console.log(`  Action ${decision.action} not yet implemented`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
