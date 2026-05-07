"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { deriveVaultPda, deriveReserveAta, deriveShareMintPda } from "@/lib/pda";
import { formatTokenAmount, formatSharePrice, truncateAddress } from "@/lib/format";
import { CopyButton } from "@/components/shared/CopyButton";
import type { VaultEntry } from "@/lib/constants";

interface VaultSummary {
  entry: VaultEntry;
  vaultPda: PublicKey;
  totalDeposited: BN;
  shareSupply: BN;
  strategyCount: number;
  reserveBalance: BN;
  exists: boolean;
}

export function VaultList() {
  const { vaultEntries, activeEntry, hasActiveVault } = useVault();
  const { connection } = useConnection();
  const program = useVaultProgram();
  const [summaries, setSummaries] = useState<VaultSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      // Single batched RPC: 3N keys (vaultState, shareMint, reserveAta per
      // entry) into one getMultipleAccountsInfo. Replaces 3N sequential
      // calls with 1.
      const triples = vaultEntries.map((entry) => {
        const vaultPda = deriveVaultPda(entry.tokenMint, entry.vaultId);
        const shareMint = deriveShareMintPda(vaultPda);
        const reserveAta = deriveReserveAta(vaultPda, entry.tokenMint);
        return { entry, vaultPda, shareMint, reserveAta };
      });
      const keys = triples.flatMap((t) => [t.vaultPda, t.shareMint, t.reserveAta]);
      let infos: Awaited<ReturnType<typeof connection.getMultipleAccountsInfo>> = [];
      try {
        infos = await connection.getMultipleAccountsInfo(keys);
      } catch {
        // network failure — leave all entries as nonexistent
      }
      if (cancelled) return;

      const results: VaultSummary[] = triples.map((t, i) => {
        const vaultInfo = infos[i * 3];
        const shareInfo = infos[i * 3 + 1];
        const reserveInfo = infos[i * 3 + 2];
        if (!vaultInfo) {
          return {
            entry: t.entry,
            vaultPda: t.vaultPda,
            totalDeposited: new BN(0),
            shareSupply: new BN(0),
            strategyCount: 0,
            reserveBalance: new BN(0),
            exists: false,
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vault = (program.coder.accounts as any).decode("vaultState", vaultInfo.data);
        // SPL Mint: supply u64 LE at offset 36; SPL Token: amount u64 LE at offset 64.
        const shareSupply = shareInfo?.data && shareInfo.data.length >= 44
          ? new BN(shareInfo.data.subarray(36, 44), "le")
          : new BN(0);
        const reserveBalance = reserveInfo?.data && reserveInfo.data.length >= 72
          ? new BN(reserveInfo.data.subarray(64, 72), "le")
          : new BN(0);
        return {
          entry: t.entry,
          vaultPda: t.vaultPda,
          totalDeposited: vault.totalDeposited as BN,
          shareSupply,
          strategyCount: (vault.strategyCount as BN).toNumber(),
          reserveBalance,
          exists: true,
        };
      });

      if (!cancelled) {
        setSummaries(results);
        setLoading(false);
      }
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [program, connection, vaultEntries]);

  if (loading) {
    return (
      <ul className="grid gap-3">
        {vaultEntries.map((_, i) => (
          <li
            key={i}
            className="animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] h-32"
          />
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid gap-3">
      {summaries.map((s) => {
        const isActive =
          hasActiveVault &&
          s.entry.tokenMint.toBase58() === activeEntry.tokenMint.toBase58() &&
          s.entry.vaultId === activeEntry.vaultId;
        return (
          <li key={`${s.entry.tokenMint.toBase58()}:${s.entry.vaultId}`}>
            <VaultRow s={s} isActive={isActive} />
          </li>
        );
      })}
    </ul>
  );
}

function VaultRow({ s, isActive }: { s: VaultSummary; isActive: boolean }) {
  const sharePrice =
    s.exists && !s.shareSupply.isZero()
      ? formatSharePrice(s.totalDeposited, s.shareSupply, s.entry.tokenDecimals)
      : "—";

  const pdaStr = s.vaultPda.toBase58();

  return (
    <Link
      href={`/vault/${pdaStr}`}
      aria-label={`Open ${s.entry.name}`}
      className={`group block w-full rounded-xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] ${
        isActive
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:border-[var(--color-accent)]/50"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{s.entry.name}</h3>
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
              {s.entry.tokenSymbol}
            </span>
            {s.entry.demoVault ? (
              <span
                title="Demo vault — anyone can connect the embedded admin wallet to test admin actions"
                className="rounded-md border border-[var(--color-accent-secondary)]/50 bg-[var(--color-accent-secondary)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-secondary)]"
              >
                DEMO · everyone is admin
              </span>
            ) : null}
            {!s.exists ? (
              <span className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]">
                not initialized
              </span>
            ) : null}
            {isActive ? (
              <span className="rounded-md border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                Selected
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              vault_id={s.entry.vaultId} · {truncateAddress(pdaStr)}
            </span>
            <CopyButton value={pdaStr} ariaLabel="Copy vault address" />
          </div>
        </div>
        <span
          className="shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          aria-hidden
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Asset" value={s.entry.tokenSymbol} />
        <Stat
          label="TVL"
          value={
            s.exists
              ? `${formatTokenAmount(s.totalDeposited, s.entry.tokenDecimals)} ${s.entry.tokenSymbol}`
              : "—"
          }
        />
        <Stat label="Share price" value={sharePrice} />
        <Stat
          label="Strategies"
          value={s.exists ? s.strategyCount.toString() : "—"}
        />
      </dl>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}
