import { expect } from "chai";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { BN } from "bn.js";
import * as anchor from "@coral-xyz/anchor";
import {
    buildAllowedActionIx,
    buildAutoActionConfigIx,
    buildValueSourceIx,
} from "../builders";
import myProjectIdl from "../../../idl/my_project.json";
import type { MyProject } from "../../../idl/my_project";

const MY_PROJECT = new PublicKey("FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo");

function makeProgram(): anchor.Program<MyProject> {
    // Builders only need the program for `methods` + `programId`. A
    // dummy provider connected to a non-existent RPC is sufficient
    // since we never `.rpc()` here — we only call `.instruction()`.
    const conn = new Connection("http://127.0.0.1:9999");
    const provider = new anchor.AnchorProvider(
        conn,
        new anchor.Wallet(Keypair.generate()),
        { commitment: "confirmed" },
    );
    return new anchor.Program<MyProject>(myProjectIdl as any, provider);
}

describe("strategy-preset builders", () => {
    const program = makeProgram();
    const admin = Keypair.generate().publicKey;
    const vaultState = Keypair.generate().publicKey;
    const strategy = Keypair.generate().publicKey;
    const targetProgram = Keypair.generate().publicKey;

    it("buildAllowedActionIx derives the correct PDA + targets the right program", async () => {
        const disc = [1, 2, 3, 4, 5, 6, 7, 8];
        const ix = await buildAllowedActionIx({
            program,
            admin,
            vaultState,
            strategyId: new BN(0),
            strategy,
            targetProgram,
            discriminator: disc,
        });
        expect(ix.programId.toBase58()).to.equal(MY_PROJECT.toBase58());
        const [expected] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("allowed_action"),
                strategy.toBuffer(),
                targetProgram.toBuffer(),
                Buffer.from(disc),
            ],
            MY_PROJECT,
        );
        const allowedActionMeta = ix.keys.find((k) => k.pubkey.equals(expected));
        expect(allowedActionMeta, "allowedAction PDA must appear in keys").to.exist;
    });

    it("buildAutoActionConfigIx derives the correct PDA per (strategy, kind)", async () => {
        for (const kind of [0, 1] as const) {
            const ix = await buildAutoActionConfigIx({
                program,
                admin,
                vaultState,
                strategyId: new BN(0),
                strategy,
                kind,
                targetProgram,
                discriminator: [9, 9, 9, 9, 9, 9, 9, 9],
                ixData: Buffer.from([42]),
            });
            const [expected] = PublicKey.findProgramAddressSync(
                [Buffer.from("auto_action"), strategy.toBuffer(), Buffer.from([kind])],
                MY_PROJECT,
            );
            expect(
                ix.keys.find((k) => k.pubkey.equals(expected)),
                `auto_action PDA for kind=${kind}`,
            ).to.exist;
        }
    });

    it("buildValueSourceIx derives the correct PDA per index", async () => {
        for (const index of [0, 5, 15]) {
            const ix = await buildValueSourceIx({
                program,
                admin,
                vaultState,
                strategyId: new BN(0),
                strategy,
                index,
                kind: 0,
                targetAccount: Keypair.generate().publicKey,
            });
            const [expected] = PublicKey.findProgramAddressSync(
                [Buffer.from("value_source"), strategy.toBuffer(), Buffer.from([index])],
                MY_PROJECT,
            );
            expect(
                ix.keys.find((k) => k.pubkey.equals(expected)),
                `value_source PDA for index=${index}`,
            ).to.exist;
        }
    });

    it("buildValueSourceIx kind=2 (PythPriceFeed) packs the new args", async () => {
        const target = Keypair.generate().publicKey;
        const ix = await buildValueSourceIx({
            program,
            admin,
            vaultState,
            strategyId: new BN(0),
            strategy,
            index: 1,
            kind: 2,
            targetAccount: target,
            mintBalanceSourceIndex: 0,
            maxStalenessSecs: 60,
        });
        // Anchor encodes args in the ix data after the 8-byte disc.
        // We only assert the buffer is non-empty + contains the target
        // pubkey (32 bytes somewhere inside). Byte-exact assertions
        // would lock us to Anchor 0.32's encoding; the snapshot tests
        // (Task 4) cover that.
        expect(ix.data.length).to.be.greaterThan(8 + 32);
        const dataHex = ix.data.toString("hex");
        expect(dataHex).to.include(target.toBuffer().toString("hex"));
    });
});
