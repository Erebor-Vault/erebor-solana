"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";

// Protocol program IDs whose ProtocolPosition PDAs the frontend knows how
// to read. All listed programs expose the same adapter layout:
//   seeds:   ["position", strategy_token_account]
//   bytes 8..40   strategy_token_account (Pubkey)
//   bytes 40..48  deposited_amount (u64 LE)
// For each strategy, we probe every ID and use the first PDA that exists.
// Add new protocol integrations here.
const PROTOCOL_POSITION_PROGRAM_IDS: PublicKey[] = [
  new PublicKey("3YSjEZC92TJs9zJsYDa1qyeRVBXBUtnwSze2iyCB7Ydm"), // mock_lulo
  new PublicKey("S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK"), // mock_kamino
];

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
  externalPosition: BN;    // Σ(tokens deployed to external protocols)
  totalValue: BN;          // actualBalance + externalPosition
  positionPda: PublicKey | null; // first matching protocol position PDA (legacy)
  positionPdas: PublicKey[];     // all matching protocol position PDAs (for report_yield)
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

      // Derive ProtocolPosition PDAs for every (strategy, protocol) pair and
      // batch-fetch them in a single RPC call. Shape: [strategy_i][protocol_j].
      const pdaMatrix: PublicKey[][] = tokenAccountKeys.map(
        (tokenAcct: PublicKey) =>
          PROTOCOL_POSITION_PROGRAM_IDS.map((progId) => {
            const [pda] = PublicKey.findProgramAddressSync(
              [Buffer.from("position"), tokenAcct.toBuffer()],
              progId
            );
            return pda;
          })
      );
      const flatPdas = pdaMatrix.flat();
      const flatInfos = await connection.getMultipleAccountsInfo(flatPdas);
      const protocolCount = PROTOCOL_POSITION_PROGRAM_IDS.length;

      const strategiesWithBalances = accounts.map((acc: any, i: number) => {
        // Read strategy token account balance (idle funds)
        let actualBalance = new BN(0);
        const info = balanceInfos[i];
        if (info?.data && info.data.length >= 72) {
          actualBalance = new BN(info.data.subarray(64, 72), "le");
        }

        // Read protocol position(s) — sum across every protocol whose
        // ProtocolPosition PDA exists for this strategy. ERC-4626
        // totalAssets semantics: idle balance + Σ(external positions).
        //
        // ProtocolPosition layout (raw bytes, shared across protocols):
        //   [8 discriminator][32 strategy_token][8 deposited_amount][1 bump]
        //
        // positionPda is set to the first matching PDA — used by
        // report_yield callers to pass remaining_accounts in the same order.
        let externalPosition = new BN(0);
        const positionPdas: PublicKey[] = [];
        for (let j = 0; j < protocolCount; j++) {
          const posInfo = flatInfos[i * protocolCount + j];
          if (posInfo?.data && posInfo.data.length >= 48) {
            externalPosition = externalPosition.add(
              new BN(posInfo.data.subarray(40, 48), "le")
            );
            positionPdas.push(pdaMatrix[i][j]);
          }
        }
        const positionPda: PublicKey | null = positionPdas[0] ?? null;

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
          positionPdas,
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
