"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { deriveUserAta } from "@/lib/pda";

export function useWithdraw() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, tokenMint, shareMintPda, reserveAta, refresh } = useVault();
  const [loading, setLoading] = useState(false);

  const withdraw = useCallback(
    async (sharesToBurn: BN): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Wallet not connected");

      setLoading(true);
      try {
        const userTokenAccount = deriveUserAta(tokenMint, wallet.publicKey);
        const userShareToken = deriveUserAta(shareMintPda, wallet.publicKey);

        const sig = await program.methods
          .withdraw(sharesToBurn)
          .accountsStrict({
            user: wallet.publicKey,
            vaultState: vaultPda,
            tokenMint,
            shareMint: shareMintPda,
            userTokenAccount,
            reserveAta,
            userShareToken,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, tokenMint, shareMintPda, reserveAta, refresh]
  );

  return { withdraw, loading };
}
