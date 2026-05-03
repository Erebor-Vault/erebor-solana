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
