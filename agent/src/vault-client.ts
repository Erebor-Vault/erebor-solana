import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { PROGRAM_ID } from "./config.js";
import type {
  VaultStateAccount,
  StrategyAccount,
  AllowedActionAccount,
} from "./types.js";

// Import the IDL type from the build output
import type { MyProject } from "../../target/types/my_project.js";
import idl from "../../target/idl/my_project.json" with { type: "json" };

// --- PDA derivation ---

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

export function deriveAllowedActionPda(
  strategyPda: PublicKey,
  actionId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_action"),
      strategyPda.toBuffer(),
      new BN(actionId).toArrayLike(Buffer, "le", 2),
    ],
    PROGRAM_ID
  );
  return pda;
}

// --- Anchor program init ---

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

// --- On-chain reads ---

export async function fetchVaultState(
  program: Program<MyProject>,
  vaultPda: PublicKey
): Promise<VaultStateAccount> {
  return (await program.account.vaultState.fetch(
    vaultPda
  )) as unknown as VaultStateAccount;
}

export async function fetchStrategy(
  program: Program<MyProject>,
  strategyPda: PublicKey
): Promise<StrategyAccount> {
  return (await program.account.strategyAllocation.fetch(
    strategyPda
  )) as unknown as StrategyAccount;
}

export async function fetchAllowedAction(
  program: Program<MyProject>,
  actionPda: PublicKey
): Promise<AllowedActionAccount> {
  return (await program.account.allowedAction.fetch(
    actionPda
  )) as unknown as AllowedActionAccount;
}

export async function fetchTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  const result = await connection.getTokenAccountBalance(tokenAccount);
  return Number(result.value.amount);
}

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
      // Action may have been closed or doesn't exist, skip
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
