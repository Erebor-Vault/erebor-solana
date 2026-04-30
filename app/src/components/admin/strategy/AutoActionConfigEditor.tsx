"use client";

import type { StrategyData } from "@/hooks/useStrategies";

/**
 * Auto-action config editor — placeholder shape only.
 *
 * Why disabled: the program does not yet expose
 * `set_deposit_config` / `set_withdraw_config` instructions or the
 * underlying `AutoActionConfig` PDA. Once the spec's auto-rebalance lands
 * (SOLANA_VAULT_SPEC.md §10), each strategy gets a `deposit_config` and
 * `withdraw_config` describing the AllowedAction the vault should
 * automatically invoke as funds flow in / out.
 *
 * See MISMATCHES.md §2.1.
 */
export function AutoActionConfigEditor({ strategy }: { strategy: StrategyData }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-3">
        <h3 className="text-base font-semibold">
          Auto-action config — strategy {strategy.strategyId.toString()}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Per-strategy <code>deposit_config</code> /{" "}
          <code>withdraw_config</code>: the action the vault should invoke
          automatically when funds flow into or out of this strategy.
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
        <p className="font-semibold">Not shipped yet — Phase 2 program work</p>
        <p className="mt-1 text-[var(--color-warning)]/80">
          Blocked on auto-rebalance + <code>AutoActionConfig</code> PDAs. See
          MISMATCHES.md §2.1 / §2.8 and <code>SOLANA_VAULT_SPEC.md</code> §10.
        </p>
      </div>

      <div className="mt-4 grid gap-4 opacity-60">
        <Pair title="Deposit config">
          <Field label="Action (target program + discriminator)">
            <input
              type="text"
              disabled
              placeholder="Pick from allowed actions…"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>
          <Field label="Amount account index">
            <input
              type="text"
              disabled
              placeholder="Index of the amount field in the relayed ix data"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>
        </Pair>

        <Pair title="Withdraw config">
          <Field label="Action (target program + discriminator)">
            <input
              type="text"
              disabled
              placeholder="Pick from allowed actions…"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>
          <Field label="Amount account index">
            <input
              type="text"
              disabled
              placeholder="Index of the amount field in the relayed ix data"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>
        </Pair>

        <button
          type="button"
          disabled
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save (coming with auto-rebalance)
        </button>
      </div>
    </section>
  );
}

function Pair({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-[var(--color-border)] p-3">
      <legend className="px-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </legend>
      <div className="grid gap-3">{children}</div>
    </fieldset>
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
