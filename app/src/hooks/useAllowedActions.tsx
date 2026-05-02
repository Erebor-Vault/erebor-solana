"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram, type VaultProgram } from "./useVaultProgram";

export interface AllowedActionRow {
  publicKey: PublicKey;
  vault: PublicKey;
  strategy: PublicKey;
  strategyId: BN;
  targetProgram: PublicKey;
  discriminator: number[]; // 8 bytes
  expectedRecipientIndex: number;
  /** Phase-4d: index in remaining_accounts of an output-mint slot that
   *  must be on the protocol allow-list. `null` means the action is not
   *  swap-style and the gate is skipped. */
  outputMintIndex: number | null;
  bump: number;
}

interface VaultAllowedActionsContextValue {
  rowsByStrategy: Map<string, AllowedActionRow[]>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const VaultAllowedActionsContext =
  createContext<VaultAllowedActionsContextValue | null>(null);

const EMPTY_ROWS: AllowedActionRow[] = [];

/**
 * Fetches every `AllowedAction` PDA for the active vault in a single
 * `getProgramAccounts` (memcmp on `vault` at offset 8 = end of the 8-byte
 * account discriminator) and partitions by strategy. The previous
 * per-strategy hook fanned out one gPA per mount, which on public devnet
 * triggered 429s (gPA is the most aggressively rate-limited RPC method).
 *
 * Mount inside `<VaultProvider>`. `useAllowedActions(strategy)` reads
 * from this context when present.
 */
export function VaultAllowedActionsProvider({ children }: { children: ReactNode }) {
  const { vaultPda, hasActiveVault } = useVault();
  const program = useVaultProgram();

  const [rowsByStrategy, setRowsByStrategy] = useState<
    Map<string, AllowedActionRow[]>
  >(new Map());
  const [loading, setLoading] = useState(false);

  const vaultKey = vaultPda.toBase58();

  const refresh = useCallback(async () => {
    if (!hasActiveVault) {
      setRowsByStrategy(new Map());
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchAllowedActionsForVault(program, vaultPda);
      const partitioned = new Map<string, AllowedActionRow[]>();
      for (const r of rows) {
        const key = r.strategy.toBase58();
        const arr = partitioned.get(key);
        if (arr) arr.push(r);
        else partitioned.set(key, [r]);
      }
      setRowsByStrategy(partitioned);
    } catch (err) {
      console.error("VaultAllowedActionsProvider fetch failed:", err);
      setRowsByStrategy(new Map());
    } finally {
      setLoading(false);
    }
    // vaultKey is the string form of vaultPda — included so React notices
    // when the user navigates between vaults without tripping the
    // exhaustive-deps lint on the PublicKey identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, hasActiveVault, vaultKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<VaultAllowedActionsContextValue>(
    () => ({ rowsByStrategy, loading, refresh }),
    [rowsByStrategy, loading, refresh]
  );

  return (
    <VaultAllowedActionsContext.Provider value={value}>
      {children}
    </VaultAllowedActionsContext.Provider>
  );
}

async function fetchAllowedActionsForVault(
  program: VaultProgram,
  vault: PublicKey
): Promise<AllowedActionRow[]> {
  const filters = [
    {
      memcmp: {
        // AllowedAction layout: [discriminator(8), vault(32), strategy(32), …]
        offset: 8,
        bytes: vault.toBase58(),
      },
    },
  ];
  const accounts = await withRetry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (): Promise<any[]> => (program.account as any).allowedAction.all(filters)
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return accounts.map((a: any) => ({
    publicKey: a.publicKey,
    vault: a.account.vault,
    strategy: a.account.strategy,
    strategyId: a.account.strategyId,
    targetProgram: a.account.targetProgram,
    discriminator: Array.from(a.account.discriminator) as number[],
    expectedRecipientIndex: Number(a.account.expectedRecipientIndex),
    outputMintIndex:
      a.account.outputMintIndex == null ? null : Number(a.account.outputMintIndex),
    bump: a.account.bump,
  }));
}

/** Retry on 429 with exponential backoff: 250 → 500 → 1000 → 2000 ms. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited = /\b429\b|too many requests/i.test(msg);
      if (!rateLimited || attempt === maxAttempts) throw err;
      const delayMs = 250 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("withRetry: exhausted attempts");
}

/**
 * Read allowed-action rows for a strategy. Prefers the vault-scoped
 * provider (one gPA per vault, partitioned in memory); falls back to a
 * per-strategy gPA for callers outside the provider tree.
 */
export function useAllowedActions(strategy: PublicKey | null) {
  const ctx = useContext(VaultAllowedActionsContext);
  // Always invoke the fallback hook so hook order stays stable across
  // renders. It no-ops when the provider is supplying data.
  const fallback = useFallbackAllowedActions(strategy, ctx === null);

  if (ctx) {
    const rows = strategy
      ? ctx.rowsByStrategy.get(strategy.toBase58()) ?? EMPTY_ROWS
      : EMPTY_ROWS;
    return { rows, loading: ctx.loading, refresh: ctx.refresh };
  }
  return fallback;
}

function useFallbackAllowedActions(
  strategy: PublicKey | null,
  enabled: boolean
) {
  const program = useVaultProgram();
  const [rows, setRows] = useState<AllowedActionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !strategy) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const filters = [
        {
          memcmp: {
            offset: 8 + 32, // skip discriminator + vault pubkey
            bytes: strategy.toBase58(),
          },
        },
      ];
      const accounts = await withRetry(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (): Promise<any[]> => (program.account as any).allowedAction.all(filters)
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: AllowedActionRow[] = accounts.map((a: any) => ({
        publicKey: a.publicKey,
        vault: a.account.vault,
        strategy: a.account.strategy,
        strategyId: a.account.strategyId,
        targetProgram: a.account.targetProgram,
        discriminator: Array.from(a.account.discriminator) as number[],
        expectedRecipientIndex: Number(a.account.expectedRecipientIndex),
        outputMintIndex:
          a.account.outputMintIndex == null
            ? null
            : Number(a.account.outputMintIndex),
        bump: a.account.bump,
      }));
      setRows(mapped);
    } catch (err) {
      console.error("useAllowedActions fetch failed:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [program, strategy, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rows, loading, refresh };
}
