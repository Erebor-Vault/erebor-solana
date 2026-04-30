"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVaultProgram } from "./useVaultProgram";
import { useProtocolConfig } from "./useProtocolConfig";
import { deriveAllowedTokenPda, deriveProtocolConfigPda } from "@/lib/pda";

export interface AllowedTokenRow {
  publicKey: PublicKey;
  mint: PublicKey;
  bump: number;
}

/** List + manage the global token allow-list. Adds/removes are
 *  governance-gated (ProtocolConfig.governance). */
export function useAllowedTokens() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { config: protocolConfig } = useProtocolConfig();
  const [rows, setRows] = useState<AllowedTokenRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!program) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accts = await (program.account as any).allowedToken.all();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRows(accts.map((a: any) => ({
        publicKey: a.publicKey,
        mint: a.account.mint,
        bump: a.account.bump,
      })));
    } catch (err) {
      console.warn("useAllowedTokens fetch failed:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [program]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isGovernance =
    !!wallet.publicKey && !!protocolConfig &&
    wallet.publicKey.equals(protocolConfig.governance);

  const addAllowed = useCallback(
    async (mint: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
      const allowedToken = deriveAllowedTokenPda(mint);
      const sig = await program.methods
        .addAllowedToken(mint)
        .accountsStrict({
          governance: wallet.publicKey,
          protocolConfig: deriveProtocolConfigPda(),
          allowedToken,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await refresh();
      return sig;
    },
    [program, wallet.publicKey, refresh],
  );

  const removeAllowed = useCallback(
    async (mint: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
      const allowedToken = deriveAllowedTokenPda(mint);
      const sig = await program.methods
        .removeAllowedToken(mint)
        .accountsStrict({
          governance: wallet.publicKey,
          protocolConfig: deriveProtocolConfigPda(),
          allowedToken,
        })
        .rpc();
      await refresh();
      return sig;
    },
    [program, wallet.publicKey, refresh],
  );

  return { rows, loading, isGovernance, addAllowed, removeAllowed, refresh };
}
