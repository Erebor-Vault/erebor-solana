"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { deriveValueSourcePda } from "@/lib/pda";

/** Phase-5 ValueSource kind discriminants — must match the program. */
export const VALUE_SOURCE_KIND_SPL_ATA_BALANCE = 0;
export const VALUE_SOURCE_KIND_ACCOUNT_U64 = 1;
/** Program-side cap on slots per strategy. */
export const MAX_VALUE_SOURCES_PER_STRATEGY = 16;

export interface ValueSourceRow {
  publicKey: PublicKey;
  vault: PublicKey;
  strategy: PublicKey;
  strategyId: BN;
  index: number;
  /** 0 = SplAtaBalance, 1 = AccountU64. */
  kind: number;
  targetAccount: PublicKey;
  /** Byte offset for AccountU64; ignored for SplAtaBalance. */
  offset: number;
  scaleNum: BN;
  scaleDen: BN;
  bump: number;
}

/** Read all `ValueSource` PDAs for a strategy and expose admin
 *  add/remove + authority settle helpers. */
export function useValueSources(
  strategy: PublicKey | null,
  strategyId: BN | null
) {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, refresh: refreshVault } = useVault();

  const [rows, setRows] = useState<ValueSourceRow[]>([]);
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
        (): Promise<any[]> => (program.account as any).valueSource.all(filters)
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: ValueSourceRow[] = accounts.map((a: any) => ({
        publicKey: a.publicKey,
        vault: a.account.vault,
        strategy: a.account.strategy,
        strategyId: a.account.strategyId,
        index: Number(a.account.index),
        kind: Number(a.account.kind),
        targetAccount: a.account.targetAccount,
        offset: Number(a.account.offset),
        scaleNum: a.account.scaleNum,
        scaleDen: a.account.scaleDen,
        bump: Number(a.account.bump),
      }));
      mapped.sort((a, b) => a.index - b.index);
      setRows(mapped);
    } catch (err) {
      console.error("useValueSources fetch failed:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [program, strategy]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Smallest unused slot index, or null if all 16 are taken. */
  const nextFreeIndex = useCallback((): number | null => {
    const used = new Set(rows.map((r) => r.index));
    for (let i = 0; i < MAX_VALUE_SOURCES_PER_STRATEGY; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }, [rows]);

  const addSource = useCallback(
    async (params: {
      index: number;
      kind: number;
      targetAccount: PublicKey;
      offset: number;
      scaleNum: BN;
      scaleDen: BN;
    }): Promise<string> => {
      if (!program || !wallet.publicKey || !strategy || !strategyId) {
        throw new Error("Not ready");
      }
      if (params.index < 0 || params.index >= MAX_VALUE_SOURCES_PER_STRATEGY) {
        throw new Error(
          `index must be in [0, ${MAX_VALUE_SOURCES_PER_STRATEGY}), got ${params.index}`
        );
      }
      if (params.scaleDen.isZero()) {
        throw new Error("scale_den must be non-zero");
      }
      setSubmitting(true);
      try {
        const valueSource = deriveValueSourcePda(strategy, params.index);
        const sig = await program.methods
          .addValueSource(
            strategyId,
            params.index,
            params.kind,
            params.targetAccount,
            params.offset,
            params.scaleNum,
            params.scaleDen
          )
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy,
            valueSource,
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

  const removeSource = useCallback(
    async (index: number): Promise<string> => {
      if (!program || !wallet.publicKey || !strategy || !strategyId) {
        throw new Error("Not ready");
      }
      setSubmitting(true);
      try {
        const valueSource = deriveValueSourcePda(strategy, index);
        const sig = await program.methods
          .removeValueSource(strategyId, index)
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy,
            valueSource,
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

  /** Authority-only. Reads the registry, books the signed delta into both
   *  `strategy.allocated_amount` and `vault.total_deposited`. */
  const settle = useCallback(
    async (strategyTokenAccount: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey || !strategy || !strategyId) {
        throw new Error("Not ready");
      }
      setSubmitting(true);
      try {
        // remaining_accounts = the registered ValueSource PDAs followed
        // by their target_account AccountInfo (program reads the data).
        const remaining: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
        for (const r of rows) {
          remaining.push({ pubkey: r.publicKey, isSigner: false, isWritable: false });
          remaining.push({ pubkey: r.targetAccount, isSigner: false, isWritable: false });
        }
        const sig = await program.methods
          .settleStrategyValue(strategyId)
          .accountsStrict({
            authority: wallet.publicKey,
            vaultState: vaultPda,
            strategy,
            strategyTokenAccount,
          })
          .remainingAccounts(remaining)
          .rpc();
        await refresh();
        await refreshVault();
        return sig;
      } finally {
        setSubmitting(false);
      }
    },
    [program, wallet.publicKey, strategy, strategyId, vaultPda, rows, refresh, refreshVault]
  );

  return {
    rows,
    loading,
    submitting,
    refresh,
    nextFreeIndex,
    addSource,
    removeSource,
    settle,
  };
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
