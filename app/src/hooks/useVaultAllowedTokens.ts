"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import {
  deriveAllowedTokenPda,
  deriveVaultAllowedTokenPda,
  deriveStrategyAuthorityPda,
  deriveValueSourcePda,
} from "@/lib/pda";
import { PROTOCOL_REGISTRY } from "@/lib/strategy-presets/registry";
import { getCluster } from "@/lib/constants";

const MAX_VALUE_SOURCES_PER_STRATEGY = 16;
const PYTH_MAX_STALENESS_SECS = 60;

/** mock_pyth feed PDA: seeds = [b"price", mint]. */
function derivePriceFeedPda(programId: PublicKey, mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("price"), mint.toBuffer()],
    programId,
  );
  return pda;
}

/** Read decimals byte from an SPL Mint account (offset 44). */
async function getMintDecimals(
  connection: { getAccountInfo: (k: PublicKey) => Promise<{ data: Buffer | Uint8Array } | null> },
  mint: PublicKey,
): Promise<number | null> {
  const info = await connection.getAccountInfo(mint);
  if (!info?.data || info.data.length < 45) return null;
  const data = info.data instanceof Uint8Array ? info.data : Uint8Array.from(info.data);
  return data[44];
}

/** Pick (scale_num, scale_den) so contribution lands in underlying-raw units.
 *  Pyth contribution = balance_raw × price × 10^expo (USD per 1 unit). The
 *  mint's balance_raw is in 10^mintDec; we want 10^underlyingDec USDC. */
function scaleForUsdcDenom(mintDec: number, underlyingDec: number): { num: BN; den: BN } {
  const diff = underlyingDec - mintDec;
  if (diff === 0) return { num: new BN(1), den: new BN(1) };
  if (diff > 0) return { num: new BN(10).pow(new BN(diff)), den: new BN(1) };
  return { num: new BN(1), den: new BN(10).pow(new BN(-diff)) };
}

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
        const provider = program.provider as {
          sendAndConfirm?: (tx: Transaction) => Promise<string>;
          connection: {
            getLatestBlockhash: () => Promise<{ blockhash: string }>;
            getAccountInfo: (k: PublicKey) => Promise<{ data: Buffer | Uint8Array } | null>;
          };
        };
        if (!provider.sendAndConfirm) {
          throw new Error("Anchor provider has no sendAndConfirm");
        }

        // Active strategies — used for the auto value-source plumbing on add
        // and removal. Skip the underlying vault mint (already accounted for
        // by the reserve / strategy ATA on every strategy).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allStrategies = await (program.account as any).strategyAllocation.all([
          { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
        ]);
        const activeStrategies = allStrategies
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((s: any) => s.account.isActive)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((s: any) => ({
            pubkey: s.publicKey as PublicKey,
            id: s.account.strategyId as BN,
          }));

        // Per-strategy used-slot bitmap so we can hand out fresh value-source
        // indices without a duplicate-PDA collision (one query per strategy).
        const usedSlotsByStrategy = new Map<string, Set<number>>();
        for (const s of activeStrategies) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vsRows = await (program.account as any).valueSource.all([
            // ValueSource layout: [disc:8][vault:32][strategy:32]…
            { memcmp: { offset: 8 + 32, bytes: s.pubkey.toBase58() } },
          ]);
          usedSlotsByStrategy.set(
            s.pubkey.toBase58(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            new Set(vsRows.map((r: any) => r.account.index as number)),
          );
        }
        const allocateSlot = (strategyKey: string): number | null => {
          const used = usedSlotsByStrategy.get(strategyKey) ?? new Set<number>();
          for (let i = 0; i < MAX_VALUE_SOURCES_PER_STRATEGY; i++) {
            if (!used.has(i)) {
              used.add(i);
              usedSlotsByStrategy.set(strategyKey, used);
              return i;
            }
          }
          return null;
        };

        const underlyingMint = vault?.tokenMint as PublicKey | undefined;

        // Resolve cluster's mock-Pyth program (devnet has one; mainnet has
        // null until real Pyth feed wiring lands). When null we still add
        // the kind=0 balance source — just no USD pricing.
        const cluster = getCluster();
        const mockPythProgramId = PROTOCOL_REGISTRY[cluster]?.mockPythProgramId ?? null;

        // Underlying decimals — needed to compute the Pyth scale so the
        // contribution lands in underlying-raw units (e.g. USDC has 6 dp,
        // wSOL has 9 → scale 1/1000).
        const underlyingDecimals = underlyingMint
          ? await getMintDecimals(provider.connection as never, underlyingMint)
          : null;

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

          // Auto value-source per active strategy:
          //   slot A: kind=0 SplAtaBalance — strategy_authority[i]'s ATA
          //   slot B: kind=2 PythPriceFeed — mock-Pyth feed for `mint`,
          //           with mint_balance_source_index = A and a scale that
          //           converts (balance × USD-price) into underlying-raw.
          // Skips the underlying mint (already accounted for).
          if (underlyingMint && mint.equals(underlyingMint)) continue;

          const mintDecimals = await getMintDecimals(provider.connection as never, mint);
          const havePyth =
            mockPythProgramId !== null &&
            mintDecimals !== null &&
            underlyingDecimals !== null;
          const pythScale = havePyth
            ? scaleForUsdcDenom(mintDecimals!, underlyingDecimals!)
            : null;

          for (const s of activeStrategies) {
            const balanceSlot = allocateSlot(s.pubkey.toBase58());
            if (balanceSlot === null) continue; // strategy is full; skip silently
            const sAuth = deriveStrategyAuthorityPda(vaultPda, s.id.toNumber());
            const ata = getAssociatedTokenAddressSync(mint, sAuth, true);
            ixs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ata,
                sAuth,
                mint,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
            const balanceVsPda = deriveValueSourcePda(s.pubkey, balanceSlot);
            // Scale 0/1 when a Pyth companion follows: the kind=0 row is then
            // a *balance carrier* only — its raw balance is exposed to the
            // Pyth source via `mint_balance_source_index` but contributes
            // zero to total_value (Pyth supplies the priced contribution).
            // Scale 1/1 only if no Pyth feed → raw balance becomes the
            // contribution (correct only for underlying-decimal stables).
            const balScaleNum = havePyth ? new BN(0) : new BN(1);
            const balScaleDen = new BN(1);
            ixs.push(
              await program.methods
                .addValueSource(s.id, balanceSlot, 0, ata, new BN(0), balScaleNum, balScaleDen, 0, 0)
                .accountsStrict({
                  admin: wallet.publicKey,
                  vaultState: vaultPda,
                  strategy: s.pubkey,
                  valueSource: balanceVsPda,
                  systemProgram: SystemProgram.programId,
                })
                .instruction(),
            );

            // Without Pyth, contribution = raw balance × 1/1 — wrong for
            // any mint whose decimals or USD price differ from underlying.
            // Skip the kind=2 source on mainnet until real feeds are wired.
            if (!havePyth || !pythScale) continue;
            const pythSlot = allocateSlot(s.pubkey.toBase58());
            if (pythSlot === null) continue;
            const feedPda = derivePriceFeedPda(mockPythProgramId!, mint);
            const pythVsPda = deriveValueSourcePda(s.pubkey, pythSlot);
            ixs.push(
              await program.methods
                .addValueSource(
                  s.id,
                  pythSlot,
                  2,
                  feedPda,
                  new BN(0),
                  pythScale.num,
                  pythScale.den,
                  balanceSlot,
                  PYTH_MAX_STALENESS_SECS,
                )
                .accountsStrict({
                  admin: wallet.publicKey,
                  vaultState: vaultPda,
                  strategy: s.pubkey,
                  valueSource: pythVsPda,
                  systemProgram: SystemProgram.programId,
                })
                .instruction(),
            );
          }
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

          // Best-effort cleanup of the auto-added value sources: the kind=0
          // SplAtaBalance pointing at the strategy ATA AND the kind=2
          // PythPriceFeed pointing at the mock-pyth feed PDA for this mint.
          if (underlyingMint && mint.equals(underlyingMint)) continue;
          const feedPda =
            mockPythProgramId !== null ? derivePriceFeedPda(mockPythProgramId, mint) : null;
          for (const s of activeStrategies) {
            const sAuth = deriveStrategyAuthorityPda(vaultPda, s.id.toNumber());
            const ata = getAssociatedTokenAddressSync(mint, sAuth, true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const vsRows = await (program.account as any).valueSource.all([
              { memcmp: { offset: 8, bytes: s.pubkey.toBase58() } },
            ]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const matching = vsRows.filter((r: any) => {
              const target = r.account.targetAccount as PublicKey;
              return target.equals(ata) || (feedPda !== null && target.equals(feedPda));
            });
            for (const m of matching) {
              ixs.push(
                await program.methods
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .removeValueSource(s.id, (m as any).account.index as number)
                  .accountsStrict({
                    admin: wallet.publicKey,
                    vaultState: vaultPda,
                    strategy: s.pubkey,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    valueSource: (m as any).publicKey as PublicKey,
                  })
                  .instruction(),
              );
            }
          }
        }

        // Solana caps a tx at ~64 instructions and ~1232 bytes serialized;
        // each add ix carries ~7 accounts so practically we can fit ~30
        // adds in one tx. For batches over that, fall back to chunked txs.
        // Each add-mint can fan out to 1 + 2*N_strategies instructions
        // (the addVaultAllowedToken ix + createATA + addValueSource per
        // active strategy). Keep CHUNK low so we don't blow the 1232-byte
        // tx limit even at full strategy count.
        const CHUNK = 4;
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
