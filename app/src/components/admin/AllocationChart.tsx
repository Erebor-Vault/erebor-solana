"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useVault } from "@/components/providers/VaultProvider";
import { useStrategies } from "@/hooks/useStrategies";
import { formatTokenAmount } from "@/lib/format";

const COLORS = ["#14f195", "#9945ff", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

export function AllocationChart() {
  const { reserveBalance, vault, loading: vaultLoading } = useVault();
  const { strategies, loading: strategiesLoading } = useStrategies();

  if (vaultLoading || strategiesLoading) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-6">
        <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4">
          Fund Allocation
        </h3>
        <div className="h-64 flex items-center justify-center">
          <div className="animate-pulse text-[var(--color-text-secondary)]">Loading…</div>
        </div>
      </div>
    );
  }

  if (!vault || vault.totalDeposited.isZero()) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-6 text-center">
        <p className="text-[var(--color-text-secondary)]">No funds to display</p>
      </div>
    );
  }

  const data = [
    {
      name: "Reserve",
      value: reserveBalance.toNumber(),
    },
    ...strategies
      .filter((s) => s.totalValue.toNumber() > 0)
      .map((s) => ({
        name: `Strategy #${s.strategyId.toString()}`,
        value: s.totalValue.toNumber(),
      })),
  ];

  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-6">
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4">
        Fund Allocation
      </h3>
      <div className="h-64" style={{ minWidth: 0, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((_, index) => (
                <Cell
                  key={index}
                  fill={COLORS[index % COLORS.length]}
                  stroke="transparent"
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1d2e",
                border: "1px solid #2a2e45",
                borderRadius: "8px",
                color: "#e2e8f0",
              }}
              formatter={(value) => formatTokenAmount(Number(value)) + " USDC"}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 space-y-2">
        {data.map((item, i) => (
          <div key={item.name} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span>{item.name}</span>
            </div>
            <span className="text-[var(--color-text-secondary)]">
              {formatTokenAmount(item.value)} USDC
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
