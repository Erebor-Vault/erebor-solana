"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";

// Mock Lulo program ID — used to derive position PDAs.
// TODO: make this configurable if supporting multiple protocols.
const MOCK_LULO_PROGRAM_ID = new PublicKey(
  "ENccKNWkndfdG16WQY3xchEKGoF3MwXqF5SWueesThXE"
);

export interface StrategyData {
  publicKey: PublicKey;
  vault: PublicKey;
  strategyId: BN;
  delegate: PublicKey;
  allocatedAmount: BN;
  tokenAccount: PublicKey;
  isActive: boolean;
  targetWeightBps: number;
  actualBalance: BN;       // tokens idle in strategy token account
  externalPosition: BN;    // tokens deployed to external protocol
  totalValue: BN;          // actualBalance + externalPosition
  positionPda: PublicKey | null; // protocol position PDA (for report_yield)
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

      // Batch-fetch all token account balances
      const tokenAccountKeys = accounts.map(
        (acc: any) => acc.account.tokenAccount as PublicKey
      );
      const balanceInfos = await connection.getMultipleAccountsInfo(tokenAccountKeys);

      // Derive and batch-fetch protocol position PDAs
      const positionPdas = tokenAccountKeys.map((tokenAcct: PublicKey) => {
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from("position"), tokenAcct.toBuffer()],
          MOCK_LULO_PROGRAM_ID
        );
        return pda;
      });
      const positionInfos = await connection.getMultipleAccountsInfo(positionPdas);

      const strategiesWithBalances = accounts.map((acc: any, i: number) => {
        // Read strategy token account balance (idle funds)
        let actualBalance = new BN(0);
        const info = balanceInfos[i];
        if (info?.data && info.data.length >= 72) {
          actualBalance = new BN(info.data.subarray(64, 72), "le");
        }

        // Read protocol position (external funds deployed to protocol)
        // ProtocolPosition layout: [8 discriminator][32 strategy_token_account][8 deposited_amount][1 bump]
        let externalPosition = new BN(0);
        let positionPda: PublicKey | null = null;
        const posInfo = positionInfos[i];
        if (posInfo?.data && posInfo.data.length >= 48) {
          externalPosition = new BN(posInfo.data.subarray(40, 48), "le");
          positionPda = positionPdas[i];
        }

        const totalValue = actualBalance.add(externalPosition);

        return {
          publicKey: acc.publicKey,
          vault: acc.account.vault,
          strategyId: acc.account.strategyId,
          delegate: acc.account.delegate,
          allocatedAmount: acc.account.allocatedAmount,
          tokenAccount: acc.account.tokenAccount,
          isActive: acc.account.isActive,
          targetWeightBps: acc.account.targetWeightBps ?? 0,
          actualBalance,
          externalPosition,
          totalValue,
          positionPda,
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
