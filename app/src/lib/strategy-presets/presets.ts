// app/src/lib/strategy-presets/presets.ts
import * as anchor from "@coral-xyz/anchor";
import {
    PublicKey,
    Connection,
    TransactionInstruction,
} from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import type { MyProject } from "../../idl/my_project";
import {
    buildAllowedActionIx,
    buildAutoActionConfigIx,
    buildValueSourceIx,
    getVaultAllowedTokens,
} from "./builders";
import { anchorDiscriminator } from "./discriminator";
import {
    PROTOCOL_REGISTRY,
    clusterOrThrow,
} from "./registry";
import type { ClusterName, ProtocolName } from "./types";
import type { RowId } from "./diff";

export type PresetName =
    | "kamino_liquidity"
    | "kamino_looper"
    | "lulo_lending"
    | "raydium_swapper";

export interface PresetBuildContext {
    connection: Connection;
    program: Program<MyProject>;
    cluster: ClusterName;
    admin: PublicKey;
    vaultState: PublicKey;
    /** 32-byte vault key, used to seed strategy_authority etc. */
    vault: PublicKey;
    strategyId: BN;
    strategy: PublicKey;
    /** Strategy ATA key (for value-source target verification). */
    strategyTokenAccount: PublicKey;
    /** strategy_authority PDA owning the strategy ATA. */
    strategyAuthority: PublicKey;
    /** Decimals of the vault's underlying mint. Used to derive Pyth
     *  ValueSource `scaleDen`. The create form fetches this once via
     *  `getMint(connection, vault.tokenMint)` before calling buildIxs. */
    underlyingDecimals: number;
    /** Required for Kamino Liquidity / Kamino Looper presets. The
     *  Kamino obligation account whose `deposits[reserve_index]
     *  .deposited_amount` field the AccountU64 value source reads.
     *  Optional because Lulo / Raydium presets ignore it. */
    kaminoObligation?: PublicKey;
    /** Byte offset inside `kaminoObligation` where the deposited
     *  cToken amount lives. Defaults to 184 (Kamino's
     *  `Obligation.deposits[0].deposited_amount` offset on mainnet);
     *  override via the create form for non-default reserves. */
    kaminoObligationOffset?: number;
}

export interface StrategyPreset {
    name: PresetName;
    /** Human-readable label shown in the UI. */
    label: string;
    /** Short summary shown in the preset dropdown. */
    summary: string;
    /** Compile to the full ix bundle for this strategy. */
    buildIxs: (ctx: PresetBuildContext) => Promise<TransactionInstruction[]>;
    /** Row identifiers the preset would write — for diff + detection. */
    buildRows: (ctx: PresetBuildContext) => Promise<RowId[]>;
}

const KAMINO_LIQUIDITY_LOSS_BPS = 100; // 1%
const RAYDIUM_SWAP_LOSS_BPS = 50; // 0.5%
const PYTH_MAX_STALENESS_SECS = 60;

function disc(name: string): number[] {
    return Array.from(anchorDiscriminator(name));
}

// ============================================================
// SHARED SPEC TYPES
// ============================================================

interface AllowedActionSpec {
    targetProgram: PublicKey;
    discriminator: number[];
    lossPerCallBpsCap?: number;
    outputMintIndex?: number | null;
}

interface AutoActionSpec {
    kind: 0 | 1;
    targetProgram: PublicKey;
    discriminator: number[];
    ixData: Buffer;
}

interface ValueSourceSpec {
    index: number;
    kind: 0 | 1 | 2;
    targetAccount: PublicKey;
    offset?: number;
    scaleNum?: BN;
    scaleDen?: BN;
    mintBalanceSourceIndex?: number;
    maxStalenessSecs?: number;
}

interface PresetBundleSpec {
    allowedActions: AllowedActionSpec[];
    autoActions: AutoActionSpec[];
    valueSources: ValueSourceSpec[];
}

// ============================================================
// KAMINO LIQUIDITY spec
// ============================================================

async function kaminoLiquiditySpec(ctx: PresetBuildContext): Promise<PresetBundleSpec> {
    const reg = PROTOCOL_REGISTRY[ctx.cluster];
    const entry = reg.protocols.kamino;
    if (!entry.programId) {
        throw new Error(
            `Kamino is not wired on ${ctx.cluster}. ${entry.note ?? ""}`,
        );
    }
    if (!ctx.kaminoObligation) {
        throw new Error(
            "Kamino Liquidity preset requires `kaminoObligation` in PresetBuildContext. Paste the strategy's Kamino obligation pubkey before applying.",
        );
    }

    const depositDisc = disc(entry.discriminators.deposit!);
    const withdrawDisc = disc(entry.discriminators.withdraw!);

    return {
        allowedActions: [
            {
                targetProgram: entry.programId,
                discriminator: depositDisc,
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
            {
                targetProgram: entry.programId,
                discriminator: withdrawDisc,
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
        ],
        autoActions: [
            {
                kind: 0,
                targetProgram: entry.programId,
                discriminator: depositDisc,
                ixData: Buffer.alloc(0),
            },
            {
                kind: 1,
                targetProgram: entry.programId,
                discriminator: withdrawDisc,
                ixData: Buffer.alloc(0),
            },
        ],
        valueSources: [
            {
                index: 0,
                kind: 1, // AccountU64
                targetAccount: ctx.kaminoObligation,
                offset: ctx.kaminoObligationOffset ?? 184,
                scaleNum: new BN(1),
                scaleDen: new BN(1),
            },
        ],
    };
}

// ============================================================
// RAYDIUM SWAPPER spec
// ============================================================

async function raydiumSwapperSpec(ctx: PresetBuildContext): Promise<PresetBundleSpec> {
    const reg = PROTOCOL_REGISTRY[ctx.cluster];
    const allowedActions: AllowedActionSpec[] = [];

    for (const proto of ["raydium", "jupiter"] as const) {
        const entry = reg.protocols[proto];
        if (!entry.programId) continue;
        allowedActions.push({
            targetProgram: entry.programId,
            discriminator: disc("swap"),
            lossPerCallBpsCap: RAYDIUM_SWAP_LOSS_BPS,
            outputMintIndex: 1,
        });
    }

    const allowedMints = await getVaultAllowedTokens(
        ctx.connection,
        ctx.program.programId,
        ctx.vault,
    );
    if (allowedMints.length === 0) {
        throw new Error(
            "Raydium Swapper preset requires at least one VaultAllowedToken on the vault.",
        );
    }
    if (allowedMints.length > 8) {
        throw new Error(
            `Raydium Swapper preset can price up to 8 mints (got ${allowedMints.length}). Trim the vault allow-list or extend MAX_VALUE_SOURCES_PER_STRATEGY.`,
        );
    }
    if (!reg.mockPythProgramId) {
        throw new Error(
            `Raydium Swapper preset needs a price-feed program; ${ctx.cluster} has no mockPythProgramId in PROTOCOL_REGISTRY.`,
        );
    }

    const valueSources: ValueSourceSpec[] = [];
    for (let i = 0; i < allowedMints.length; i++) {
        const mint = allowedMints[i];
        const ata = getAssociatedTokenAddressSync(
            mint,
            ctx.strategyAuthority,
            true,
        );
        const [feedPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("price"), mint.toBuffer()],
            reg.mockPythProgramId,
        );
        const mintInfo = await getMint(ctx.connection, mint);
        const expoMagnitude = 8;
        const exponent = expoMagnitude + mintInfo.decimals - ctx.underlyingDecimals;
        let scaleNum = new BN(1);
        let scaleDen = new BN(1);
        if (exponent >= 0) {
            scaleDen = new BN(10).pow(new BN(exponent));
        } else {
            scaleNum = new BN(10).pow(new BN(-exponent));
        }

        const balanceVsIndex = i * 2;
        const pythVsIndex = i * 2 + 1;
        valueSources.push(
            {
                index: balanceVsIndex,
                kind: 0, // SplAtaBalance
                targetAccount: ata,
            },
            {
                index: pythVsIndex,
                kind: 2, // PythPriceFeed
                targetAccount: feedPda,
                scaleNum,
                scaleDen,
                mintBalanceSourceIndex: balanceVsIndex,
                maxStalenessSecs: PYTH_MAX_STALENESS_SECS,
            },
        );
    }

    return { allowedActions, autoActions: [], valueSources };
}

// ============================================================
// LULO LENDING spec
// ============================================================

async function luloLendingSpec(ctx: PresetBuildContext): Promise<PresetBundleSpec> {
    const reg = PROTOCOL_REGISTRY[ctx.cluster];
    const entry = reg.protocols.lulo;
    if (!entry.programId) {
        throw new Error(`Lulo is not wired on ${ctx.cluster}. ${entry.note ?? ""}`);
    }

    const depositDisc = disc(entry.discriminators.deposit!);
    const withdrawDisc = disc(entry.discriminators.withdraw!);

    return {
        allowedActions: [
            {
                targetProgram: entry.programId,
                discriminator: depositDisc,
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
            {
                targetProgram: entry.programId,
                discriminator: withdrawDisc,
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
        ],
        autoActions: [
            {
                kind: 0,
                targetProgram: entry.programId,
                discriminator: depositDisc,
                ixData: Buffer.alloc(0),
            },
            {
                kind: 1,
                targetProgram: entry.programId,
                discriminator: withdrawDisc,
                ixData: Buffer.alloc(0),
            },
        ],
        valueSources: [],
    };
}

// ============================================================
// Spec → ixs + RowIds helpers
// ============================================================

async function specToIxs(ctx: PresetBuildContext, spec: PresetBundleSpec): Promise<TransactionInstruction[]> {
    const ixs: TransactionInstruction[] = [];
    for (const aa of spec.allowedActions) {
        ixs.push(
            await buildAllowedActionIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                targetProgram: aa.targetProgram,
                discriminator: aa.discriminator,
                lossPerCallBpsCap: aa.lossPerCallBpsCap ?? KAMINO_LIQUIDITY_LOSS_BPS,
                outputMintIndex: aa.outputMintIndex ?? null,
            }),
        );
    }
    for (const ac of spec.autoActions) {
        ixs.push(
            await buildAutoActionConfigIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                kind: ac.kind,
                targetProgram: ac.targetProgram,
                discriminator: ac.discriminator,
                ixData: ac.ixData,
            }),
        );
    }
    for (const vs of spec.valueSources) {
        ixs.push(
            await buildValueSourceIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                index: vs.index,
                kind: vs.kind,
                targetAccount: vs.targetAccount,
                offset: vs.offset,
                scaleNum: vs.scaleNum,
                scaleDen: vs.scaleDen,
                mintBalanceSourceIndex: vs.mintBalanceSourceIndex,
                maxStalenessSecs: vs.maxStalenessSecs,
            }),
        );
    }
    return ixs;
}

function specToRows(spec: PresetBundleSpec): RowId[] {
    const rows: RowId[] = [];
    for (const aa of spec.allowedActions) {
        rows.push({
            type: "allowed_action",
            targetProgram: aa.targetProgram.toBase58(),
            discriminator: Buffer.from(aa.discriminator).toString("hex"),
        });
    }
    for (const ac of spec.autoActions) {
        rows.push({ type: "auto_action", kind: ac.kind });
    }
    for (const vs of spec.valueSources) {
        rows.push({ type: "value_source", index: vs.index });
    }
    return rows;
}

// ============================================================
// KAMINO LIQUIDITY
// ============================================================

export const KAMINO_LIQUIDITY: StrategyPreset = {
    name: "kamino_liquidity",
    label: "Kamino Liquidity",
    summary: "Deposit + withdraw against Kamino Lend; live NAV via reserve-collateral read.",
    async buildIxs(ctx) {
        const spec = await kaminoLiquiditySpec(ctx);
        return specToIxs(ctx, spec);
    },
    async buildRows(ctx) {
        const spec = await kaminoLiquiditySpec(ctx);
        return specToRows(spec);
    },
};

// ============================================================
// KAMINO LOOPER
// ============================================================

export const KAMINO_LOOPER: StrategyPreset = {
    name: "kamino_looper",
    label: "Kamino Looper",
    summary: "Kamino Liquidity + borrow/repay (looped leverage).",
    async buildIxs(ctx) {
        const baseSpec = await kaminoLiquiditySpec(ctx);
        const reg = PROTOCOL_REGISTRY[ctx.cluster];
        const entry = reg.protocols.kamino;
        if (!entry.programId) {
            return specToIxs(ctx, baseSpec);
        }
        const extraActions: AllowedActionSpec[] = [
            {
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.borrow!),
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
            {
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.repay!),
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
        ];
        const fullSpec: PresetBundleSpec = {
            ...baseSpec,
            allowedActions: [...baseSpec.allowedActions, ...extraActions],
        };
        return specToIxs(ctx, fullSpec);
    },
    async buildRows(ctx) {
        const baseSpec = await kaminoLiquiditySpec(ctx);
        const reg = PROTOCOL_REGISTRY[ctx.cluster];
        const entry = reg.protocols.kamino;
        if (!entry.programId) {
            return specToRows(baseSpec);
        }
        const extraActions: AllowedActionSpec[] = [
            {
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.borrow!),
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
            {
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.repay!),
                lossPerCallBpsCap: KAMINO_LIQUIDITY_LOSS_BPS,
            },
        ];
        const fullSpec: PresetBundleSpec = {
            ...baseSpec,
            allowedActions: [...baseSpec.allowedActions, ...extraActions],
        };
        return specToRows(fullSpec);
    },
};

// ============================================================
// LULO LENDING
// ============================================================

export const LULO_LENDING: StrategyPreset = {
    name: "lulo_lending",
    label: "Lulo Lending",
    summary: "Lend + redeem against Lulo; live NAV via position-account read.",
    async buildIxs(ctx) {
        const spec = await luloLendingSpec(ctx);
        return specToIxs(ctx, spec);
    },
    async buildRows(ctx) {
        const spec = await luloLendingSpec(ctx);
        return specToRows(spec);
    },
};

// ============================================================
// RAYDIUM SWAPPER
// ============================================================

export const RAYDIUM_SWAPPER: StrategyPreset = {
    name: "raydium_swapper",
    label: "Raydium Swapper",
    summary:
        "Swap among allow-listed mints (Raydium + Jupiter on mainnet). NAV from balance × Pyth price per allow-listed mint.",
    async buildIxs(ctx) {
        const spec = await raydiumSwapperSpec(ctx);
        return specToIxs(ctx, spec);
    },
    async buildRows(ctx) {
        const spec = await raydiumSwapperSpec(ctx);
        return specToRows(spec);
    },
};

export const PRESETS: StrategyPreset[] = [
    KAMINO_LIQUIDITY,
    KAMINO_LOOPER,
    LULO_LENDING,
    RAYDIUM_SWAPPER,
];

export const PRESETS_BY_NAME: Record<PresetName, StrategyPreset> = {
    kamino_liquidity: KAMINO_LIQUIDITY,
    kamino_looper: KAMINO_LOOPER,
    lulo_lending: LULO_LENDING,
    raydium_swapper: RAYDIUM_SWAPPER,
};
