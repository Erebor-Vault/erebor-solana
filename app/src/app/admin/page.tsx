"use client";

import { useState } from "react";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { StrategyList } from "@/components/admin/StrategyList";
import { CreateStrategyForm } from "@/components/admin/CreateStrategyForm";
import { AllocationChart } from "@/components/admin/AllocationChart";
import { useStrategies } from "@/hooks/useStrategies";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { useVault } from "@/components/providers/VaultProvider";
import { truncateAddress } from "@/lib/format";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminContent />
    </AdminGuard>
  );
}

function AdminContent() {
  const { vault } = useVault();
  const { strategies, refresh } = useStrategies();
  const { rebalanceAll, loading: rebalanceLoading } = useAuthorityActions();
  const [rebalancing, setRebalancing] = useState(false);

  const activeStrategies = strategies.filter((s) => s.isActive);
  const totalWeight = activeStrategies.reduce((sum, s) => sum + s.targetWeightBps, 0);

  const handleRebalanceAll = async () => {
    if (!vault) return;
    setRebalancing(true);
    try {
      const sigs = await rebalanceAll(
        activeStrategies.map((s) => ({
          strategyId: s.strategyId.toNumber(),
          tokenAccount: s.tokenAccount,
          allocatedAmount: s.allocatedAmount,
          targetWeightBps: s.targetWeightBps,
        })),
        vault.totalDeposited.toNumber()
      );
      if (sigs.length > 0) {
        showTxSuccess(sigs[sigs.length - 1]);
      }
      await refresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setRebalancing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">Admin Panel</h1>
          {vault && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Admin: {truncateAddress(vault.admin.toBase58())} · Authority:{" "}
              {truncateAddress(vault.authority.toBase58())}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          {activeStrategies.length > 0 && (
            <button
              onClick={handleRebalanceAll}
              disabled={rebalancing || rebalanceLoading}
              className="rounded-lg bg-[var(--color-accent)]/20 px-4 py-2 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50 hover:bg-[var(--color-accent)]/30 transition-colors"
            >
              {rebalancing ? "Rebalancing..." : `Rebalance All (${(totalWeight / 100).toFixed(0)}% allocated)`}
            </button>
          )}
          <CreateStrategyForm onCreated={refresh} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4">Strategies</h2>
          <StrategyList />
        </div>
        <div>
          <AllocationChart />
        </div>
      </div>
    </div>
  );
}
