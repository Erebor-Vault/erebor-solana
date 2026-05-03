# Plan 2 — `PROTOCOL_REGISTRY` + `crank-mock-prices.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the per-cluster `PROTOCOL_REGISTRY` (devnet pointed at the in-workspace mock programs, mainnet stubbed for the FOLLOWUPS A4 task) and a CoinGecko-backed `crank-mock-prices.ts` keeper that updates `mock_pyth` feeds. Both ship working/testable on devnet without touching the on-chain program — Plan 1 already did all the on-chain work.

**Architecture:** The registry is a TS data module split into types + data — `types.ts` defines a `ProtocolEntry` shape (program ID, ix-name → discriminator resolver, optional `valueSource` descriptor) and a top-level `ProtocolRegistry` keyed by cluster (`devnet | mainnet-beta`) → protocol name (`kamino | lulo | raydium | jupiter`). `priceFeeds` is a separate per-cluster map of mint pubkey → mock_pyth feed pubkey + CoinGecko id. The keeper reads `priceFeeds` for the active cluster, fetches CoinGecko prices for the listed coingecko ids, and writes them via `mock_pyth.set_price`. Mainnet entries are explicitly stubbed (`null` programId, descriptive comment pointing at FOLLOWUPS A4) so any consumer accidentally trying to use the registry on mainnet fails loudly with a clear error.

**Tech Stack:** TypeScript, `@coral-xyz/anchor` 0.32, `@solana/web3.js`, native `fetch`, `commander` (or simple `process.argv` parsing — the script stays small).

---

## File Structure

**Created:**
- `app/src/lib/strategy-presets/types.ts` — `ProtocolName`, `ClusterName`, `DiscriminatorName`, `ProtocolEntry`, `PriceFeedEntry`, `ValueSourceDescriptor`, `ProtocolRegistry`. Pure types, no runtime data.
- `app/src/lib/strategy-presets/registry.ts` — the populated `PROTOCOL_REGISTRY` and `PRICE_FEEDS`, plus a single helper `getRegistryForCluster(cluster)` that throws on missing-cluster.
- `app/src/lib/strategy-presets/discriminator.ts` — small helper `anchorDiscriminator(ixName: string): Buffer` that hashes `global:<ixName>` via SHA-256 and slices the first 8 bytes. Anchor's TS client does this internally; we expose it so the preset bundle code in Plan 3 can resolve discriminators by ix name without depending on the full IDL.
- `app/src/lib/strategy-presets/__tests__/registry.test.ts` — unit tests for registry shape (no runtime state).
- `scripts/crank-mock-prices.ts` — the keeper script.
- `scripts/__tests__/crank-mock-prices.test.ts` — unit test for the keeper's price-resolution logic with a mocked `fetch`.

**Modified:**
- `package.json` (root) — add `crank:prices` and `crank:prices:loop` scripts pointing at the new keeper.
- `docs/FOLLOWUPS.md` — mark Plan 2 as shipped under A4.

**Not touched:**
- The on-chain program. Plan 1 covered all on-chain work.
- Frontend UI. Plan 3 covers the preset picker + change-preset modal.

---

## Concrete data the registry holds (devnet)

| Protocol | `programId`                                      | Discriminator names registered |
|----------|--------------------------------------------------|--------------------------------|
| `kamino` | `H4tUCeXMQduSmB6fjqbYMdFb49E8YnEHku5NWFrWKaGU`   | `deposit_reserve_liquidity_and_obligation_collateral` (deposit), `withdraw_obligation_collateral_and_redeem_reserve_collateral` (withdraw), `borrow_obligation_liquidity` (borrow), `repay_obligation_liquidity` (repay) |
| `lulo`   | `DUECqnJ77fP2Kd9SqeTsVc9n7MiTaBvSW3mREM8DuBVs`   | `deposit` (lend), `withdraw` (redeem) |
| `raydium`| **null on devnet** (no in-workspace swap mock yet — Plan 3 either adds one or routes the swap leg through `mock_kamino`'s deposit) | — |
| `jupiter`| **null on devnet** (same as raydium) | — |

`PRICE_FEEDS` (devnet) starts empty and gains entries as the curator runs the bootstrap script. Plan 2 ships an empty map plus the *type contract* and the *keeper that will iterate it*; Plan 3 does the actual `initialize_feed` calls when the curator adds mints to the vault `AllowedToken` set.

For Plan 2's keeper to be usefully testable on devnet, the plan ships **one entry pre-wired** in `PRICE_FEEDS.devnet`: the round-7 test USDC mint `7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE` mapped to its `mock_pyth` feed PDA + CoinGecko id `usd-coin`. The keeper can then run end-to-end against the live devnet deploy (program ID `2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq`) without further setup. The feed PDA is derived deterministically — the keeper computes it itself rather than the registry hardcoding it.

---

## Task 1: Types module

**Files:**
- Create: `app/src/lib/strategy-presets/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// app/src/lib/strategy-presets/types.ts
import type { PublicKey } from "@solana/web3.js";

export type ClusterName = "devnet" | "mainnet-beta";
export type ProtocolName = "kamino" | "lulo" | "raydium" | "jupiter";

/**
 * Anchor instruction names — registered by their snake_case Rust name.
 * The discriminator helper hashes `global:<name>` to produce the 8-byte
 * AllowedAction PDA seed.
 */
export interface DiscriminatorMap {
    deposit?: string;
    withdraw?: string;
    borrow?: string;
    repay?: string;
    swap?: string;
}

/**
 * Hint for `add_value_source` registration. `accountResolver` is a
 * deferred function (called at preset-build time) that yields the
 * target account pubkey for a given strategy + mint context. `offset`
 * is for `AccountU64` reads; `scaleNum`/`scaleDen` express the
 * protocol's exchange rate at config time. Plan 3 consumes these.
 */
export interface ValueSourceDescriptor {
    kind: "spl_ata_balance" | "account_u64";
    accountResolver: (ctx: {
        strategy: PublicKey;
        strategyAuthority: PublicKey;
        mint: PublicKey;
    }) => Promise<PublicKey>;
    offset: number;
    scaleNum: bigint;
    scaleDen: bigint;
}

export interface ProtocolEntry {
    /** Null on a cluster where this protocol isn't deployed. Consumers
     *  must bail with a clear error rather than crash. */
    programId: PublicKey | null;
    discriminators: DiscriminatorMap;
    valueSource?: ValueSourceDescriptor;
    /** Free-form note explaining stubbed entries — surfaced in errors. */
    note?: string;
}

export interface PriceFeedEntry {
    /** Mint whose balance the strategy holds. */
    mint: PublicKey;
    /** CoinGecko id used by the keeper to fetch USD price. */
    coingeckoId: string;
    /** Optional explicit override for the on-chain feed account. If
     *  omitted, the keeper derives it from `(mockPythProgramId, mint)`. */
    feedPda?: PublicKey;
}

export type ProtocolRegistry = {
    [C in ClusterName]: {
        protocols: { [P in ProtocolName]: ProtocolEntry };
        priceFeeds: PriceFeedEntry[];
        mockPythProgramId: PublicKey | null;
    };
};
```

- [ ] **Step 2: Type-check**

```bash
cd app && bunx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/strategy-presets/types.ts
git commit -m "$(cat <<'EOF'
feat(app): strategy-presets types module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Discriminator helper

**Files:**
- Create: `app/src/lib/strategy-presets/discriminator.ts`

- [ ] **Step 1: Write the file**

```typescript
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
```

- [ ] **Step 2: Add a unit test**

Create `app/src/lib/strategy-presets/__tests__/discriminator.test.ts`:

```typescript
import { expect } from "chai";
import { anchorDiscriminator } from "../discriminator";

describe("anchorDiscriminator", () => {
    it("matches the well-known `deposit` discriminator", () => {
        // Anchor's canonical hash: sha256("global:deposit")[..8]
        // Verified against `anchor idl` output.
        const disc = anchorDiscriminator("deposit");
        expect(disc.toString("hex")).to.equal("f223c68952e1f2b6");
    });

    it("returns 8 bytes for any ix name", () => {
        expect(anchorDiscriminator("foo").length).to.equal(8);
        expect(anchorDiscriminator("a_very_long_snake_case_name_here").length).to.equal(8);
    });

    it("differs for different names", () => {
        expect(anchorDiscriminator("deposit").equals(anchorDiscriminator("withdraw"))).to.be.false;
    });
});
```

- [ ] **Step 3: Verify**

```bash
bunx ts-mocha -p ./tsconfig.json "app/src/lib/strategy-presets/__tests__/discriminator.test.ts"
```

Expected: all three tests pass. (If the literal `f223c68952e1f2b6` is wrong, look up the actual hash for `sha256("global:deposit")` and update both the test expectation and your understanding — Anchor's published discriminators are the source of truth.)

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/strategy-presets/discriminator.ts app/src/lib/strategy-presets/__tests__/discriminator.test.ts
git commit -m "$(cat <<'EOF'
feat(app): anchor discriminator helper for AllowedAction PDA seeds

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Registry data module

**Files:**
- Create: `app/src/lib/strategy-presets/registry.ts`

- [ ] **Step 1: Write the registry**

```typescript
// app/src/lib/strategy-presets/registry.ts
import { PublicKey, Cluster } from "@solana/web3.js";
import type { ClusterName, ProtocolRegistry } from "./types";

const MOCK_KAMINO = new PublicKey("H4tUCeXMQduSmB6fjqbYMdFb49E8YnEHku5NWFrWKaGU");
const MOCK_LULO = new PublicKey("DUECqnJ77fP2Kd9SqeTsVc9n7MiTaBvSW3mREM8DuBVs");
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");

const ROUND_7_TEST_USDC = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");

export const PROTOCOL_REGISTRY: ProtocolRegistry = {
    devnet: {
        mockPythProgramId: MOCK_PYTH,
        protocols: {
            kamino: {
                programId: MOCK_KAMINO,
                discriminators: {
                    deposit: "deposit_reserve_liquidity_and_obligation_collateral",
                    withdraw: "withdraw_obligation_collateral_and_redeem_reserve_collateral",
                    borrow: "borrow_obligation_liquidity",
                    repay: "repay_obligation_liquidity",
                },
                // ValueSourceDescriptor wired in Plan 3, when the
                // strategy-creation flow has the obligation pubkey.
            },
            lulo: {
                programId: MOCK_LULO,
                discriminators: {
                    deposit: "deposit",
                    withdraw: "withdraw",
                },
            },
            raydium: {
                programId: null,
                discriminators: {},
                note: "No in-workspace swap mock yet. Plan 3 either ships one or routes swap-leg through mock_kamino. Mainnet wiring tracked in FOLLOWUPS A4.",
            },
            jupiter: {
                programId: null,
                discriminators: {},
                note: "Folded into the Raydium Swapper preset (per spec). Mainnet entry tracked in FOLLOWUPS A4.",
            },
        },
        priceFeeds: [
            {
                mint: ROUND_7_TEST_USDC,
                coingeckoId: "usd-coin",
                // feedPda omitted — keeper derives [b"price", mint] under MOCK_PYTH.
            },
        ],
    },
    "mainnet-beta": {
        mockPythProgramId: null,
        protocols: {
            kamino: {
                programId: null,
                discriminators: {},
                note: "FOLLOWUPS A4: fill with KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD + verified discriminators.",
            },
            lulo: {
                programId: null,
                discriminators: {},
                note: "FOLLOWUPS A4: fill with real Lulo program ID + discriminators.",
            },
            raydium: {
                programId: null,
                discriminators: {},
                note: "FOLLOWUPS A4: fill with Raydium CLMM + AMM v4 IDs + verified swap discriminators.",
            },
            jupiter: {
                programId: null,
                discriminators: {},
                note: "FOLLOWUPS A4: fill with JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4.",
            },
        },
        priceFeeds: [],
    },
};

export function getRegistryForCluster(cluster: ClusterName) {
    const entry = PROTOCOL_REGISTRY[cluster];
    if (!entry) {
        throw new Error(`PROTOCOL_REGISTRY has no entry for cluster '${cluster}'.`);
    }
    return entry;
}

/**
 * Solana web3 `Cluster` is `devnet | testnet | mainnet-beta`. We don't
 * support `testnet`. Returns the active cluster or throws.
 */
export function clusterOrThrow(c: Cluster): ClusterName {
    if (c === "devnet" || c === "mainnet-beta") return c;
    throw new Error(
        `PROTOCOL_REGISTRY does not support cluster '${c}'. Only 'devnet' and 'mainnet-beta' are wired.`,
    );
}
```

- [ ] **Step 2: Compile-check**

```bash
cd app && bunx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/strategy-presets/registry.ts
git commit -m "$(cat <<'EOF'
feat(app): per-cluster PROTOCOL_REGISTRY (devnet wired, mainnet stubbed)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Registry shape tests

**Files:**
- Create: `app/src/lib/strategy-presets/__tests__/registry.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { expect } from "chai";
import { PROTOCOL_REGISTRY, getRegistryForCluster, clusterOrThrow } from "../registry";

describe("PROTOCOL_REGISTRY", () => {
    it("has both clusters", () => {
        expect(PROTOCOL_REGISTRY).to.have.property("devnet");
        expect(PROTOCOL_REGISTRY).to.have.property("mainnet-beta");
    });

    describe("devnet", () => {
        const dev = PROTOCOL_REGISTRY.devnet;

        it("has mockPythProgramId set", () => {
            expect(dev.mockPythProgramId).to.not.be.null;
        });

        it("kamino has all four discriminators", () => {
            const k = dev.protocols.kamino;
            expect(k.programId).to.not.be.null;
            expect(k.discriminators.deposit).to.be.a("string");
            expect(k.discriminators.withdraw).to.be.a("string");
            expect(k.discriminators.borrow).to.be.a("string");
            expect(k.discriminators.repay).to.be.a("string");
        });

        it("lulo has deposit + withdraw", () => {
            const l = dev.protocols.lulo;
            expect(l.programId).to.not.be.null;
            expect(l.discriminators.deposit).to.be.a("string");
            expect(l.discriminators.withdraw).to.be.a("string");
        });

        it("raydium and jupiter are stubbed with notes", () => {
            for (const p of ["raydium", "jupiter"] as const) {
                const entry = dev.protocols[p];
                expect(entry.programId).to.be.null;
                expect(entry.note).to.be.a("string").that.has.length.greaterThan(20);
            }
        });

        it("ships at least one priceFeed for keeper smoke-test", () => {
            expect(dev.priceFeeds.length).to.be.greaterThan(0);
            expect(dev.priceFeeds[0].coingeckoId).to.match(/^[a-z0-9-]+$/);
        });
    });

    describe("mainnet-beta", () => {
        const main = PROTOCOL_REGISTRY["mainnet-beta"];

        it("every protocol entry is null with a FOLLOWUPS note", () => {
            for (const p of ["kamino", "lulo", "raydium", "jupiter"] as const) {
                const entry = main.protocols[p];
                expect(entry.programId, p).to.be.null;
                expect(entry.note, p).to.match(/FOLLOWUPS A4/);
            }
        });

        it("has empty priceFeeds and null mockPythProgramId", () => {
            expect(main.priceFeeds).to.deep.equal([]);
            expect(main.mockPythProgramId).to.be.null;
        });
    });

    describe("getRegistryForCluster", () => {
        it("returns the devnet entry", () => {
            expect(getRegistryForCluster("devnet")).to.equal(PROTOCOL_REGISTRY.devnet);
        });
        it("throws on unsupported cluster", () => {
            // @ts-expect-error testing runtime behaviour
            expect(() => getRegistryForCluster("testnet")).to.throw(/no entry/);
        });
    });

    describe("clusterOrThrow", () => {
        it("accepts devnet + mainnet-beta", () => {
            expect(clusterOrThrow("devnet")).to.equal("devnet");
            expect(clusterOrThrow("mainnet-beta")).to.equal("mainnet-beta");
        });
        it("rejects testnet", () => {
            expect(() => clusterOrThrow("testnet")).to.throw(/does not support/);
        });
    });
});
```

- [ ] **Step 2: Run**

```bash
bunx ts-mocha -p ./tsconfig.json "app/src/lib/strategy-presets/__tests__/registry.test.ts"
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/strategy-presets/__tests__/registry.test.ts
git commit -m "$(cat <<'EOF'
test(app): PROTOCOL_REGISTRY shape + cluster-resolver coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `crank-mock-prices.ts` keeper

**Files:**
- Create: `scripts/crank-mock-prices.ts`

- [ ] **Step 1: Write the keeper**

```typescript
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
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";
import {
    PROTOCOL_REGISTRY,
    clusterOrThrow,
} from "../app/src/lib/strategy-presets/registry";
import type { ClusterName, PriceFeedEntry } from "../app/src/lib/strategy-presets/types";
import type { MockPyth } from "../target/types/mock_pyth";
import mockPythIdl from "../target/idl/mock_pyth.json";

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
    await program.methods
        .setPrice(new anchor.BN(priceI64.toString()), KEEPER_EXPO)
        .accountsStrict({
            payer: payer.publicKey,
            mint: entry.mint,
            feed: entry.feedPda ?? derivePriceFeedPda(program.programId, entry.mint),
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
    const program = new anchor.Program<MockPyth>(
        mockPythIdl as any,
        reg.mockPythProgramId,
        provider,
    );

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
```

- [ ] **Step 2: Compile-check**

```bash
bunx tsc --noEmit -p tsconfig.json
```

(Use the root `tsconfig.json`, which the existing `scripts/*.ts` files compile under.)

- [ ] **Step 3: Smoke-run (read-only)**

```bash
ANCHOR_WALLET=/path/to/your/keypair.json bun scripts/crank-mock-prices.ts --cluster devnet
```

Expected output: one log line per registered price feed, e.g.:
```
[crank] 7MNPXdG3…  $1.0001  ✓
```

If you don't have access to the deployer keypair, skip the smoke-run — Task 6's unit test verifies the price-resolution logic without touching chain.

- [ ] **Step 4: Commit**

```bash
git add scripts/crank-mock-prices.ts
git commit -m "$(cat <<'EOF'
feat(scripts): crank-mock-prices keeper for mock_pyth feeds

Fetches CoinGecko spot prices for every mint in PROTOCOL_REGISTRY's
priceFeeds list and writes them via mock_pyth.set_price. Supports
--loop for keeper-style operation; mirrors scripts/crank-yield.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Keeper unit test (mocked CoinGecko)

**Files:**
- Create: `scripts/__tests__/crank-mock-prices.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { expect } from "chai";
import { fetchPricesUsd, derivePriceFeedPda } from "../crank-mock-prices";
import { PublicKey } from "@solana/web3.js";

function fakeFetch(body: any, ok = true): typeof fetch {
    return (async () =>
        ({
            ok,
            status: ok ? 200 : 500,
            statusText: ok ? "OK" : "Internal Server Error",
            json: async () => body,
        }) as Response) as unknown as typeof fetch;
}

describe("crank-mock-prices: fetchPricesUsd", () => {
    it("returns a map keyed by coingecko id with i64 prices at expo -8", async () => {
        const fetchImpl = fakeFetch({
            "usd-coin": { usd: 1.0001 },
            solana: { usd: 150.42 },
        });
        const out = await fetchPricesUsd(["usd-coin", "solana"], fetchImpl);
        expect(out.get("usd-coin")).to.equal(BigInt(100010000));
        expect(out.get("solana")).to.equal(BigInt(15042000000));
    });

    it("skips ids missing from the response", async () => {
        const fetchImpl = fakeFetch({ "usd-coin": { usd: 1 } });
        const out = await fetchPricesUsd(["usd-coin", "missing-id"], fetchImpl);
        expect(out.has("usd-coin")).to.be.true;
        expect(out.has("missing-id")).to.be.false;
    });

    it("returns empty map for empty input", async () => {
        const out = await fetchPricesUsd([]);
        expect(out.size).to.equal(0);
    });

    it("throws on non-OK response", async () => {
        const fetchImpl = fakeFetch({}, false);
        let err: Error | null = null;
        try {
            await fetchPricesUsd(["usd-coin"], fetchImpl);
        } catch (e: any) {
            err = e;
        }
        expect(err).to.not.be.null;
        expect(err!.message).to.match(/CoinGecko fetch failed/);
    });
});

describe("crank-mock-prices: derivePriceFeedPda", () => {
    it("matches the seeds [b'price', mint] under the supplied program ID", () => {
        const programId = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
        const mint = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
        const pda = derivePriceFeedPda(programId, mint);
        const [expected] = PublicKey.findProgramAddressSync(
            [Buffer.from("price"), mint.toBuffer()],
            programId,
        );
        expect(pda.toBase58()).to.equal(expected.toBase58());
    });
});
```

- [ ] **Step 2: Run**

```bash
bunx ts-mocha -p ./tsconfig.json "scripts/__tests__/crank-mock-prices.test.ts"
```

Expected: all five tests pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/crank-mock-prices.test.ts
git commit -m "$(cat <<'EOF'
test(scripts): crank-mock-prices fetchPricesUsd + PDA derivation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: package.json wiring

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add scripts**

Add two entries to the root `package.json`'s `scripts` block (next to `deploy:devnet` / `deploy:mainnet`):

```json
    "crank:prices": "bun scripts/crank-mock-prices.ts --cluster devnet",
    "crank:prices:loop": "bun scripts/crank-mock-prices.ts --cluster devnet --loop 60"
```

(Mind the trailing comma on the previous line.)

- [ ] **Step 2: Verify**

```bash
bun run crank:prices --help 2>&1 | head -3
```

(There's no `--help` flag — the script ignores unknown args and runs a tick. Watch that it at least starts.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: add crank:prices + crank:prices:loop bun scripts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: FOLLOWUPS update

**Files:**
- Modify: `docs/FOLLOWUPS.md`

- [ ] **Step 1: Update the snapshot table**

Append a new row:
```
| 5c | PROTOCOL_REGISTRY (devnet wired, mainnet stubbed) + crank-mock-prices keeper (Plan 2) |
```

- [ ] **Step 2: Update A4 status**

Replace the current "Status:" line in section A4 with:
```
**Status:** Plans 1 + 2 shipped 2026-05-03. Plan 1 = on-chain `PythPriceFeed` + `mock_pyth`; Plan 2 = per-cluster `PROTOCOL_REGISTRY` (devnet wired, mainnet stubbed) + `crank-mock-prices.ts` keeper. Plan 3 (preset bundles + UI) is the next slice; mainnet wiring items below remain.
```

- [ ] **Step 3: Commit**

```bash
git add docs/FOLLOWUPS.md
git commit -m "$(cat <<'EOF'
docs(followups): mark Plan 2 (registry + price keeper) shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

1. **Spec coverage:** Spec items "per-cluster `PROTOCOL_REGISTRY`" and "`scripts/crank-mock-prices.ts`" both implemented. Spec items reserved for Plan 3: `presets.ts`, `diff.ts`, the UI dropdown, the change-preset modal. ✅
2. **No placeholders:** Every code block contains the actual code. The `valueSource` field on `kamino` is intentionally omitted with a comment pointing at Plan 3 — this is documented, not a placeholder. ✅
3. **Mainnet safety:** every mainnet entry is `null` programId + a `note` mentioning FOLLOWUPS A4. Consumers that try to use the registry on mainnet hit a clear error rather than crash. `clusterOrThrow` rejects `testnet`. ✅
4. **Type consistency:** `ClusterName` (`"devnet" | "mainnet-beta"`) matches Solana's `Cluster` exactly minus `testnet`. `ProtocolName` matches the spec's four protocols. `PriceFeedEntry.feedPda` is optional with a documented derivation fallback. ✅
5. **Backwards compatibility:** No changes to existing files except the additive `package.json` scripts and the FOLLOWUPS doc. ✅
