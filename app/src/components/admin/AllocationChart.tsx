"use client";

import { useId, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { useStrategies } from "@/hooks/useStrategies";
import { formatTokenAmount } from "@/lib/format";

const STRATEGY_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#f97316",
  "#6366f1",
];
const RESERVE_COLOR = "#71717a";

type Slice = { name: string; value: number; raw: BN; color: string };

export function AllocationChart() {
  const titleId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { reserveBalance, vault, activeEntry, loading: vaultLoading } = useVault();
  const { strategies, loading: strategiesLoading } = useStrategies();

  const symbol = activeEntry.tokenSymbol;
  const decimals = activeEntry.tokenDecimals;

  if (vaultLoading || strategiesLoading) {
    return (
      <ChartShell titleId={titleId}>
        <div className="flex h-[280px] items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Loading…
        </div>
      </ChartShell>
    );
  }

  if (!vault || vault.totalDeposited.isZero()) {
    return (
      <ChartShell titleId={titleId}>
        <div className="flex h-[280px] items-center justify-center text-sm text-[var(--color-text-muted)]">
          No funds allocated yet.
        </div>
      </ChartShell>
    );
  }

  const rows: Slice[] = [];
  if (!reserveBalance.isZero()) {
    rows.push({
      name: "Reserve",
      value: reserveBalance.toNumber(),
      raw: reserveBalance,
      color: RESERVE_COLOR,
    });
  }
  strategies.forEach((s, i) => {
    if (!s.isActive) return;
    if (s.allocatedAmount.isZero()) return;
    rows.push({
      name: `Strategy #${s.strategyId.toString()}`,
      value: s.allocatedAmount.toNumber(),
      raw: s.allocatedAmount,
      color: STRATEGY_COLORS[i % STRATEGY_COLORS.length],
    });
  });

  const total = rows.reduce((acc, r) => acc + r.value, 0);
  const totalRaw = vault.totalDeposited;

  if (rows.length === 0 || total === 0) {
    return (
      <ChartShell titleId={titleId}>
        <div className="flex h-[280px] items-center justify-center text-sm text-[var(--color-text-muted)]">
          No funds allocated yet.
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell titleId={titleId}>
      <div className="relative mx-auto h-[280px] w-full max-w-[320px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={3}
              cornerRadius={6}
              stroke="var(--color-surface-secondary)"
              strokeWidth={2}
              onMouseEnter={(_, i) => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              isAnimationActive
            >
              {rows.map((r, i) => (
                <Cell
                  key={r.name}
                  fill={r.color}
                  style={{
                    transformOrigin: "center",
                    transform: activeIndex === i ? "scale(1.04)" : "scale(1)",
                    transition: "transform 150ms ease-out",
                    cursor: "pointer",
                  }}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-tertiary, #1a1d2e)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--color-text-primary)",
              }}
              formatter={(_, name, entry) => {
                const raw = (entry.payload as Slice).raw;
                const value = (entry.payload as Slice).value;
                const pct = ((value / total) * 100).toFixed(1);
                return [
                  `${formatTokenAmount(raw, decimals)} ${symbol} (${pct}%)`,
                  name,
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden
        >
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Total
          </span>
          <span className="mt-1 text-base font-semibold tabular-nums">
            {formatTokenAmount(totalRaw, decimals)}
            <span className="ml-1 text-xs text-[var(--color-text-muted)]">
              {symbol}
            </span>
          </span>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: r.color }}
            />
            <span className="truncate text-[var(--color-text-secondary)]">
              {r.name}
            </span>
            <span className="ml-auto font-medium tabular-nums">
              {((r.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </ChartShell>
  );
}

function ChartShell({
  titleId,
  children,
}: {
  titleId: string;
  children: React.ReactNode;
}) {
  return (
    <figure
      aria-labelledby={titleId}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6"
    >
      <figcaption
        id={titleId}
        className="mb-4 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]"
      >
        Allocation
      </figcaption>
      {children}
    </figure>
  );
}
