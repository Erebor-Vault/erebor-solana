"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";

export interface StrategyData {
  publicKey: PublicKey;
  vault: PublicKey;
  strategyId: BN;
  delegate: PublicKey;
  allocatedAmount: BN;
  tokenAccount: PublicKey;
  isActive: boolean;
  targetWeightBps: number;
  actualBalance: BN;
  // strategy_authority[i] PDA — owns the strategy ATA + signs CPIs inside
  // execute_action. Derived from ["strategy_authority", vault, strategy_id LE].
  // Surfaced here so adapters can read protocol-side accounts (cToken ATA,
  // obligation, etc.) without re-deriving it themselves.
  strategyAuthority: PublicKey;
}

export function useStrategies() {
  const program = useVaultProgram();
  const { connection } = useConnection();
  const { vaultPda } = useVault();

  const [strategies, setStrategies] = useState<StrategyData[]>([]);
  const [loading, setLoading] = useState(true);

  // Clear stale strategies when vault changes
  useEffect(() => {
    setStrategies([]);
    setLoading(true);
  }, [vaultPda]);

  const refresh = useCallback(async () => {
    try {
      // Fetch all strategy accounts that belong to this vault
      const accounts = await (program.account as any).strategyAllocation.all([
        {
          memcmp: {
            offset: 8, // after discriminator
            bytes: vaultPda.toBase58(),
          },
        },
      ]);

      // Batch-fetch all token account balances using getMultipleAccountsInfo
      const tokenAccountKeys = accounts.map(
        (acc: any) => acc.account.tokenAccount as PublicKey
      );
      const balanceInfos = await connection.getMultipleAccountsInfo(tokenAccountKeys);

      const strategiesWithBalances = accounts.map((acc: any, i: number) => {
        let actualBalance = new BN(0);
        const info = balanceInfos[i];
        if (info?.data && info.data.length >= 72) {
          // SPL token account: amount is at offset 64, 8 bytes LE
          actualBalance = new BN(info.data.subarray(64, 72), "le");
        }

        const strategyId: BN = acc.account.strategyId;
        const [strategyAuthority] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("strategy_authority"),
            (acc.account.vault as PublicKey).toBuffer(),
            strategyId.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        return {
          publicKey: acc.publicKey,
          vault: acc.account.vault,
          strategyId,
          delegate: acc.account.delegate,
          allocatedAmount: acc.account.allocatedAmount,
          tokenAccount: acc.account.tokenAccount,
          isActive: acc.account.isActive,
          targetWeightBps: acc.account.targetWeightBps ?? 0,
          actualBalance,
          strategyAuthority,
        } as StrategyData;
      });

      // Sort by strategy ID
      strategiesWithBalances.sort((a: StrategyData, b: StrategyData) =>
        a.strategyId.sub(b.strategyId).toNumber()
      );

      setStrategies(strategiesWithBalances);
    } catch (err) {
      console.error("Failed to fetch strategies:", err);
    } finally {
      setLoading(false);
    }
  }, [program, connection, vaultPda]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { strategies, loading, refresh };
}
