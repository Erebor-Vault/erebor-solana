import type { PublicKey } from "@solana/web3.js";

/**
 * On-chain strategy snapshot the agent needs to make a decision.
 * Mirrors the `StrategyAllocation` Anchor account plus a freshly-read
 * SPL token balance.
 */
export interface StrategySnapshot {
  vault: PublicKey;
  vaultPaused: boolean;
  vaultAdmin: PublicKey;
  vaultAuthority: PublicKey;
  totalDeposited: bigint;

  strategy: PublicKey;
  strategyId: number;
  delegate: PublicKey;
  isActive: boolean;
  targetWeightBps: number;
  allocatedAmount: bigint;
  /** Live balance of the strategy's SPL token account. */
  strategyTokenBalance: bigint;

  /**
   * Liquid balance held by the agent's own ATA — relevant when the
   * agent moves funds out of the strategy ATA before lending.
   */
  agentTokenBalance: bigint;
}

export type Decision =
  | { kind: "hold"; reason: string }
  | { kind: "lend"; amount: bigint; reason: string }
  | { kind: "withdraw"; amount: bigint; reason: string }
  | { kind: "rebalance"; reason: string };

export interface Advisor {
  /** Decide what to do given the latest snapshot. Should be cheap-to-call. */
  decide(snapshot: StrategySnapshot): Promise<Decision>;
}
