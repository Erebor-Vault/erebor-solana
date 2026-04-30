import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { PROGRAM_ID } from "./constants";

export function deriveVaultPda(tokenMint: PublicKey, vaultId: number = 0): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), new BN(vaultId).toArrayLike(Buffer, "le", 8)],
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

export function deriveProtocolConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    PROGRAM_ID
  );
  return pda;
}

export function deriveAllowedTokenPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_token"), mint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function deriveVaultAuthorityPda(vaultState: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultState.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function deriveStrategyAuthorityPda(
  vaultState: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_authority"),
      vaultState.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function deriveReserveAta(
  vaultState: PublicKey,
  tokenMint: PublicKey
): PublicKey {
  // Reserve ATA is now owned by vault_authority, not vault_state.
  const vaultAuthority = deriveVaultAuthorityPda(vaultState);
  return getAssociatedTokenAddressSync(tokenMint, vaultAuthority, true);
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
