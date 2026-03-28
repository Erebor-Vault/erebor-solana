"use client";

import { useState } from "react";
import { VaultList } from "@/components/vault/VaultList";
import { VaultStats } from "@/components/vault/VaultStats";
import { UserPosition } from "@/components/vault/UserPosition";
import { DepositForm } from "@/components/vault/DepositForm";
import { WithdrawForm } from "@/components/vault/WithdrawForm";
import { useVault } from "@/components/providers/VaultProvider";

export default function DashboardPage() {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const { activeEntry } = useVault();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Vault Dashboard</h1>
        <p className="text-[var(--color-text-secondary)]">
          Deposit tokens to earn yield from multi-strategy allocations
        </p>
      </div>

      <VaultList />

      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold">{activeEntry.name}</h2>
        <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs font-medium">
          {activeEntry.tokenSymbol}
        </span>
      </div>

      <VaultStats />

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-6">
          <div className="flex gap-1 mb-6">
            <button
              onClick={() => setTab("deposit")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === "deposit"
                  ? "bg-[var(--color-accent)] text-black"
                  : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setTab("withdraw")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === "withdraw"
                  ? "bg-[var(--color-accent-secondary)] text-white"
                  : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Withdraw
            </button>
          </div>
          {tab === "deposit" ? <DepositForm /> : <WithdrawForm />}
        </div>

        <UserPosition />
      </div>
    </div>
  );
}
