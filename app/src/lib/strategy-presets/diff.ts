// app/src/lib/strategy-presets/diff.ts
import { PublicKey } from "@solana/web3.js";
import { PRESETS } from "./presets";
import type { PresetName } from "./presets";

/**
 * Identifier of a single configuration row a preset can write. We
 * compare strategies by sets of these identifiers — order-independent
 * within a strategy, ordered for tx submission.
 */
export type RowId =
    | { type: "allowed_action"; targetProgram: string; discriminator: string /* hex */ }
    | { type: "auto_action"; kind: 0 | 1 }
    | { type: "value_source"; index: number };

/**
 * A snapshot of the strategy's preset-relevant on-chain state. The diff
 * engine consumes this. Caller (UI) is responsible for fetching it via
 * getProgramAccounts + filtering by strategy.
 */
export interface StrategySnapshot {
    allowedActions: { targetProgram: PublicKey; discriminator: number[] }[];
    autoActions: { kind: 0 | 1 }[];
    valueSources: { index: number; kind: 0 | 1 | 2 }[];
}

export interface DiffResult {
    toRevoke: RowId[];
    toAdd: RowId[];
}

/**
 * Compute revoke + add lists between current state and target preset.
 * `current` is what's on-chain; `target` is what the preset would write.
 */
export function diffRowSets(current: RowId[], target: RowId[]): DiffResult {
    const ser = (r: RowId): string => JSON.stringify(r);
    const currentSet = new Set(current.map(ser));
    const targetSet = new Set(target.map(ser));
    return {
        toRevoke: current.filter((r) => !targetSet.has(ser(r))),
        toAdd: target.filter((r) => !currentSet.has(ser(r))),
    };
}

export function snapshotToRows(s: StrategySnapshot): RowId[] {
    const rows: RowId[] = [];
    for (const a of s.allowedActions) {
        rows.push({
            type: "allowed_action",
            targetProgram: a.targetProgram.toBase58(),
            discriminator: Buffer.from(a.discriminator).toString("hex"),
        });
    }
    for (const aa of s.autoActions) rows.push({ type: "auto_action", kind: aa.kind });
    for (const vs of s.valueSources) rows.push({ type: "value_source", index: vs.index });
    return rows;
}

/**
 * Run the empty-target diff against each known preset; first preset
 * whose `toAdd` AND `toRevoke` are both empty wins. Otherwise "Custom".
 */
export async function detectActivePreset(
    snapshot: StrategySnapshot,
    presetRowsByName: Record<PresetName, RowId[]>,
): Promise<PresetName | "Custom"> {
    const current = snapshotToRows(snapshot);
    for (const preset of PRESETS) {
        const target = presetRowsByName[preset.name];
        const { toRevoke, toAdd } = diffRowSets(current, target);
        if (toRevoke.length === 0 && toAdd.length === 0) {
            return preset.name;
        }
    }
    return "Custom";
}
