import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { PROGRAM_ID } from "./constants";

export function deriveVaultPda(tokenMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function deriveShareMintPda(vaultState: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultState.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function deriveReserveAta(
  vaultState: PublicKey,
  tokenMint: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(tokenMint, vaultState, true);
}

export function deriveStrategyPda(
  vaultState: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy"),
      vaultState.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function deriveStrategyTokenPda(
  vaultState: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_token"),
      vaultState.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function deriveUserAta(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner);
}
