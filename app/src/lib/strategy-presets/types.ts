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
