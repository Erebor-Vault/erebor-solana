// vault-client.ts — PDA derivation, Anchor program init, and on-chain reads.
//
// Used by all agents in the agent/ folder. Protocol-agnostic — only knows
// about the Erebor vault program's account layout. Each PDA function takes
// programId as a parameter so agents can configure it from their own .env.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type {
  VaultStateAccount,
  StrategyAccount,
  AllowedActionAccount,
} from "./types.js";

import type { MyProject } from "../../target/types/my_project.js";
import idl from "../../target/idl/my_project.json" with { type: "json" };

// =============================================================================
// PDA DERIVATION
// =============================================================================

export function deriveVaultPda(
  tokenMint: PublicKey,
  vaultId: number,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), new BN(vaultId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

export function deriveVaultAuthorityPda(
  vaultPda: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()],
    programId
  );
  return pda;
}

export function deriveStrategyPda(
  vaultPda: PublicKey,
  strategyId: number,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

// strategy_authority[i] — owns the strategy ATA, signs the inner CPI inside
// execute_action. Compromise of this PDA is bounded to strategy i's funds.
export function deriveStrategyAuthorityPda(
  vaultPda: PublicKey,
  strategyId: number,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_authority"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

export function deriveStrategyTokenPda(
  vaultPda: PublicKey,
  strategyId: number,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

// AllowedAction PDA seeds: ["allowed_action", strategy, target_program, discriminator].
// Deterministic — no scan needed. The admin must have called add_allowed_action
// with the same (target_program, discriminator) before execute_action will
// accept the call.
export function deriveAllowedActionPda(
  strategyPda: PublicKey,
  targetProgram: PublicKey,
  discriminator: number[] | Uint8Array,
  programId: PublicKey
): PublicKey {
  const disc = discriminator instanceof Uint8Array ? discriminator : Uint8Array.from(discriminator);
  if (disc.length !== 8) {
    throw new Error(`Discriminator must be 8 bytes, got ${disc.length}`);
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_action"),
      strategyPda.toBuffer(),
      targetProgram.toBuffer(),
      Buffer.from(disc),
    ],
    programId
  );
  return pda;
}

// Protocol-side PDA — used by mock_lulo's per-strategy ProtocolPosition tracker
// at seeds ["position", strategy_token_account]. Kept here because the lulo
// agent reads it to compute principal/yield.
export function deriveProtocolPositionPda(
  strategyTokenPda: PublicKey,
  protocolProgramId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    protocolProgramId
  );
  return pda;
}

// =============================================================================
// ANCHOR PROGRAM INIT
// =============================================================================

export function createProgram(
  connection: Connection,
  keypair: Keypair
): Program<MyProject> {
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(idl as any, provider) as unknown as Program<MyProject>;
}

// =============================================================================
// ON-CHAIN READS
// =============================================================================

export async function fetchVaultState(
  program: Program<MyProject>,
  vaultPda: PublicKey
): Promise<VaultStateAccount> {
  return (await program.account.vaultState.fetch(vaultPda)) as unknown as VaultStateAccount;
}

export async function fetchStrategy(
  program: Program<MyProject>,
  strategyPda: PublicKey
): Promise<StrategyAccount> {
  return (await program.account.strategyAllocation.fetch(strategyPda)) as unknown as StrategyAccount;
}

export async function fetchAllowedAction(
  program: Program<MyProject>,
  actionPda: PublicKey
): Promise<AllowedActionAccount> {
  return (await program.account.allowedAction.fetch(actionPda)) as unknown as AllowedActionAccount;
}

export async function fetchTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  const result = await connection.getTokenAccountBalance(tokenAccount);
  return Number(result.value.amount);
}

// Reads mock_lulo's ProtocolPosition account. Layout (after 8-byte discriminator):
//   bytes 8..40   strategy_token_account (Pubkey)
//   bytes 40..48  deposited_amount (u64 LE)
//   bytes 48..49  bump (u8)
export async function fetchProtocolPosition(
  connection: Connection,
  positionPda: PublicKey
): Promise<number> {
  const info = await connection.getAccountInfo(positionPda);
  if (!info || info.data.length < 48) return 0;
  return Number(info.data.readBigUInt64LE(40));
}
