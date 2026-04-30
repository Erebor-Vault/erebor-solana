"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { PROGRAM_ID } from "@/lib/constants";
import { truncateAddress } from "@/lib/format";

interface ActivityRow {
  signature: string;
  slot: number;
  blockTime: number | null;
  eventName: string;
  /**
   * Raw event payload, JSON-serialised so we can render a one-line summary
   * without locking the type to a specific event variant.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /** Pubkey of the vault the event references (when known). */
  vault?: string;
}

/**
 * Decode all `Program data: <base64>` lines in a transaction's logs into
 * Anchor events. One transaction may emit several events.
 */
function extractEvents(
  logs: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coder: any
): { name: string; data: Record<string, unknown> }[] {
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    try {
      const decoded = coder.events.decode(m[1]);
      if (decoded) {
        out.push({ name: decoded.name, data: decoded.data });
      }
    } catch {
      // ignore non-Anchor logs
    }
  }
  return out;
}

/**
 * Activity feed for the active vault. Listens for live logs from the program
 * and decodes Anchor `#[event]` records via the IDL. Shows the 20 most recent
 * events that reference the active vault PDA.
 *
 * Caveat: this displays only events emitted while the page is open. A proper
 * historical backfill needs a paid RPC plus `getSignaturesForAddress` +
 * `getTransaction` per signature — left for an indexer-backed follow-up.
 */
export function ActivityFeed() {
  const { connection } = useConnection();
  const program = useVaultProgram();
  const { vaultPda } = useVault();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);

  // Stable string key so the effect doesn't re-subscribe on each render
  const vaultKey = vaultPda.toBase58();

  // Pull a small recent history once per vault, then live-subscribe
  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setBootstrapping(true);

    (async () => {
      try {
        const sigs: ConfirmedSignatureInfo[] = await connection.getSignaturesForAddress(
          PROGRAM_ID,
          { limit: 25 }
        );
        const out: ActivityRow[] = [];
        for (const s of sigs) {
          if (cancelled) return;
          if (s.err) continue;
          try {
            const tx = await connection.getTransaction(s.signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            const logs = tx?.meta?.logMessages ?? [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const ev of extractEvents(logs, program.coder as any)) {
              const vault =
                typeof ev.data?.vault === "object" && ev.data?.vault !== null
                  ? (ev.data.vault as { toBase58?: () => string }).toBase58?.()
                  : undefined;
              if (vault && vault !== vaultKey) continue;
              out.push({
                signature: s.signature,
                slot: s.slot,
                blockTime: s.blockTime ?? null,
                eventName: ev.name,
                data: ev.data,
                vault,
              });
            }
          } catch {
            // skip txs we can't fetch
          }
          if (out.length >= 20) break;
        }
        if (!cancelled) setRows(out);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, program, vaultKey]);

  // Live subscription
  useEffect(() => {
    const subId = connection.onLogs(
      PROGRAM_ID,
      (info, ctx) => {
        if (info.err) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = extractEvents(info.logs, program.coder as any);
        if (events.length === 0) return;
        setRows((prev) => {
          const additions: ActivityRow[] = [];
          for (const ev of events) {
            const vault =
              typeof ev.data?.vault === "object" && ev.data?.vault !== null
                ? (ev.data.vault as { toBase58?: () => string }).toBase58?.()
                : undefined;
            if (vault && vault !== vaultKey) continue;
            additions.push({
              signature: info.signature,
              slot: ctx.slot,
              blockTime: Math.floor(Date.now() / 1000),
              eventName: ev.name,
              data: ev.data,
              vault,
            });
          }
          if (additions.length === 0) return prev;
          // Newest first; cap at 20
          return [...additions, ...prev].slice(0, 20);
        });
      },
      "confirmed"
    );
    return () => {
      connection.removeOnLogsListener(subId);
    };
  }, [connection, program, vaultKey]);

  const visible = useMemo(() => rows.slice(0, 20), [rows]);

  return (
    <section className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold">Activity</h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          live program logs
        </span>
      </div>
      {bootstrapping && rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No activity yet for this vault. New events will appear here as
          they happen.
        </p>
      ) : (
        <ul className="space-y-2 text-sm font-mono">
          {visible.map((row, idx) => (
            <li
              key={`${row.signature}-${idx}`}
              className="flex flex-col gap-0.5 rounded-lg bg-[var(--color-surface)] px-3 py-2"
            >
              <span className="text-[var(--color-text-primary)]">
                {row.eventName}
                <ActivitySummary data={row.data} />
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {truncateAddress(row.signature, 6)} · slot {row.slot}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One-liner summaries for the most common event variants. Falls back to
// a short JSON render for anything else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActivitySummary({ data }: { data: any }) {
  if (!data) return null;
  const bits: string[] = [];
  if (data.amount) bits.push(`amount ${data.amount.toString?.() ?? data.amount}`);
  if (data.sharesMinted) bits.push(`shares ${data.sharesMinted.toString()}`);
  if (data.sharesBurned) bits.push(`shares ${data.sharesBurned.toString()}`);
  if (data.weightBps != null) bits.push(`weight ${data.weightBps}bps`);
  if (data.strategyId != null)
    bits.push(`strategy ${data.strategyId.toString?.() ?? data.strategyId}`);
  if (data.deltaSigned != null)
    bits.push(`delta ${data.deltaSigned.toString?.() ?? data.deltaSigned}`);
  if (typeof data.paused === "boolean")
    bits.push(data.paused ? "→ paused" : "→ unpaused");
  if (data.yieldAmount)
    bits.push(`yield ${data.yieldAmount.toString?.() ?? data.yieldAmount}`);
  if (bits.length === 0) return null;
  return <span className="ml-1 text-[var(--color-text-secondary)]">· {bits.join(" · ")}</span>;
}
