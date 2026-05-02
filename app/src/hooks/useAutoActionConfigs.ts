"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { deriveAutoActionConfigPda } from "@/lib/pda";

/** Phase-5 AutoActionConfig kind discriminants — must match the program. */
export const AUTO_ACTION_KIND_DEPOSIT = 0;
export const AUTO_ACTION_KIND_WITHDRAW = 1;
/** Program-side cap on `ix_data` length. */
export const MAX_AUTO_ACTION_IX_DATA_LEN = 256;

export interface AutoActionConfigRow {
  publicKey: PublicKey;
  vault: PublicKey;
  strategy: PublicKey;
  strategyId: BN;
  /** 0 = Deposit, 1 = Withdraw. */
  kind: number;
  targetProgram: PublicKey;
  discriminator: number[];
  ixData: Uint8Array;
  bump: number;
}

/** Read both AutoActionConfig PDAs (deposit + withdraw) for a strategy and
 *  expose admin set/clear helpers. */
export function useAutoActionConfigs(
  strategy: PublicKey | null,
  strategyId: BN | null
) {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, refresh: refreshVault } = useVault();

  const [rows, setRows] = useState<AutoActionConfigRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!program || !strategy) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const filters = [
        {
          memcmp: {
            offset: 8 + 32, // skip discriminator + vault, memcmp on strategy
            bytes: strategy.toBase58(),
          },
        },
      ];
      const accounts = await withRetry(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (): Promise<any[]> => (program.account as any).autoActionConfig.all(filters)
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: AutoActionConfigRow[] = accounts.map((a: any) => ({
        publicKey: a.publicKey,
        vault: a.account.vault,
        strategy: a.account.strategy,
        strategyId: a.account.strategyId,
        kind: Number(a.account.kind),
        targetProgram: a.account.targetProgram,
        discriminator: Array.from(a.account.discriminator) as number[],
        ixData: Uint8Array.from(a.account.ixData),
        bump: Number(a.account.bump),
      }));
      mapped.sort((a, b) => a.kind - b.kind);
      setRows(mapped);
    } catch (err) {
      console.error("useAutoActionConfigs fetch failed:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [program, strategy]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setConfig = useCallback(
    async (params: {
      kind: number;
      targetProgram: PublicKey;
      discriminator: number[] | Uint8Array;
      ixData: Uint8Array;
    }): Promise<string> => {
      if (!program || !wallet.publicKey || !strategy || !strategyId) {
        throw new Error("Not ready");
      }
      if (params.ixData.length > MAX_AUTO_ACTION_IX_DATA_LEN) {
        throw new Error(
          `ix_data exceeds ${MAX_AUTO_ACTION_IX_DATA_LEN} byte cap (got ${params.ixData.length})`
        );
      }
      const disc =
        params.discriminator instanceof Uint8Array
          ? Array.from(params.discriminator)
          : params.discriminator;
      if (disc.length !== 8) {
        throw new Error(`discriminator must be 8 bytes, got ${disc.length}`);
      }
      setSubmitting(true);
      try {
        const autoActionConfig = deriveAutoActionConfigPda(strategy, params.kind);
        const sig = await program.methods
          .setAutoActionConfig(
            strategyId,
            params.kind,
            params.targetProgram,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            disc as any,
            Buffer.from(params.ixData)
          )
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy,
            autoActionConfig,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        await refresh();
        await refreshVault();
        return sig;
      } finally {
        setSubmitting(false);
      }
    },
    [program, wallet.publicKey, strategy, strategyId, vaultPda, refresh, refreshVault]
  );

  const clearConfig = useCallback(
    async (kind: number): Promise<string> => {
      if (!program || !wallet.publicKey || !strategy || !strategyId) {
        throw new Error("Not ready");
      }
      setSubmitting(true);
      try {
        const autoActionConfig = deriveAutoActionConfigPda(strategy, kind);
        const sig = await program.methods
          .clearAutoActionConfig(strategyId, kind)
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy,
            autoActionConfig,
          })
          .rpc();
        await refresh();
        return sig;
      } finally {
        setSubmitting(false);
      }
    },
    [program, wallet.publicKey, strategy, strategyId, vaultPda, refresh]
  );

  return { rows, loading, submitting, refresh, setConfig, clearConfig };
}

/** Retry on 429 with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/\b429\b|too many requests/i.test(msg) || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
  }
  throw new Error("withRetry: exhausted attempts");
}
