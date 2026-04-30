// @ts-nocheck — TODO(step5b): rewrite for OLD_Erebor's cToken model.
// References deleted symbols (fetchPriceOracle, getReserveApys, ASSET_USDC,
// obligationUsdValues) and the old KaminoActionContext shape. Step 5b
// rebuilds the portfolio read on cToken-balance + obligation.borrowed_liquidity.
//
// mainLoop.ts — Eval cycle orchestrator for the kamino_looper agent.
//
// Every EVAL_INTERVAL_MS:
//   1. Read portfolio state (obligation + idle balance + prices)
//   2. Read APYs from kamino reserves
//   3. Compute loop APYs and decide an action via the allocator
//   4. Execute the decision (or log it in dry-run mode)
//
// Errors in a single cycle don't kill the loop — they're logged and the next
// cycle proceeds normally.

import { Connection } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import type { MyProject } from "../../../../target/types/my_project.js";
import type { KaminoLooperConfig } from "../config.js";
import { fetchTokenBalance } from "../../../shared/vault-client.js";
import {
  fetchObligation,
  fetchPriceOracle,
  getReserveApys,
  obligationUsdValues,
} from "../chain/kamino.js";
import { computeAllLoopApys } from "../strategy/apyScanner.js";
import { decideAllocation, type PortfolioState } from "../strategy/allocator.js";
import {
  ASSET_USDC,
  type KaminoActionContext,
} from "../chain/vault.js";
import { closeUsdcLoop, openUsdcLoop } from "../strategy/leverageManager.js";

export interface LoopContext {
  config: KaminoLooperConfig;
  connection: Connection;
  vaultProgram: Program<MyProject>;
  vaultPda: import("@solana/web3.js").PublicKey;
  strategyPda: import("@solana/web3.js").PublicKey;
  strategyTokenPda: import("@solana/web3.js").PublicKey;
  vaultProgramId: import("@solana/web3.js").PublicKey;
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
  const { config, connection, vaultProgram, vaultPda, strategyPda, strategyTokenPda, vaultProgramId } =
    loopCtx;

  // ── Step 1: Read portfolio state ──────────────────────────────────────
  const [idleBalance, obligation, prices] = await Promise.all([
    fetchTokenBalance(connection, strategyTokenPda).catch(() => 0),
    fetchObligation(connection, strategyTokenPda, config.kaminoProgramId),
    fetchPriceOracle(connection, config.kaminoProgramId),
  ]);

  if (!prices) {
    console.log("  Price oracle not initialized yet — skipping cycle");
    return;
  }

  const obligationData = obligation || {
    usdcSupplied: 0,
    usdcBorrowed: 0,
    btcSupplied: 0,
    btcBorrowed: 0,
    solSupplied: 0,
    solBorrowed: 0,
  };

  const usdValues = obligationUsdValues(obligationData, prices);
  const portfolio: PortfolioState = {
    totalValueUsd:
      usdValues.collateralUsd - usdValues.debtUsd + idleBalance / 1e6,
    idleUsdc: idleBalance,
    suppliedUsdc: obligationData.usdcSupplied,
    borrowedUsdc: obligationData.usdcBorrowed,
    healthFactor: usdValues.healthFactor,
  };

  console.log(
    `  Idle: ${(portfolio.idleUsdc / 1e6).toFixed(2)} USDC | ` +
      `Supplied: ${(portfolio.suppliedUsdc / 1e6).toFixed(2)} | ` +
      `Borrowed: ${(portfolio.borrowedUsdc / 1e6).toFixed(2)} | ` +
      `HF: ${portfolio.healthFactor === Infinity ? "∞" : portfolio.healthFactor.toFixed(2)}`
  );

  // ── Step 2: Read APYs ─────────────────────────────────────────────────
  const apyData = await getReserveApys(connection, config.kaminoProgramId, {
    usdc: config.usdcMint,
    btc: config.btcMint,
    sol: config.solMint,
  });

  const loopApys = computeAllLoopApys(
    apyData,
    config.minLoopNetApyPct,
    config.maxLeverage
  );

  if (loopApys.length > 0) {
    const top = loopApys[0];
    console.log(
      `  Best loop: ${top.asset} @ ${top.leverage}x → ${(top.netApy * 100).toFixed(2)}% net APY`
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
    vaultProgram,
    agentKeypair: config.agentKeypair,
    vaultPda,
    strategyPda,
    strategyTokenPda,
    vaultProgramId,
    kaminoProgramId: config.kaminoProgramId,
    mint: config.usdcMint,
    asset: ASSET_USDC,
  };

  switch (decision.action) {
    case "OPEN_LOOP": {
      const sigs = await openUsdcLoop(
        actionCtx,
        decision.amount,
        decision.targetLeverage,
        (msg) => console.log(`    ${msg}`)
      );
      console.log(`  Opened loop in ${sigs.length} txs`);
      break;
    }
    case "CLOSE_LOOP": {
      const sigs = await closeUsdcLoop(
        actionCtx,
        portfolio.borrowedUsdc,
        portfolio.suppliedUsdc,
        (msg) => console.log(`    ${msg}`)
      );
      console.log(`  Closed loop in ${sigs.length} txs`);
      break;
    }
    case "EMERGENCY_DELEVERAGE": {
      console.log("  Emergency deleverage — closing loop");
      const sigs = await closeUsdcLoop(
        actionCtx,
        portfolio.borrowedUsdc,
        portfolio.suppliedUsdc,
        (msg) => console.log(`    ${msg}`)
      );
      console.log(`  Emergency unwind in ${sigs.length} txs`);
      break;
    }
    default:
      console.log(`  Action ${decision.action} not yet implemented`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
