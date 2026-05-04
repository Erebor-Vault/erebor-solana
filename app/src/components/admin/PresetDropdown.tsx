"use client";

import { PRESETS, PresetName } from "@/lib/strategy-presets/presets";

interface Props {
    value: PresetName | "custom";
    onChange: (next: PresetName | "custom") => void;
    disabled?: boolean;
}

export function PresetDropdown({ value, onChange, disabled }: Props) {
    return (
        <div className="space-y-1">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                Preset
            </label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as any)}
                disabled={disabled}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-50"
            >
                <option value="custom">Custom (manual config)</option>
                {PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                        {p.label}
                    </option>
                ))}
            </select>
            {value !== "custom" && (
                <p className="text-xs text-[var(--color-text-secondary)]">
                    {PRESETS.find((p) => p.name === value)?.summary}
                </p>
            )}
        </div>
    );
}
