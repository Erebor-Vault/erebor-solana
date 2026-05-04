// app/src/lib/strategy-presets/lookupActionLabel.ts
import { PublicKey } from "@solana/web3.js";
import { PROTOCOL_REGISTRY } from "./registry";
import { anchorDiscriminator } from "./discriminator";
import type { ClusterName } from "./types";

/**
 * Reverse-lookup an `(targetProgram, discriminator)` pair to a
 * human-readable ix name by walking the active cluster's
 * `PROTOCOL_REGISTRY`. Returns null when no protocol/ix matches —
 * caller falls back to the existing `ACTION_PRESETS` mainnet table
 * or to `"Custom action"`.
 */
export function lookupRegistryActionLabel(
    cluster: ClusterName,
    targetProgram: PublicKey,
    discriminator: number[],
): string | null {
    const reg = PROTOCOL_REGISTRY[cluster];
    for (const [protoName, entry] of Object.entries(reg.protocols)) {
        if (!entry.programId) continue;
        if (!entry.programId.equals(targetProgram)) continue;
        for (const [, ixName] of Object.entries(entry.discriminators)) {
            if (!ixName) continue;
            const expected = anchorDiscriminator(ixName);
            if (
                expected.length === discriminator.length &&
                discriminator.every((b, i) => b === expected[i])
            ) {
                return `${protoName} · ${ixName}`;
            }
        }
    }
    return null;
}
