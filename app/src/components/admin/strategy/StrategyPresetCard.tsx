"use client";

import { useEffect, useState } from "react";
import { detectActivePreset, StrategySnapshot } from "@/lib/strategy-presets/diff";
import { PRESETS_BY_NAME, PresetName } from "@/lib/strategy-presets/presets";
import type { RowId } from "@/lib/strategy-presets/diff";

interface Props {
  snapshot: StrategySnapshot;
  presetRowsByName: Record<PresetName, RowId[]>;
  onChangeClick: () => void;
}

export function StrategyPresetCard({ snapshot, presetRowsByName, onChangeClick }: Props) {
  const [name, setName] = useState<PresetName | "Custom" | "…">("…");

  useEffect(() => {
    detectActivePreset(snapshot, presetRowsByName).then(setName);
  }, [snapshot, presetRowsByName]);

  const isCustom = name === "Custom";
  const isLoading = name === "…";
  const preset = !isCustom && !isLoading ? PRESETS_BY_NAME[name as PresetName] : null;

  const label = isLoading ? "Resolving…" : isCustom ? "Custom configuration" : preset!.label;
  const summary = isLoading
    ? "Reading on-chain state…"
    : isCustom
    ? "This strategy doesn't match any known preset. Allowed actions, auto-action configs, and value sources were configured individually."
    : preset!.summary;

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(94,234,212,0.05)_0%,rgba(8,17,26,0)_60%),var(--color-surface-secondary)]">
      {/* left accent bar */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background: isCustom
            ? "linear-gradient(180deg, var(--color-accent-secondary) 0%, transparent 100%)"
            : "linear-gradient(180deg, var(--color-accent) 0%, transparent 100%)",
          boxShadow: isCustom
            ? "0 0 14px rgba(212,162,74,0.4)"
            : "0 0 14px rgba(127,240,214,0.4)",
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 pl-7">
        <div className="min-w-0 flex-1">
          <div className="eyebrow flex items-center gap-2">
            <span aria-hidden>·</span>
            <span>Strategy preset</span>
            <span aria-hidden>·</span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span
              className={`font-display text-xl tracking-tight ${
                isCustom
                  ? "text-[var(--color-accent-secondary)]"
                  : "text-[var(--color-accent)]"
              }`}
            >
              {label}
            </span>
            {!isLoading && !isCustom && (
              <PresetGlyph name={name as PresetName} />
            )}
          </div>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {summary}
          </p>
        </div>

        <button
          onClick={onChangeClick}
          disabled={isLoading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]/60 hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          Change preset
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Tiny mono badge that names which protocol family the preset belongs to.
 * Brass-on-dark, matches the existing eyebrow tracking.
 */
function PresetGlyph({ name }: { name: PresetName }) {
  const tag =
    name === "kamino_liquidity"
      ? "kamino"
      : name === "kamino_looper"
      ? "kamino · looper"
      : name === "lulo_lending"
      ? "lulo"
      : "raydium · jupiter";
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
      {tag}
    </span>
  );
}
