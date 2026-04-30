"use client";

import { VaultList } from "@/components/vault/VaultList";
import { AggregateStats } from "@/components/vault/AggregateStats";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Your vaults</h1>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          Erebor multi-strategy vaults on Solana. Each strategy is bounded
          by an SPL delegate; the agent never holds principal. Click a
          vault to deposit, withdraw, or manage strategies.
        </p>
      </header>

      <AggregateStats />

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Vaults</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Click a vault to open its dashboard.
          </p>
        </div>
        <VaultList />
      </section>
    </div>
  );
}
