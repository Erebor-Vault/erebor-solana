// vault-client.ts — Shared PDA derivation, Anchor program init, and on-chain reads.
//
// Used by all agents in the agent/ folder. Protocol-agnostic — only knows about
// the Erebor vault program's account layout. Each PDA function takes programId
// as a parameter so agents can configure it from their own .env.

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
// PDA DERIVATION — all take programId as parameter
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

export function deriveAllowedActionPda(
  strategyPda: PublicKey,
  actionId: number,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_action"), strategyPda.toBuffer(), new BN(actionId).toArrayLike(Buffer, "le", 2)],
    programId
  );
  return pda;
}

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

export async function fetchProtocolPosition(
  connection: Connection,
  positionPda: PublicKey
): Promise<number> {
  const info = await connection.getAccountInfo(positionPda);
  if (!info || info.data.length < 48) return 0;
  return Number(info.data.readBigUInt64LE(40));
}

export async function findAllowedActionByDiscriminator(
  program: Program<MyProject>,
  strategyPda: PublicKey,
  actionCount: number,
  targetProgram: PublicKey,
  discriminator: number[],
  programId: PublicKey
): Promise<{ pda: PublicKey; action: AllowedActionAccount } | null> {
  for (let i = 0; i < actionCount; i++) {
    const pda = deriveAllowedActionPda(strategyPda, i, programId);
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
      // Action may not exist or was closed
    }
  }
  return null;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
