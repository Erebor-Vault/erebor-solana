"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { useStrategies } from "@/hooks/useStrategies";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { deriveStrategyAuthorityPda } from "@/lib/pda";

const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");

export interface TokenMixRow {
  mint: PublicKey;
  /** Total raw amount across every active strategy_authority's ATA (and the
   *  strategy_token PDA for the underlying mint). */
  totalRaw: BN;
  /** Mint decimals (read from the Mint account's byte 44). */
  decimals: number;
  /** USD-equivalent value (decimal). For the underlying we trust the mint's
   *  decimal scaling; for others we use the mock-pyth feed if it exists. */
  usdValue: number | null;
  /** True if this row is the underlying token of the vault. */
  isUnderlying: boolean;
}

function derivePriceFeedPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("price"), mint.toBuffer()], MOCK_PYTH)[0];
}

/**
 * Aggregates token holdings across every active strategy in the vault:
 *   - Underlying mint: sum of each strategy's `strategy_token` PDA balance.
 *   - Other allow-listed mints: sum of `(mint, strategy_authority[i])` ATAs.
 * Tries to compute USD-equivalent value for each row by reading the
 * matching mock-pyth feed PDA. Falls back to `null` if no feed exists yet.
 *
 * Polls every 30s.
 */
export function useTokenMix(): { rows: TokenMixRow[]; totalUsd: number; loading: boolean } {
  const { connection } = useConnection();
  const program = useVaultProgram();
  const { vaultPda, vault, reserveBalance, hasActiveVault } = useVault();
  const { strategies } = useStrategies();

  const [rows, setRows] = useState<TokenMixRow[]>([]);
  const [loading, setLoading] = useState(false);

  const activeStrategies = useMemo(
    () => strategies.filter((s) => s.isActive),
    [strategies],
  );

  const underlyingMintB58 = vault?.tokenMint?.toBase58();

  useEffect(() => {
    let cancelled = false;
    if (!program || !hasActiveVault || !vault || activeStrategies.length === 0) {
      setRows([]);
      return;
    }

    const tick = async () => {
      setLoading(true);
      try {
        // 1. Fetch the per-vault enabled allow-list.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enabled = await (program.account as any).vaultAllowedToken.all([
          { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
        ]);
        const otherMints: PublicKey[] = enabled
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r.account.mint as PublicKey)
          .filter((m: PublicKey) => m.toBase58() !== underlyingMintB58);

        const underlying = vault.tokenMint as PublicKey;
        const allMints: PublicKey[] = [underlying, ...otherMints];

        // 2. Build the batched account fetch list:
        //    - 1 mint account per token (decimals)
        //    - 1 feed PDA per token (price × expo)
        //    - N balance accounts per token: strategy_token PDAs for the
        //      underlying, strategy_authority ATAs for the others
        const mintKeys = allMints.map((m) => m);
        const feedKeys = allMints.map((m) => derivePriceFeedPda(m));
        const balanceMatrix: PublicKey[][] = allMints.map((mint) =>
          activeStrategies.map((s) => {
            if (mint.equals(underlying)) {
              // strategy_token PDA = the underlying ATA owned by strategy_authority[i]
              return s.tokenAccount;
            }
            return getAssociatedTokenAddressSync(
              mint,
              deriveStrategyAuthorityPda(vaultPda, s.strategyId.toNumber()),
              true,
            );
          }),
        );
        const allKeys = [...mintKeys, ...feedKeys, ...balanceMatrix.flat()];
        const infos = await connection.getMultipleAccountsInfo(allKeys, "confirmed");

        const out: TokenMixRow[] = [];
        for (let i = 0; i < allMints.length; i++) {
          const mint = allMints[i];
          const isUnderlying = mint.equals(underlying);
          const mintInfo = infos[i];
          const decimals =
            mintInfo?.data && mintInfo.data.length >= 45 ? mintInfo.data[44] : 0;
          const feedInfo = infos[allMints.length + i];
          const ataStart = 2 * allMints.length + i * activeStrategies.length;
          const ataInfos = infos.slice(ataStart, ataStart + activeStrategies.length);

          let total = new BN(0);
          for (const info of ataInfos) {
            if (info?.data && info.data.length >= 72) {
              total = total.add(
                new BN(Uint8Array.prototype.slice.call(info.data, 64, 72), "le"),
              );
            }
          }
          // The idle reserve sits in vault_authority's underlying ATA, not
          // in any strategy_authority's ATA — fold it into the underlying
          // row so the panel total reconciles with vault.total_deposited.
          if (isUnderlying) total = total.add(reserveBalance);
          if (total.isZero() && !isUnderlying) continue;

          // USD value: underlying assumed $1; others priced via mock-pyth.
          let usdValue: number | null = null;
          const balanceHuman = total.toNumber() / Math.pow(10, decimals);
          if (isUnderlying) {
            usdValue = balanceHuman;
          } else if (feedInfo?.data && feedInfo.data.length >= 28) {
            // mock_pyth layout: [disc:8][price:i64 @8][expo:i32 @16][publish:i64 @20]
            const price = Number(feedInfo.data.readBigInt64LE(8));
            const expo = feedInfo.data.readInt32LE(16);
            usdValue = balanceHuman * price * Math.pow(10, expo);
          }

          out.push({
            mint,
            totalRaw: total,
            decimals,
            usdValue,
            isUnderlying,
          });
        }

        // Sort: underlying first, then by USD value desc, unknowns last.
        out.sort((a, b) => {
          if (a.isUnderlying) return -1;
          if (b.isUnderlying) return 1;
          if (a.usdValue == null) return 1;
          if (b.usdValue == null) return -1;
          return b.usdValue - a.usdValue;
        });

        if (!cancelled) setRows(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [
    program,
    hasActiveVault,
    vault,
    vaultPda,
    activeStrategies,
    underlyingMintB58,
    reserveBalance,
    connection,
  ]);

  const totalUsd = rows.reduce((acc, r) => acc + (r.usdValue ?? 0), 0);

  return { rows, totalUsd, loading };
}
