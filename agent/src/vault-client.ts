// vault-client.ts — PDA derivation, Anchor program initialization, and on-chain reads.
//
// This module is the single source of truth for interacting with the Erebor vault program.
// It provides:
// 1. PDA derivation functions that mirror the seeds defined in the Rust program (state.rs)
// 2. Anchor program initialization with the agent's keypair as signer
// 3. Typed account fetching functions for VaultState, StrategyAllocation, AllowedAction
// 4. A helper to scan AllowedAction PDAs to find one matching a target discriminator
//
// All PDA seeds must exactly match the on-chain program, or account lookups will fail.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_ID } from "./config.js";
import type {
  VaultStateAccount,
  StrategyAccount,
  AllowedActionAccount,
} from "./types.js";

// Import the auto-generated IDL type and JSON from `anchor build` output.
// The type gives us compile-time safety; the JSON is the actual IDL used at runtime.
import type { MyProject } from "../../target/types/my_project.js";
import idl from "../../target/idl/my_project.json" with { type: "json" };

// =============================================================================
// PDA DERIVATION
// These functions derive deterministic Program Derived Addresses (PDAs) using
// the same seeds as the on-chain program. PDAs are Solana's way of creating
// accounts owned by a program without needing a private key.
// =============================================================================

// Derives the VaultState PDA.
// Seeds: ["vault", token_mint_pubkey, vault_id_as_u64_little_endian]
// Each unique (token_mint, vault_id) pair gets its own vault.
export function deriveVaultPda(
  tokenMint: PublicKey,
  vaultId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      tokenMint.toBuffer(),
      new BN(vaultId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

// Derives the StrategyAllocation PDA.
// Seeds: ["strategy", vault_state_pubkey, strategy_id_as_u64_little_endian]
// Each vault can have multiple strategies (0, 1, 2, ...).
export function deriveStrategyPda(
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

// Derives the strategy's SPL token account PDA.
// Seeds: ["strategy_token", vault_state_pubkey, strategy_id_as_u64_little_endian]
// This account holds the actual tokens allocated to the strategy.
// Authority is the vault PDA — only the vault program can move tokens.
export function deriveStrategyTokenPda(
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_token"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

// Derives an AllowedAction PDA.
// Seeds: ["allowed_action", strategy_pubkey, action_id_as_u16_little_endian]
// Note: action_id uses u16 (2 bytes), not u64 — this matches the on-chain seed.
// Each strategy has its own independent whitelist of allowed actions.
export function deriveAllowedActionPda(
  strategyPda: PublicKey,
  actionId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_action"),
      strategyPda.toBuffer(),
      new BN(actionId).toArrayLike(Buffer, "le", 2), // u16, not u64!
    ],
    PROGRAM_ID
  );
  return pda;
}

// =============================================================================
// ANCHOR PROGRAM INITIALIZATION
// Creates a typed Anchor Program instance using the agent's keypair as the wallet.
// This is NOT a browser wallet — it's a direct Keypair used for signing transactions.
// =============================================================================

export function createProgram(
  connection: Connection,
  keypair: Keypair
): Program<MyProject> {
  // Wrap the keypair in Anchor's Wallet adapter (provides signTransaction/signAllTransactions)
  const wallet = new anchor.Wallet(keypair);
  // Create a provider that bundles the connection + wallet + commitment level
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // Create the typed program instance from the IDL JSON
  return new Program(idl as any, provider) as unknown as Program<MyProject>;
}

// =============================================================================
// ON-CHAIN READS
// Fetch deserialized account data from the Solana blockchain.
// These use Anchor's built-in deserialization via the IDL.
// =============================================================================

// Fetches and deserializes the VaultState account.
export async function fetchVaultState(
  program: Program<MyProject>,
  vaultPda: PublicKey
): Promise<VaultStateAccount> {
  return (await program.account.vaultState.fetch(
    vaultPda
  )) as unknown as VaultStateAccount;
}

// Fetches and deserializes the StrategyAllocation account.
export async function fetchStrategy(
  program: Program<MyProject>,
  strategyPda: PublicKey
): Promise<StrategyAccount> {
  return (await program.account.strategyAllocation.fetch(
    strategyPda
  )) as unknown as StrategyAccount;
}

// Fetches and deserializes an AllowedAction account.
export async function fetchAllowedAction(
  program: Program<MyProject>,
  actionPda: PublicKey
): Promise<AllowedActionAccount> {
  return (await program.account.allowedAction.fetch(
    actionPda
  )) as unknown as AllowedActionAccount;
}

// Fetches the raw SPL token balance of a token account.
// Returns the amount in the token's smallest unit (e.g., micro-USDC for 6-decimal USDC).
export async function fetchTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  const result = await connection.getTokenAccountBalance(tokenAccount);
  return Number(result.value.amount);
}

// Scans all AllowedAction PDAs for a strategy to find one matching a specific
// target program and instruction discriminator. This is needed because the agent
// must provide the correct AllowedAction PDA when calling execute_strategy_action.
//
// Iterates from action_id 0 to actionCount-1, fetching each PDA. Returns the
// first active match, or null if none found. Some PDAs may have been deactivated
// or may not exist (if the admin closed them), so fetch errors are silently skipped.
export async function findAllowedActionByDiscriminator(
  program: Program<MyProject>,
  strategyPda: PublicKey,
  actionCount: number,
  targetProgram: PublicKey,
  discriminator: number[]
): Promise<{ pda: PublicKey; action: AllowedActionAccount } | null> {
  for (let i = 0; i < actionCount; i++) {
    const pda = deriveAllowedActionPda(strategyPda, i);
    try {
      const action = await fetchAllowedAction(program, pda);
      if (
        action.isActive &&
        action.targetProgram.equals(targetProgram) &&
        arraysEqual(action.discriminator, discriminator)
      ) {
        return { pda, action };
      }
    } catch {
      // Action account may not exist or may have been closed — skip it
    }
  }
  return null;
}

// Byte-level comparison of two number arrays (used for discriminator matching).
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
