// types.ts — Shared TypeScript interfaces used across all agent modules.
//
// On-chain account mirrors match the Anchor structs in
// programs/my_project/src/lib.rs. Pubkey fields become PublicKey; u64 fields
// become BN (bn.js).
//
// Agent-specific decision/monitor/config types are kept here for now while
// lulo still imports them; they'll move to agent/lulo/src/types.ts in step
// 5c (PORT_PROGRESS.md).

import { PublicKey } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import type BN from "bn.js";

// =============================================================================
// ON-CHAIN ACCOUNT MIRRORS
// =============================================================================

// Mirrors VaultState. Seeds: ["vault", token_mint, vault_id LE].
export interface VaultStateAccount {
  admin: PublicKey;
  authority: PublicKey;
  tokenMint: PublicKey;
  shareMint: PublicKey;
  vaultId: BN;
  totalDeposited: BN;
  strategyCount: BN;
  bump: number;
  shareMintBump: number;
  vaultAuthorityBump: number;
  paused: boolean;
  performanceFeeBps: number;
  totalActiveWeightBps: number;
  pendingAdmin: PublicKey;
  pendingAuthority: PublicKey;
}

// Mirrors StrategyAllocation. Seeds: ["strategy", vault_state, strategy_id LE].
// The strategy ATA at ["strategy_token", vault_state, strategy_id LE] is owned
// by strategy_authority[i], not by vault_state.
export interface StrategyAccount {
  vault: PublicKey;
  strategyId: BN;
  delegate: PublicKey;
  allocatedAmount: BN;
  tokenAccount: PublicKey;
  isActive: boolean;
  targetWeightBps: number;
  bump: number;
  authorityBump: number;
}

// Mirrors AllowedAction. Seeds:
//   ["allowed_action", strategy, target_program, discriminator (8 bytes)].
// expected_recipient_index pins one slot in remaining_accounts to
// strategy.token_account; output_mint_index optionally pins another slot to
// a mint that must be on the protocol allow-list (AllowedToken PDA).
export interface AllowedActionAccount {
  vault: PublicKey;
  strategy: PublicKey;
  strategyId: BN;
  targetProgram: PublicKey;
  discriminator: number[];
  expectedRecipientIndex: number;
  outputMintIndex: number | null;
  bump: number;
}

// =============================================================================
// AGENT DECISION TYPES (lulo-specific; kept here until step 5c)
// =============================================================================

export type AgentDecision =
  | { action: "LEND"; amount: number; reason?: string }
  | { action: "WITHDRAW"; amount: number; reason?: string }
  | { action: "HOLD"; reason: string };

export interface StrategySnapshot {
  allocatedAmount: number;
  tokenBalance: number;
  isActive: boolean;
  timestamp: number;
}

export interface MonitorState {
  lastBalance: number;
  lastDecisionTime: number;
  consecutiveErrors: number;
  routineCycleCount: number;
  lastSnapshot: StrategySnapshot | null;
}

export interface WithdrawSignal {
  amount: number;
  requestedAt: string;
  requestedBy: string;
}

// =============================================================================
// CONFIG (lulo-specific; kept here until step 5c)
// =============================================================================

export interface AgentConfig {
  agentKeypair: Keypair;
  rpcUrl: string;
  anthropicApiKey: string;
  vaultTokenMint: PublicKey;
  vaultId: number;
  strategyId: number;
  pollIntervalMs: number;
  minLendAmount: number;
  luloProgramId: PublicKey;
  luloTreasury: PublicKey;
  withdrawSignalPath: string;
  maxRetries: number;
  retryDelayMs: number;
}

// =============================================================================
// PROTOCOL INTERFACE (lulo-specific; kept here until step 5c)
// =============================================================================

export interface YieldInfo {
  rate: number;
  hasAccrued: boolean;
}

export interface LuloProtocol {
  getCurrentYield(): Promise<YieldInfo>;
  getLentBalance(): Promise<number>;
  execute(decision: AgentDecision): Promise<string>;
}
