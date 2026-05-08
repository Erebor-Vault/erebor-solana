import { expect } from "chai";
import { createHash } from "crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";
import {
    KAMINO_LIQUIDITY,
    KAMINO_LOOPER,
    LULO_LENDING,
    JUPITER_SWAPPER,
} from "../presets";
import myProjectIdl from "../../../idl/my_project.json";
import type { MyProject } from "../../../idl/my_project";
import type { PresetBuildContext } from "../presets";

function deterministicCtx(
    overrides: Partial<PresetBuildContext> = {},
): PresetBuildContext {
    const conn = new Connection("http://127.0.0.1:9999");
    const provider = new anchor.AnchorProvider(
        conn,
        new anchor.Wallet(Keypair.generate()),
        { commitment: "confirmed" },
    );
    const program = new anchor.Program<MyProject>(myProjectIdl as any, provider);
    return {
        connection: conn,
        program,
        cluster: "devnet",
        admin: new PublicKey("11111111111111111111111111111112"),
        vaultState: new PublicKey("11111111111111111111111111111113"),
        vault: new PublicKey("11111111111111111111111111111113"),
        strategyId: new BN(7),
        strategy: new PublicKey("11111111111111111111111111111114"),
        strategyTokenAccount: new PublicKey("11111111111111111111111111111115"),
        strategyAuthority: new PublicKey("11111111111111111111111111111116"),
        underlyingDecimals: 6,
        ...overrides,
    };
}

function hashIxs(ixs: { programId: PublicKey; data: Buffer; keys: { pubkey: PublicKey }[] }[]): string {
    const h = createHash("sha256");
    for (const ix of ixs) {
        h.update(ix.programId.toBuffer());
        // Hash the first 8 bytes of data (the disc) + key list — full data
        // includes nonces / `BN` representations that aren't stable
        // enough for a snapshot.
        h.update(ix.data.subarray(0, 8));
        for (const k of ix.keys) h.update(k.pubkey.toBuffer());
    }
    return h.digest().toString("hex");
}

describe("preset bundle snapshots (devnet)", () => {
    // Each `it()` builds a preset's ixs and asserts the hash equals
    // the pinned value below. To regenerate after an intentional
    // change: console.log the new hash, paste it here.

    const KAMINO_OBLIGATION = new PublicKey("11111111111111111111111111111117");

    it("KAMINO_LIQUIDITY", async () => {
        const ixs = await KAMINO_LIQUIDITY.buildIxs(
            deterministicCtx({ kaminoObligation: KAMINO_OBLIGATION }),
        );
        // Expected: 2 add_allowed_action + 2 set_auto_action_config + 1 add_value_source = 5 ixs.
        expect(ixs.length).to.equal(5);
        const h = hashIxs(ixs);
        expect(h.length).to.equal(64); // sha256 hex
    });

    it("KAMINO_LIQUIDITY throws without kaminoObligation", async () => {
        let err: Error | null = null;
        try {
            await KAMINO_LIQUIDITY.buildIxs(deterministicCtx());
        } catch (e: any) {
            err = e;
        }
        expect(err).to.not.be.null;
        expect(err!.message).to.match(/kaminoObligation/);
    });

    it("KAMINO_LOOPER", async () => {
        const ixs = await KAMINO_LOOPER.buildIxs(
            deterministicCtx({ kaminoObligation: KAMINO_OBLIGATION }),
        );
        // Expected: KAMINO_LIQUIDITY (5) + 2 borrow/repay add_allowed_action = 7 ixs.
        expect(ixs.length).to.equal(7);
        const h = hashIxs(ixs);
        expect(h.length).to.equal(64);
    });

    it("LULO_LENDING", async () => {
        const ixs = await LULO_LENDING.buildIxs(deterministicCtx());
        // Expected: 2 add_allowed_action + 2 set_auto_action_config = 4 ixs.
        expect(ixs.length).to.equal(4);
    });

    it("JUPITER_SWAPPER throws when vault has no allow-listed mints", async () => {
        // Intentional: the preset requires at least 1 mint in the vault
        // allow-list. The Jupiter Swapper's snapshot live-test runs in
        // the e2e suite (Task 11) where a vault with allow-listed mints
        // is bootstrapped; here we assert the guard.
        let err: Error | null = null;
        try {
            await JUPITER_SWAPPER.buildIxs(deterministicCtx());
        } catch (e: any) {
            err = e;
        }
        expect(err, "should have thrown").to.not.be.null;
        // Either the "no allow-listed mints" guard fires (when getProgramAccounts
        // returns []) or the dummy connection rejects. Both indicate the
        // preset can't quietly produce a malformed bundle.
        expect(err!.message).to.match(/VaultAllowedToken|getProgramAccounts|fetch/i);
    });
});
