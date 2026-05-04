import { expect } from "chai";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";
import { diffRowSets, snapshotToRows, detectActivePreset, RowId } from "../diff";
import { PRESETS, KAMINO_LIQUIDITY, LULO_LENDING, RAYDIUM_SWAPPER } from "../presets";
import myProjectIdl from "../../../idl/my_project.json";
import type { MyProject } from "../../../idl/my_project";

const KAMINO = new PublicKey("H4tUCeXMQduSmB6fjqbYMdFb49E8YnEHku5NWFrWKaGU");

describe("diff engine", () => {
    it("diffRowSets is empty when current == target", () => {
        const rows: RowId[] = [
            { type: "allowed_action", targetProgram: KAMINO.toBase58(), discriminator: "00".repeat(8) },
            { type: "auto_action", kind: 0 },
        ];
        const { toRevoke, toAdd } = diffRowSets(rows, [...rows]);
        expect(toRevoke).to.deep.equal([]);
        expect(toAdd).to.deep.equal([]);
    });

    it("diffRowSets computes the symmetric difference", () => {
        const a: RowId[] = [{ type: "auto_action", kind: 0 }, { type: "auto_action", kind: 1 }];
        const b: RowId[] = [{ type: "auto_action", kind: 1 }, { type: "value_source", index: 0 }];
        const { toRevoke, toAdd } = diffRowSets(a, b);
        expect(toRevoke).to.deep.equal([{ type: "auto_action", kind: 0 }]);
        expect(toAdd).to.deep.equal([{ type: "value_source", index: 0 }]);
    });

    it("snapshotToRows preserves all three kinds", () => {
        const rows = snapshotToRows({
            allowedActions: [{ targetProgram: KAMINO, discriminator: [1, 2, 3, 4, 5, 6, 7, 8] }],
            autoActions: [{ kind: 0 }],
            valueSources: [{ index: 0, kind: 0 }, { index: 1, kind: 2 }],
        });
        expect(rows).to.have.lengthOf(4);
        expect(rows.filter((r) => r.type === "allowed_action")).to.have.lengthOf(1);
        expect(rows.filter((r) => r.type === "auto_action")).to.have.lengthOf(1);
        expect(rows.filter((r) => r.type === "value_source")).to.have.lengthOf(2);
    });

    it("detectActivePreset returns the matching preset name when rows align", async () => {
        // Build deterministic context, get the preset's expected rows,
        // synthesise a snapshot from those same rows, run detection.
        const conn = new Connection("http://127.0.0.1:9999");
        const provider = new anchor.AnchorProvider(
            conn,
            new anchor.Wallet(Keypair.generate()),
            { commitment: "confirmed" },
        );
        const program = new anchor.Program<MyProject>(myProjectIdl as any, provider);
        const ctx = {
            connection: conn,
            program,
            cluster: "devnet" as const,
            admin: new PublicKey("11111111111111111111111111111112"),
            vaultState: new PublicKey("11111111111111111111111111111113"),
            vault: new PublicKey("11111111111111111111111111111113"),
            strategyId: new BN(0),
            strategy: new PublicKey("11111111111111111111111111111114"),
            strategyTokenAccount: new PublicKey("11111111111111111111111111111115"),
            strategyAuthority: new PublicKey("11111111111111111111111111111116"),
            underlyingDecimals: 6,
            kaminoObligation: new PublicKey("11111111111111111111111111111117"),
        };

        const liquidityRows = await KAMINO_LIQUIDITY.buildRows(ctx);
        const luloRows = await LULO_LENDING.buildRows(ctx);

        const presetRowsByName = {
            kamino_liquidity: liquidityRows,
            kamino_looper: await PRESETS.find((p) => p.name === "kamino_looper")!.buildRows(ctx),
            lulo_lending: luloRows,
            // Raydium throws on empty allow-list — pass empty rows so it
            // never matches anything other than an empty strategy.
            raydium_swapper: [] as RowId[],
        };

        // Build a synthetic StrategySnapshot from liquidityRows.
        const snapshot = {
            allowedActions: liquidityRows
                .filter((r) => r.type === "allowed_action")
                .map((r) => ({
                    targetProgram: new PublicKey((r as any).targetProgram),
                    discriminator: Array.from(Buffer.from((r as any).discriminator, "hex")),
                })),
            autoActions: liquidityRows
                .filter((r) => r.type === "auto_action")
                .map((r) => ({ kind: (r as any).kind })),
            valueSources: liquidityRows
                .filter((r) => r.type === "value_source")
                .map((r) => ({ index: (r as any).index, kind: 0 as const })),
        };

        const detected = await detectActivePreset(snapshot, presetRowsByName);
        expect(detected).to.equal("kamino_liquidity");
    });

    it("detectActivePreset returns 'Custom' when no preset matches", async () => {
        const detected = await detectActivePreset(
            {
                allowedActions: [],
                autoActions: [],
                valueSources: [{ index: 99, kind: 0 }], // index out of any preset's range
            },
            {
                kamino_liquidity: [],
                kamino_looper: [],
                lulo_lending: [],
                raydium_swapper: [],
            },
        );
        expect(detected).to.equal("Custom");
    });
});
