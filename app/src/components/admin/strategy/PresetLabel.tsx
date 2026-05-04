"use client";

import { useEffect, useState } from "react";
import {
  detectActivePreset,
  snapshotToRows,
  type StrategySnapshot,
} from "@/lib/strategy-presets/diff";
import { PRESETS_BY_NAME, type PresetName } from "@/lib/strategy-presets/presets";
import type { RowId } from "@/lib/strategy-presets/diff";

interface Props {
  snapshot: StrategySnapshot;
  /** Pre-built row sets for each preset — built by the parent so this
   *  component stays a pure display leaf. */
  presetRowsByName: Record<PresetName, RowId[]>;
  onChangeClick: () => void;
}

export function PresetLabel({ snapshot, presetRowsByName, onChangeClick }: Props) {
  const [label, setLabel] = useState<string>("…");

  useEffect(() => {
    detectActivePreset(snapshot, presetRowsByName).then((name) => {
      if (name === "Custom") setLabel("Custom");
      else setLabel(PRESETS_BY_NAME[name].label);
    });
  }, [snapshot, presetRowsByName]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[var(--color-text-secondary)]">Preset:</span>
      <span className="font-medium text-[var(--color-text-primary)]">{label}</span>
      <button
        onClick={onChangeClick}
        className="text-[var(--color-accent)] hover:underline"
      >
        Change preset…
      </button>
    </div>
  );
}
