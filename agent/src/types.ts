// types.ts — Shared TypeScript interfaces used across all agent modules.
//
// This file mirrors on-chain Anchor account structs as TypeScript interfaces,
// and defines the agent-specific types for decisions, state tracking, and config.
// No runtime logic — purely type definitions.

import { PublicKey } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import type BN from "bn.js";

// =============================================================================
// ON-CHAIN ACCOUNT MIRRORS
// These interfaces match the Anchor account structs defined in state.rs.
// They represent the deserialized data returned by program.account.*.fetch().
// Pubkey fields become PublicKey, u64 fields become BN (bn.js).
// =============================================================================

// Mirrors the VaultState account — the main vault configuration PDA.
// Seeds: ["vault", token_mint, vault_id]
export interface VaultStateAccount {
  admin: PublicKey;         // governance role — creates/deactivates strategies
  authority: PublicKey;     // operational role — allocates/deallocates funds
  tokenMint: PublicKey;     // the accepted deposit token (e.g., USDC mint)
  shareMint: PublicKey;     // vault's receipt token mint (minted on deposit)
  vaultId: BN;              // allows multiple vaults per token mint
  totalDeposited: BN;       // total assets across reserve + all strategies
  strategyCount: BN;        // auto-incrementing counter for strategy IDs
  bump: number;             // PDA bump seed
  shareMintBump: number;    // share mint PDA bump seed
}

// Mirrors the StrategyAllocation account — metadata for a single strategy.
// Seeds: ["strategy", vault_state, strategy_id]
export interface StrategyAccount {
  vault: PublicKey;         // back-reference to the parent VaultState
  strategyId: BN;           // unique sequential ID (0, 1, 2, ...)
  delegate: PublicKey;      // the agent keypair authorized to request actions
  allocatedAmount: BN;      // tokens currently allocated to this strategy
  tokenAccount: PublicKey;  // PDA token account holding strategy's tokens
  isActive: boolean;        // once false, permanently deactivated
  targetWeightBps: number;  // rebalancing target (0-10000 basis points)
  bump: number;             // PDA bump seed
  actionCount: number;      // how many AllowedAction PDAs exist for this strategy
}

// Mirrors the AllowedAction account — a whitelisted (program, instruction) pair.
// Seeds: ["allowed_action", strategy, action_id]
// The admin creates these to control which CPI calls the delegate can request.
export interface AllowedActionAccount {
  strategy: PublicKey;      // back-reference to the parent StrategyAllocation
  targetProgram: PublicKey;  // the external program allowed to be CPI'd into
  discriminator: number[];  // first 8 bytes of instruction data (Anchor discriminator)
  actionId: number;         // sequential ID within the strategy
  isActive: boolean;        // can be deactivated by admin without closing
  bump: number;             // PDA bump seed
}

// =============================================================================
// AGENT DECISION TYPES
// These types represent the output of the LLM advisor.
// The monitor loop acts on these decisions.
// =============================================================================

// The LLM returns one of three possible decisions:
// - LEND: deposit `amount` micro-USDC into Lulo to earn yield
// - WITHDRAW: pull `amount` micro-USDC out of Lulo back to strategy token account
// - HOLD: do nothing this cycle
// All amounts are in micro-USDC (6 decimals, e.g., 1_000_000 = 1 USDC).
export type AgentDecision =
  | { action: "LEND"; amount: number; reason?: string }
  | { action: "WITHDRAW"; amount: number; reason?: string }
  | { action: "HOLD"; reason: string };

// A point-in-time snapshot of the strategy's on-chain state.
// Captured each poll cycle and compared to the previous snapshot
// to detect balance changes that trigger LLM consultation.
export interface StrategySnapshot {
  allocatedAmount: number;  // from StrategyAllocation.allocated_amount
  tokenBalance: number;     // actual SPL token balance of strategy token account
  isActive: boolean;        // from StrategyAllocation.is_active
  timestamp: number;        // Date.now() when snapshot was taken
}

// Mutable state tracked across polling cycles within the monitor loop.
// Persists in memory (not on-chain) — resets when agent restarts.
export interface MonitorState {
  lastBalance: number;          // previous cycle's token balance (-1 = first run)
  lastDecisionTime: number;     // timestamp of last LLM decision
  consecutiveErrors: number;    // error counter for backoff logic
  routineCycleCount: number;    // counts cycles with no state change (for periodic re-eval)
  lastSnapshot: StrategySnapshot | null;  // previous cycle's snapshot
}

// Shape of the withdraw-signal.json file. The vault authority (or admin) creates
// this file to tell the agent to withdraw a specific amount from the lending protocol.
// The agent reads it, executes the withdrawal, and deletes the file.
export interface WithdrawSignal {
  amount: number;           // micro-USDC to withdraw from Lulo
  requestedAt: string;      // ISO timestamp of when the signal was created
  requestedBy: string;      // who created it (e.g., "admin", "authority")
}

// =============================================================================
// CONFIG
// =============================================================================

// Typed, validated version of all .env variables. Created once at startup
// by loadConfig() and passed to all modules. Object.freeze'd to prevent mutation.
export interface AgentConfig {
  agentKeypair: Keypair;       // the delegate keypair (signs execute_strategy_action txs)
  rpcUrl: string;              // Solana RPC endpoint
  anthropicApiKey: string;     // Claude API key for LLM decisions
  vaultTokenMint: PublicKey;   // the vault's underlying token mint (e.g., USDC)
  vaultId: number;             // which vault (multiple vaults can exist per mint)
  strategyId: number;          // which strategy this agent manages
  pollIntervalMs: number;      // how often to check on-chain state (default: 30s)
  minLendAmount: number;       // minimum micro-USDC to trigger a lending action
  useMockLulo: boolean;        // true = simulate Lulo in memory (devnet), false = real CPI
  withdrawSignalPath: string;  // path to the withdrawal signal JSON file
  maxRetries: number;          // max retry attempts for transient errors
  retryDelayMs: number;        // base delay between retries (multiplied by attempt number)
}

// =============================================================================
// PROTOCOL INTERFACE
// =============================================================================

// Abstraction over the lending protocol (Lulo). Two implementations:
// - MockLuloProtocol: tracks lent amount in memory, no on-chain interaction (devnet)
// - RealLuloProtocol: builds CPI instructions and calls execute_strategy_action (mainnet)
export interface LuloProtocol {
  getCurrentYield(): Promise<number>;         // current APY as decimal (0.05 = 5%)
  getLentBalance(): Promise<number>;          // micro-USDC currently lent to protocol
  execute(decision: AgentDecision): Promise<string>;  // execute action, return tx sig
}
