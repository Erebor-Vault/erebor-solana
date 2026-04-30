"use client";

import type { StrategyData } from "@/hooks/useStrategies";

/**
 * Value-source editor — placeholder shape only.
 *
 * Why disabled: the program does not yet expose `add_value_source` /
 * `remove_value_source` or a `ValueSource` PDA. Once shipped (SOLANA_VAULT_SPEC.md §8),
 * each strategy will register N value sources that contribute to its NAV
 * calculation:
 *   - `SplAtaBalance` — read a token-account balance
 *   - `CpiCall` — invoke a read-only protocol entrypoint
 *   - `Constant` — pin a value
 *
 * `compute_total_assets` would aggregate them so off-chain code (and a
 * future `report_yield`-replacement) can resolve NAV without trusting the
 * agent. See MISMATCHES.md §2.1.
 */
const KIND_OPTIONS = [
  { value: "SplAtaBalance", label: "SPL ATA balance (read a token account)" },
  { value: "CpiCall", label: "Read-only CPI (call a protocol view)" },
  { value: "Constant", label: "Constant value" },
];

export function ValueSourceEditor({ strategy }: { strategy: StrategyData }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-3">
        <h3 className="text-base font-semibold">
          Value sources — strategy {strategy.strategyId.toString()}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Inputs to the strategy&apos;s NAV. The aggregate becomes the basis
          for share-price computation under the spec&apos;s value-source model.
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
        <p className="font-semibold">Not shipped yet — Phase 2 program work</p>
        <p className="mt-1 text-[var(--color-warning)]/80">
          Blocked on <code>ValueSource</code> PDAs +{" "}
          <code>add_value_source</code> / <code>remove_value_source</code>.
          Today share price comes from <code>report_yield</code>{" "}
          (admin-pushed), not from on-chain NAV. See MISMATCHES.md §2.1 and
          <code> SOLANA_VAULT_SPEC.md</code> §8.
        </p>
      </div>

      <div className="mt-4 grid gap-3 opacity-60">
        <Field label="Kind">
          <select
            disabled
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account / target">
          <input
            type="text"
            disabled
            placeholder="Base58 pubkey…"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
          />
        </Field>
        <button
          type="button"
          disabled
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add value source (coming with §8)
        </button>
      </div>

      <div className="mt-6">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Registered value sources
        </p>
        <div className="mt-2 rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
          Today, NAV is approximated by{" "}
          <code>strategy_token_account.amount</code> alone (manual{" "}
          <code>report_yield</code>). When value sources land,{" "}
          <code>program.account.valueSource.all()</code> will list them here.
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}
