"use client";

import { useState } from "react";
import { VaultStats } from "@/components/vault/VaultStats";
import { UserPosition } from "@/components/vault/UserPosition";
import { DepositForm } from "@/components/vault/DepositForm";
import { WithdrawForm } from "@/components/vault/WithdrawForm";

export default function DashboardPage() {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Vault Dashboard</h1>
        <p className="text-[var(--color-text-secondary)]">
          Deposit tokens to earn yield from multi-strategy allocations
        </p>
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
