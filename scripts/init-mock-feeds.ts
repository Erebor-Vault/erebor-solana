// scripts/init-mock-feeds.ts
//
// One-shot bootstrap: walks PROTOCOL_REGISTRY[cluster].priceFeeds and
// calls mock_pyth.initialize_feed for any feed PDA that doesn't exist
// yet. Idempotent — already-initialised feeds are skipped.
//
// Usage:
//   ANCHOR_WALLET=/path/to/keypair.json bun scripts/init-mock-feeds.ts
//   ANCHOR_WALLET=/path/to/keypair.json bun scripts/init-mock-feeds.ts --cluster devnet

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";
import {
    PROTOCOL_REGISTRY,
    clusterOrThrow,
} from "../app/src/lib/strategy-presets/registry";
import type { ClusterName } from "../app/src/lib/strategy-presets/types";
import type { MockPyth } from "../target/types/mock_pyth";

const mockPythIdl = JSON.parse(
    readFileSync("./target/idl/mock_pyth.json", "utf-8"),
);

/** Initial price (raw integer at expo -8). 1.0 USD = 100_000_000. */
const INIT_PRICE = new anchor.BN(100_000_000);
const INIT_EXPO = -8;

function parseCluster(argv: string[]): ClusterName {
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--cluster") return clusterOrThrow(argv[++i] as any);
    }
    return "devnet";
}

function derivePriceFeedPda(programId: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("price"), mint.toBuffer()],
        programId,
    )[0];
}

async function main(): Promise<void> {
    const cluster = parseCluster(process.argv);
    const reg = PROTOCOL_REGISTRY[cluster];
    if (!reg.mockPythProgramId) {
        console.log(`No mock_pyth on ${cluster}; nothing to bootstrap.`);
        return;
    }
    if (reg.priceFeeds.length === 0) {
        console.log(`PROTOCOL_REGISTRY.${cluster}.priceFeeds is empty; nothing to bootstrap.`);
        return;
    }

    const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
    const walletPath = process.env.ANCHOR_WALLET;
    if (!walletPath) throw new Error("ANCHOR_WALLET env var is required");
    const payer = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf-8"))),
    );

    const connection = new Connection(rpcUrl, "confirmed");
    const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(payer),
        { commitment: "confirmed" },
    );
    anchor.setProvider(provider);
    const program = new anchor.Program<MockPyth>(mockPythIdl as any, provider);

    for (const entry of reg.priceFeeds) {
        const feedPda = entry.feedPda ?? derivePriceFeedPda(program.programId, entry.mint);
        const existing = await connection.getAccountInfo(feedPda);
        if (existing) {
            console.log(`[init] ${entry.mint.toBase58().slice(0, 8)}…  already initialised, skipping`);
            continue;
        }
        try {
            await program.methods
                .initializeFeed(INIT_PRICE, INIT_EXPO)
                .accountsStrict({
                    payer: payer.publicKey,
                    mint: entry.mint,
                    feed: feedPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer])
                .rpc();
            console.log(`[init] ${entry.mint.toBase58().slice(0, 8)}…  initialised at $1.00 (run crank:prices to refresh)`);
        } catch (err) {
            console.error(`[init] Failed to init feed for ${entry.mint.toBase58()}:`, err);
        }
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
