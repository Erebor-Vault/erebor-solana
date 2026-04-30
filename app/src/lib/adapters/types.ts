/**
 * Adapter interface for redeeming a strategy's externally-deployed funds
 * back into the strategy ATA, ahead of `withdraw`. Each adapter targets
 * one external protocol (Kamino Lend, Marginfi, Drift, Jupiter swap, …).
 *
 * The flow:
 *   1. `readPosition(strategy)` queries on-chain state for the strategy's
 *      open position with this protocol and returns how much underlying it
 *      can redeem right now.
 *   2. `buildRedeemAction(strategy, amount)` returns a `TransactionInstruction`
 *      for `execute_action` that redeems the requested underlying back to
 *      the strategy ATA. The orchestrator stacks these ahead of the actual
 *      `withdraw` ix so everything runs in one atomic transaction.
 *
 * Adapters are pure-TS — adding a new protocol does NOT require a program
 * upgrade. The on-chain whitelist (AllowedAction PDA) gates which
 * (target_program, discriminator) pairs the agent / authority can dispatch;
 * the adapter just builds the right account list + ix data for an already-
 * whitelisted action.
 */

import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type BN from "bn.js";
import type { StrategyData } from "@/hooks/useStrategies";

export interface ProtocolPosition {
  /** Human label, e.g. "Kamino · USDC reserve". */
  label: string;
  /** Underlying-token amount currently redeemable, in mint base units. */
  underlyingAvailable: BN;
  /** Optional per-adapter raw fields (cToken balance, obligation pubkey, …). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: Record<string, any>;
}

export interface RedeemAdapter {
  /** Adapter id used in logs and to look up presets. */
  id: string;
  /** Display label. */
  label: string;
  /** Target program id this adapter dispatches against. */
  targetProgram: PublicKey;
  /** Anchor / native discriminator (8 bytes). */
  discriminator: number[];

  /**
   * Quick on-chain read of the strategy's open position with this protocol.
   * Returns null if the strategy has no position with this adapter (e.g. it
   * never deposited into Kamino).
   */
  readPosition(args: {
    connection: Connection;
    vaultPda: PublicKey;
    strategy: StrategyData;
    underlyingMint: PublicKey;
  }): Promise<ProtocolPosition | null>;

  /**
   * Build the `execute_action` instruction that redeems the requested
   * underlying back to the strategy ATA. Caller must have already
   * whitelisted this adapter's (targetProgram, discriminator) pair as an
   * `AllowedAction` on the strategy.
   */
  buildRedeemAction(args: {
    connection: Connection;
    program: import("@coral-xyz/anchor").Program<
      import("../../idl/my_project").MyProject
    >;
    caller: PublicKey;
    vaultPda: PublicKey;
    strategy: StrategyData;
    underlyingMint: PublicKey;
    underlyingAmount: BN;
  }): Promise<TransactionInstruction>;
}
