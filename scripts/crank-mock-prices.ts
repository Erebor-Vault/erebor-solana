// scripts/crank-mock-prices.ts
//
// Devnet/localnet keeper: fetches CoinGecko spot prices for every mint
// in PROTOCOL_REGISTRY[cluster].priceFeeds and writes them to mock_pyth
// price feed accounts via `set_price`. Mirrors the shape of
// scripts/crank-yield.ts.
//
// Usage:
//   bun scripts/crank-mock-prices.ts                   # one-shot
//   bun scripts/crank-mock-prices.ts --loop 60         # every 60s
//   bun scripts/crank-mock-prices.ts --cluster devnet  # explicit cluster (default: env)
//
// Env:
//   ANCHOR_PROVIDER_URL  RPC URL (defaults to devnet)
//   ANCHOR_WALLET        path to keypair (the same wallet that owns the
//                        mock_pyth feeds; usually the deployer)

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import {
    PROTOCOL_REGISTRY,
    clusterOrThrow,
} from "../app/src/lib/strategy-presets/registry";
import type { ClusterName, PriceFeedEntry } from "../app/src/lib/strategy-presets/types";
import type { MockPyth } from "../target/types/mock_pyth";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3/simple/price";
/** Pyth-compatible expo. -8 = price * 10^-8 USD. */
const KEEPER_EXPO = -8;

interface Args {
    cluster: ClusterName;
    loopSecs: number | null;
}

function parseArgs(argv: string[]): Args {
    let cluster: ClusterName = "devnet";
    let loopSecs: number | null = null;
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--cluster") {
            cluster = clusterOrThrow(argv[++i] as any);
        } else if (argv[i] === "--loop") {
            loopSecs = parseInt(argv[++i], 10);
            if (!Number.isFinite(loopSecs) || loopSecs <= 0) {
                throw new Error(`--loop expects a positive integer (got '${argv[i]}')`);
            }
        }
    }
    return { cluster, loopSecs };
}

export function derivePriceFeedPda(programId: PublicKey, mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("price"), mint.toBuffer()],
        programId,
    );
    return pda;
}

/**
 * Fetch USD prices from CoinGecko for the given ids. Returns an i64
 * suitable for mock_pyth.set_price(price, expo=KEEPER_EXPO).
 *
 * Exported so the test file can call it with a stubbed `fetchImpl`.
 */
export async function fetchPricesUsd(
    ids: string[],
    fetchImpl: typeof fetch = fetch,
): Promise<Map<string, bigint>> {
    if (ids.length === 0) return new Map();
    const url = `${COINGECKO_BASE}?ids=${ids.join(",")}&vs_currencies=usd`;
    const res = await fetchImpl(url);
    if (!res.ok) {
        throw new Error(`CoinGecko fetch failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as Record<string, { usd?: number }>;
    const out = new Map<string, bigint>();
    for (const id of ids) {
        const usd = json[id]?.usd;
        if (typeof usd !== "number") {
            console.warn(`[crank] CoinGecko had no price for '${id}', skipping`);
            continue;
        }
        // Multiply by 10^8 to fit KEEPER_EXPO. Round to nearest integer.
        out.set(id, BigInt(Math.round(usd * 1e8)));
    }
    return out;
}

async function pushFeedPrice(
    program: anchor.Program<MockPyth>,
    payer: Keypair,
    entry: PriceFeedEntry,
    priceI64: bigint,
): Promise<void> {
    const feed = entry.feedPda ?? derivePriceFeedPda(program.programId, entry.mint);
    await program.methods
        .setPrice(new anchor.BN(priceI64.toString()), KEEPER_EXPO)
        .accountsStrict({
            payer: payer.publicKey,
            mint: entry.mint,
            feed,
        })
        .signers([payer])
        .rpc();
}

async function tick(args: Args): Promise<void> {
    const reg = PROTOCOL_REGISTRY[args.cluster];
    if (!reg.mockPythProgramId) {
        throw new Error(`No mock_pyth on cluster '${args.cluster}' — keeper has nothing to do.`);
    }
    if (reg.priceFeeds.length === 0) {
        console.log(`[crank] No priceFeeds registered for ${args.cluster}; nothing to push.`);
        return;
    }

    const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
    const walletPath = process.env.ANCHOR_WALLET;
    if (!walletPath) throw new Error("ANCHOR_WALLET env var is required");
    const payer = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf-8"))),
    );

    const connection = new Connection(rpcUrl, "confirmed");
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const mockPythIdl = JSON.parse(readFileSync("./target/idl/mock_pyth.json", "utf-8"));
    const program = new anchor.Program<MockPyth>(mockPythIdl as any, provider);

    const ids = Array.from(new Set(reg.priceFeeds.map((f) => f.coingeckoId)));
    const prices = await fetchPricesUsd(ids);

    for (const entry of reg.priceFeeds) {
        const priceI64 = prices.get(entry.coingeckoId);
        if (priceI64 === undefined) {
            console.warn(`[crank] No price for '${entry.coingeckoId}' (mint ${entry.mint.toBase58()}), skipping`);
            continue;
        }
        try {
            await pushFeedPrice(program, payer, entry, priceI64);
            console.log(
                `[crank] ${entry.mint.toBase58().slice(0, 8)}…  $${(Number(priceI64) / 1e8).toFixed(4)}  ✓`,
            );
        } catch (err) {
            console.error(`[crank] Failed to push price for ${entry.mint.toBase58()}:`, err);
        }
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);
    if (args.loopSecs == null) {
        await tick(args);
        return;
    }
    console.log(`[crank] Looping every ${args.loopSecs}s on ${args.cluster}.`);
    while (true) {
        try {
            await tick(args);
        } catch (err) {
            console.error("[crank] Tick failed:", err);
        }
        await new Promise((r) => setTimeout(r, args.loopSecs! * 1000));
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
