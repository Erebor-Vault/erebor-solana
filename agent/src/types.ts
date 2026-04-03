import { PublicKey } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import type BN from "bn.js";

// --- On-chain account mirrors ---

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
}

export interface StrategyAccount {
  vault: PublicKey;
  strategyId: BN;
  delegate: PublicKey;
  allocatedAmount: BN;
  tokenAccount: PublicKey;
  isActive: boolean;
  targetWeightBps: number;
  bump: number;
  actionCount: number;
}

export interface AllowedActionAccount {
  strategy: PublicKey;
  targetProgram: PublicKey;
  discriminator: number[];
  actionId: number;
  isActive: boolean;
  bump: number;
}

// --- Agent decision types ---

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

// --- Config ---

export interface AgentConfig {
  agentKeypair: Keypair;
  rpcUrl: string;
  anthropicApiKey: string;
  vaultTokenMint: PublicKey;
  vaultId: number;
  strategyId: number;
  pollIntervalMs: number;
  minLendAmount: number;
  useMockLulo: boolean;
  withdrawSignalPath: string;
  maxRetries: number;
  retryDelayMs: number;
}

// --- Protocol interface ---

export interface LuloProtocol {
  getCurrentYield(): Promise<number>;
  getLentBalance(): Promise<number>;
  execute(decision: AgentDecision): Promise<string>;
}
