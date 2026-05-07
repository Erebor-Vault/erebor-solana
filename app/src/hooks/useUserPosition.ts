"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { deriveUserAta } from "@/lib/pda";

interface UserPosition {
  shareBalance: BN;
  tokenBalance: BN;
  estimatedValue: number;
  loading: boolean;
}

export function useUserPosition(): UserPosition & { refresh: () => Promise<void> } {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { shareMintPda, tokenMint, sharePrice } = useVault();

  const [shareBalance, setShareBalance] = useState(new BN(0));
  const [tokenBalance, setTokenBalance] = useState(new BN(0));
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setShareBalance(new BN(0));
      setTokenBalance(new BN(0));
      return;
    }

    setLoading(true);
    try {
      const shareAta = deriveUserAta(shareMintPda, publicKey);
      const tokenAta = deriveUserAta(tokenMint, publicKey);
      // Batched: 1 RPC instead of 2.
      const [shareInfo, tokenInfo] = await connection.getMultipleAccountsInfo([shareAta, tokenAta]);
      setShareBalance(
        shareInfo?.data && shareInfo.data.length >= 72
          ? new BN(shareInfo.data.subarray(64, 72), "le")
          : new BN(0)
      );
      setTokenBalance(
        tokenInfo?.data && tokenInfo.data.length >= 72
          ? new BN(tokenInfo.data.subarray(64, 72), "le")
          : new BN(0)
      );
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey, shareMintPda, tokenMint]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  const estimatedValue = shareBalance.toNumber() * sharePrice;

  return { shareBalance, tokenBalance, estimatedValue, loading, refresh };
}
