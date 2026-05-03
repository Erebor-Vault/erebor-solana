"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { PROGRAM_ID } from "@/lib/constants";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const SIG_LIMIT = 200;

interface YieldPoint {
  ts: number;
  apyBps: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeEvents(logs: string[], coder: any) {
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    try {
      const decoded = coder.events.decode(m[1]);
      if (decoded) out.push({ name: decoded.name, data: decoded.data });
    } catch {
      /* not anchor */
    }
  }
  return out;
}

function bnToNumber(v: unknown): number {
  if (v == null) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = v as any;
  if (typeof a === "number") return a;
  if (typeof a === "bigint") return Number(a);
  if (typeof a?.toNumber === "function") {
    try {
      return a.toNumber();
    } catch {
      return Number(a.toString());
    }
  }
  if (typeof a?.toString === "function") return Number(a.toString());
  return 0;
}

export function ApyHistoryChart() {
  const { connection } = useConnection();
  const program = useVaultProgram();
  const { activeEntry, vaultPda, hasActiveVault } = useVault();
  const [points, setPoints] = useState<YieldPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const vaultKey = hasActiveVault ? vaultPda.toBase58() : "";

  useEffect(() => {
    if (!hasActiveVault) return;
    let cancelled = false;
    setLoading(true);
    setPoints(null);

    (async () => {
      try {
        const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, {
          limit: SIG_LIMIT,
        });
        const yieldEvents: { ts: number; signedDelta: number; principal: number }[] = [];
        for (const s of sigs) {
          if (cancelled) return;
          if (s.err || !s.blockTime) continue;
          const tx = await connection.getTransaction(s.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          const logs = tx?.meta?.logMessages ?? [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const ev of decodeEvents(logs, program.coder as any)) {
            const data = ev.data;
            const v = data?.vault as { toBase58?: () => string } | undefined;
            if (v?.toBase58?.() !== vaultKey) continue;
            if (ev.name === "YieldReported") {
              yieldEvents.push({
                ts: s.blockTime,
                signedDelta: bnToNumber(data.yieldAmount),
                principal: Math.max(1, bnToNumber(data.newTotalDeposited) - bnToNumber(data.yieldAmount)),
              });
            } else if (ev.name === "LossReported") {
              yieldEvents.push({
                ts: s.blockTime,
                signedDelta: -bnToNumber(data.amount),
                principal: Math.max(1, bnToNumber(data.newTotalDeposited) + bnToNumber(data.amount)),
              });
            } else if (ev.name === "StrategyValueSettled") {
              const delta = bnToNumber(data.deltaSigned);
              const prevAlloc = bnToNumber(data.previousAllocated);
              if (prevAlloc > 0) {
                yieldEvents.push({
                  ts: s.blockTime,
                  signedDelta: delta,
                  principal: Math.max(1, prevAlloc),
                });
              }
            }
          }
        }
        if (cancelled) return;
        // chronological
        yieldEvents.sort((a, b) => a.ts - b.ts);
        const series: YieldPoint[] = [];
        let prevTs = 0;
        for (const e of yieldEvents) {
          const dt = prevTs === 0 ? 24 * 60 * 60 : Math.max(60, e.ts - prevTs);
          const periodReturn = e.signedDelta / e.principal;
          const apyBps = periodReturn * (SECONDS_PER_YEAR / dt) * 10_000;
          series.push({ ts: e.ts, apyBps });
          prevTs = e.ts;
        }
        setPoints(series);
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, program, vaultKey, hasActiveVault]);

  const chartData = useMemo(() => {
    if (!points) return [];
    // 7-point rolling average to smooth single-event spikes
    const window = 5;
    return points.map((p, i) => {
      const lo = Math.max(0, i - window + 1);
      const slice = points.slice(lo, i + 1);
      const avg = slice.reduce((s, x) => s + x.apyBps, 0) / slice.length;
      const d = new Date(p.ts * 1000);
      return {
        date: `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
        apy: Number((avg / 100).toFixed(2)),
      };
    });
  }, [points]);

  if (!hasActiveVault) return null;

  const latest = chartData[chartData.length - 1]?.apy ?? 0;
  const first = chartData[0]?.apy ?? 0;
  const delta = latest - first;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold tracking-tight">
            Vault APY history
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Annualised yield from on-chain reports · vault {activeEntry.vaultId}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-semibold tracking-tight">
            {chartData.length > 0 ? `${latest.toFixed(2)}%` : "—"}
          </div>
          {chartData.length > 1 ? (
            <div
              className={`text-xs ${
                delta >= 0
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-danger)]"
              }`}
            >
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(2)}% vs first report
            </div>
          ) : null}
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : chartData.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No yield reports for this vault yet. Run the yield crank or wait for
          a strategy to settle.
        </p>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="apy-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="var(--color-text-muted)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                stroke="var(--color-text-muted)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}%`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => [`${v}%`, "APY"]}
              />
              <Area
                type="monotone"
                dataKey="apy"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fill="url(#apy-fill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
