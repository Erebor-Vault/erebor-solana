// app/src/lib/strategy-presets/discriminator.ts
import { createHash } from "crypto";

/**
 * Compute the 8-byte Anchor instruction discriminator for `ixName`.
 * Matches `anchor-lang`'s `sighash("global", &ix_name)` exactly:
 * `sha256("global:<ixName>")[..8]`. The snake_case `ixName` must match
 * the Rust function name verbatim.
 */
export function anchorDiscriminator(ixName: string): Buffer {
    return createHash("sha256")
        .update(`global:${ixName}`)
        .digest()
        .subarray(0, 8);
}
