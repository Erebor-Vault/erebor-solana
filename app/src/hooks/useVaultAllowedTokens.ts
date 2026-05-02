"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import {
  deriveAllowedTokenPda,
  deriveVaultAllowedTokenPda,
} from "@/lib/pda";

export interface VaultAllowedTokenCandidate {
  /** Mint pubkey (from the protocol-level allow-list — the candidate set). */
  mint: PublicKey;
  /** True if this vault has already added the mint to its per-vault list. */
  enabled: boolean;
}

/**
 * Reads both lists for the active vault:
 *   - protocol-level `AllowedToken` PDAs (governance-controlled candidate set)
 *   - per-vault `VaultAllowedToken` PDAs (admin's chosen subset)
 *
 * Returns one row per protocol-level mint with an `enabled` flag. Exposes
 * `applyDiff(targetMints)` which submits a single transaction with the
 * required `add_vault_allowed_token` / `remove_vault_allowed_token`
 * instructions to converge to the target set. Admin-signed.
 */
export function useVaultAllowedTokens() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, vault, hasActiveVault } = useVault();

  const [protocolMints, setProtocolMints] = useState<PublicKey[]>([]);
  const [vaultMints, setVaultMints] = useState<PublicKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!program || !hasActiveVault) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [protocolList, vaultList] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (program.account as any).allowedToken.all(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (program.account as any).vaultAllowedToken.all([
          {
            memcmp: {
              // VaultAllowedToken: [discriminator(8), vault(32), mint(32), …]
              offset: 8,
              bytes: vaultPda.toBase58(),
            },
          },
        ]),
      ]);
      setProtocolMints(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        protocolList.map((a: any) => a.account.mint as PublicKey)
      );
      setVaultMints(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vaultList.map((a: any) => a.account.mint as PublicKey)
      );
    } catch (err) {
      console.warn("useVaultAllowedTokens fetch failed:", err);
      setProtocolMints([]);
      setVaultMints([]);
    } finally {
      setLoading(false);
    }
  }, [program, hasActiveVault, vaultPda]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Stable per-render derivation. Sorted alphabetically by base58 so the
   *  list ordering doesn't flap as new mints are added. */
  const candidates = useMemo<VaultAllowedTokenCandidate[]>(() => {
    const enabled = new Set(vaultMints.map((m) => m.toBase58()));
    return [...protocolMints]
      .sort((a, b) => a.toBase58().localeCompare(b.toBase58()))
      .map((mint) => ({
        mint,
        enabled: enabled.has(mint.toBase58()),
      }));
  }, [protocolMints, vaultMints]);

  const isAdmin =
    !!wallet.publicKey && !!vault && wallet.publicKey.equals(vault.admin);

  /** Apply a diff: any mint in `target` that isn't currently enabled gets
   *  added; any currently-enabled mint not in `target` gets removed. Single
   *  transaction. Returns the signature. */
  const applyDiff = useCallback(
    async (target: PublicKey[]): Promise<string> => {
      if (!program || !wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Wallet not connected");
      }
      if (!isAdmin) {
        throw new Error("Only the vault admin can edit the per-vault list");
      }

      const targetSet = new Set(target.map((m) => m.toBase58()));
      const currentSet = new Set(vaultMints.map((m) => m.toBase58()));
      const protocolSet = new Set(protocolMints.map((m) => m.toBase58()));

      // Validate each target is on the protocol list (the program will
      // revert otherwise; pre-checking gives a friendlier error).
      for (const m of target) {
        if (!protocolSet.has(m.toBase58())) {
          throw new Error(
            `Mint ${m.toBase58()} is not on the protocol allow-list — ` +
              `governance must add it first.`
          );
        }
      }

      const toAdd = target.filter((m) => !currentSet.has(m.toBase58()));
      const toRemove = vaultMints.filter((m) => !targetSet.has(m.toBase58()));

      if (toAdd.length === 0 && toRemove.length === 0) {
        throw new Error("No changes to apply");
      }

      setSubmitting(true);
      try {
        const ixs: TransactionInstruction[] = [];

        for (const mint of toAdd) {
          const allowedToken = deriveAllowedTokenPda(mint);
          const vaultAllowedToken = deriveVaultAllowedTokenPda(vaultPda, mint);
          const ix = await program.methods
            .addVaultAllowedToken(mint)
            .accountsStrict({
              admin: wallet.publicKey,
              vaultState: vaultPda,
              allowedToken,
              vaultAllowedToken,
              systemProgram: SystemProgram.programId,
            })
            .instruction();
          ixs.push(ix);
        }

        for (const mint of toRemove) {
          const vaultAllowedToken = deriveVaultAllowedTokenPda(vaultPda, mint);
          const ix = await program.methods
            .removeVaultAllowedToken(mint)
            .accountsStrict({
              admin: wallet.publicKey,
              vaultState: vaultPda,
              vaultAllowedToken,
            })
            .instruction();
          ixs.push(ix);
        }

        // Solana caps a tx at ~64 instructions and ~1232 bytes serialized;
        // each add ix carries ~7 accounts so practically we can fit ~30
        // adds in one tx. For batches over that, fall back to chunked txs.
        const CHUNK = 8;
        const provider = program.provider as {
          sendAndConfirm?: (tx: Transaction) => Promise<string>;
          connection: { getLatestBlockhash: () => Promise<{ blockhash: string }> };
        };
        if (!provider.sendAndConfirm) {
          throw new Error("Anchor provider has no sendAndConfirm");
        }

        let lastSig = "";
        for (let i = 0; i < ixs.length; i += CHUNK) {
          const slice = ixs.slice(i, i + CHUNK);
          const tx = new Transaction();
          for (const ix of slice) tx.add(ix);
          tx.feePayer = wallet.publicKey;
          const { blockhash } = await provider.connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          lastSig = await provider.sendAndConfirm(tx);
        }
        await refresh();
        return lastSig;
      } finally {
        setSubmitting(false);
      }
    },
    [program, wallet, isAdmin, vaultMints, protocolMints, vaultPda, refresh]
  );

  return {
    candidates,
    loading,
    submitting,
    isAdmin,
    refresh,
    applyDiff,
    /** Convenience counts. */
    counts: {
      protocol: protocolMints.length,
      enabled: vaultMints.length,
    },
  };
}
