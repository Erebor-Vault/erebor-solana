"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";

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

/**
 * Fetch all `AllowedAction` PDAs for a given strategy. Powers the per-strategy
 * whitelist editor — the editor lists existing entries (each removable) and
 * lets the admin add new ones.
 *
 * Implementation: `program.account.allowedAction.all([memcmp on .strategy])`.
 * Anchor handles the discriminator filter; we add a single memcmp on the
 * `strategy` field at offset 8 (account-discriminator) + 32 (vault).
 */
export function useAllowedActions(strategy: PublicKey | null) {
  const program = useVaultProgram();
  const [rows, setRows] = useState<AllowedActionRow[]>([]);
  const [loading, setLoading] = useState(false);

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
            offset: 8 + 32, // skip discriminator + vault pubkey
            bytes: strategy.toBase58(),
          },
        },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = await (program.account as any).allowedAction.all(filters);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: AllowedActionRow[] = accounts.map((a: any) => ({
        publicKey: a.publicKey,
        vault: a.account.vault,
        strategy: a.account.strategy,
        strategyId: a.account.strategyId,
        targetProgram: a.account.targetProgram,
        // Anchor returns [u8; 8] as a number array; coerce to plain array.
        discriminator: Array.from(a.account.discriminator),
        expectedRecipientIndex: Number(a.account.expectedRecipientIndex),
        outputMintIndex:
          a.account.outputMintIndex == null ? null : Number(a.account.outputMintIndex),
        bump: a.account.bump,
      }));
      setRows(mapped);
    } catch (err) {
      console.error("useAllowedActions fetch failed:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [program, strategy]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rows, loading, refresh };
}
