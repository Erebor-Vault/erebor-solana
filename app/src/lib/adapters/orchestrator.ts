/**
 * Redeem-plan orchestrator. Given a per-vault snapshot of reserve, strategy
 * ATAs, and the requested withdrawal amount, queries every registered
 * adapter to find external positions that can be redeemed back to the
 * strategy ATAs to cover the shortfall. Returns a list of
 * `TransactionInstruction`s to prepend to the actual `withdraw` ix.
 *
 * Strategy: walk strategies in id-order. For each one, if its ATA balance
 * already plus what we've redeemed so far is enough for the shortfall, stop.
 * Otherwise, try each adapter against the strategy, building a redeem ix
 * for the smaller of "what this position can give" and "what we still need".
 *
 * Inefficient if you have many adapters (queries each per strategy), but
 * correct and simple. When per-strategy `withdraw_config` lands (Phase 4
 * follow-up) the loop becomes O(N strategies) not O(N × M adapters).
 */

import type { Connection, TransactionInstruction, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import type { MyProject } from "@/idl/my_project";
import type { StrategyData } from "@/hooks/useStrategies";
import { ADAPTERS } from "./index";

export interface RedeemPlanArgs {
  connection: Connection;
  program: Program<MyProject>;
  caller: PublicKey;
  vaultPda: PublicKey;
  underlyingMint: PublicKey;
  reserveBalance: BN;
  /** Active strategies in id-order. */
  strategies: StrategyData[];
  /** Total underlying the user wants to withdraw. */
  underlyingAmount: BN;
  /** Per-strategy current ATA balance, keyed by strategy.publicKey.toBase58(). */
  strategyAtaBalances: Map<string, BN>;
}

export async function buildRedeemPlan(
  args: RedeemPlanArgs,
): Promise<TransactionInstruction[]> {
  const {
    connection,
    program,
    caller,
    vaultPda,
    underlyingMint,
    reserveBalance,
    strategies,
    underlyingAmount,
    strategyAtaBalances,
  } = args;

  // Total tokens already in the program's "easily reachable" pools.
  let inAtaTotal = new BN(0);
  for (const s of strategies) {
    inAtaTotal = inAtaTotal.add(strategyAtaBalances.get(s.publicKey.toBase58()) ?? new BN(0));
  }

  let shortfall = underlyingAmount.sub(reserveBalance).sub(inAtaTotal);
  if (shortfall.lten(0)) return [];

  const instructions: TransactionInstruction[] = [];

  for (const strategy of strategies) {
    if (shortfall.lten(0)) break;
    for (const adapter of ADAPTERS) {
      if (shortfall.lten(0)) break;
      let position;
      try {
        position = await adapter.readPosition({
          connection,
          vaultPda,
          strategy,
          underlyingMint,
        });
      } catch {
        position = null;
      }
      if (!position || position.underlyingAvailable.lten(0)) continue;

      const redeemAmount = BN.min(position.underlyingAvailable, shortfall);
      try {
        const ix = await adapter.buildRedeemAction({
          connection,
          program,
          caller,
          vaultPda,
          strategy,
          underlyingMint,
          underlyingAmount: redeemAmount,
        });
        instructions.push(ix);
        shortfall = shortfall.sub(redeemAmount);
      } catch (err) {
        console.warn(
          `[redeem-plan] adapter ${adapter.id} failed for strategy ${strategy.strategyId.toString()}:`,
          err,
        );
      }
    }
  }

  if (shortfall.gtn(0)) {
    console.warn(
      `[redeem-plan] couldn't cover shortfall of ${shortfall.toString()} — withdrawal will likely revert InsufficientLiquidity`,
    );
  }
  return instructions;
}
