"use client";

import { useVault } from "@/components/providers/VaultProvider";

/**
 * Banner shown across the dashboard whenever the active vault has the pause
 * flag set. While paused, the program rejects deposits, allocations, and
 * rebalances; withdrawals stay open. Styled as a "forge cooled" moment —
 * coal-red glow underneath, inscribed eyebrow on the side. Loud but not
 * shouty.
 */
export function PausedBanner() {
  const { vault } = useVault();

  if (!vault?.paused) return null;

  return (
    <div
      role="alert"
      className="relative mb-6 overflow-hidden rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/[0.07] px-5 py-4 text-sm shadow-[0_0_40px_-8px_rgba(228,83,55,0.45)]"
    >
      {/* Coal-glow layer */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_50%,rgba(228,83,55,0.18),transparent_60%)]"
      />

      <div className="relative flex items-start gap-4">
        <ForgeSealIcon />
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <p className="font-display text-base font-semibold text-[var(--color-danger)]">
              Vault sealed
            </p>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-danger)]/80"
              aria-hidden
            >
              · paused ·
            </span>
          </div>
          <p className="text-[var(--color-text-secondary)]">
            Deposits, allocations, and rebalances are blocked until an admin
            unpauses. Withdrawals remain open.
          </p>
        </div>
      </div>
    </div>
  );
}

function ForgeSealIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden
      className="mt-0.5 shrink-0 text-[var(--color-danger)]"
    >
      <circle
        cx="14"
        cy="14"
        r="11.5"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.45"
      />
      <circle
        cx="14"
        cy="14"
        r="7.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M14 6.5 L14 21.5 M6.5 14 L21.5 14"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.6"
      />
      <rect
        x="11.5"
        y="11.5"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}
