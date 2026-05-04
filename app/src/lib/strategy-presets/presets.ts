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
}

const KAMINO_LIQUIDITY_LOSS_BPS = 100; // 1%
const RAYDIUM_SWAP_LOSS_BPS = 50; // 0.5%
const PYTH_MAX_STALENESS_SECS = 60;

function disc(name: string): number[] {
    return Array.from(anchorDiscriminator(name));
}

/**
 * Helper: emit allowed-action ixs for a list of named ix discriminators
 * against a single target program.
 */
async function allowedActionsForProtocol(
    ctx: PresetBuildContext,
    protocol: ProtocolName,
    ixNames: string[],
    opts: { lossPerCallBpsCap?: number; outputMintIndex?: number | null } = {},
): Promise<TransactionInstruction[]> {
    const reg = PROTOCOL_REGISTRY[ctx.cluster];
    const entry = reg.protocols[protocol];
    if (!entry.programId) return []; // stubbed cluster — no-op, caller decides whether that's OK
    const ixs: TransactionInstruction[] = [];
    for (const ixName of ixNames) {
        ixs.push(
            await buildAllowedActionIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                targetProgram: entry.programId,
                discriminator: disc(ixName),
                lossPerCallBpsCap: opts.lossPerCallBpsCap ?? KAMINO_LIQUIDITY_LOSS_BPS,
                outputMintIndex: opts.outputMintIndex ?? null,
            }),
        );
    }
    return ixs;
}

// ============================================================
// KAMINO LIQUIDITY
// ============================================================

export const KAMINO_LIQUIDITY: StrategyPreset = {
    name: "kamino_liquidity",
    label: "Kamino Liquidity",
    summary: "Deposit + withdraw against Kamino Lend; live NAV via reserve-collateral read.",
    async buildIxs(ctx) {
        const reg = PROTOCOL_REGISTRY[ctx.cluster];
        const entry = reg.protocols.kamino;
        if (!entry.programId) {
            throw new Error(
                `Kamino is not wired on ${ctx.cluster}. ${entry.note ?? ""}`,
            );
        }
        const ixs: TransactionInstruction[] = [];
        ixs.push(
            ...(await allowedActionsForProtocol(ctx, "kamino", [
                entry.discriminators.deposit!,
                entry.discriminators.withdraw!,
            ])),
        );
        // Auto-action configs: deposit + withdraw. ix_data is empty —
        // the agent fills in protocol-specific args at execute_action time.
        ixs.push(
            await buildAutoActionConfigIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                kind: 0,
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.deposit!),
                ixData: Buffer.alloc(0),
            }),
            await buildAutoActionConfigIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                kind: 1,
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.withdraw!),
                ixData: Buffer.alloc(0),
            }),
        );
        // Value source #0: AccountU64 pointing at the Kamino obligation
        // account, reading the cToken deposited_amount at the configured
        // offset. The create form supplies `kaminoObligation` +
        // `kaminoObligationOffset` (defaults to 184). Without them, the
        // preset throws — the curator must paste the obligation pubkey.
        if (!ctx.kaminoObligation) {
            throw new Error(
                "Kamino Liquidity preset requires `kaminoObligation` in PresetBuildContext. Paste the strategy's Kamino obligation pubkey before applying.",
            );
        }
        ixs.push(
            await buildValueSourceIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                index: 0,
                kind: 1, // AccountU64
                targetAccount: ctx.kaminoObligation,
                offset: ctx.kaminoObligationOffset ?? 184,
                // scale 1/1: cToken amount is reported pre-conversion;
                // for a precise reserve-rate multiplier the curator
                // edits this VS in the per-strategy editor afterwards.
                scaleNum: new BN(1),
                scaleDen: new BN(1),
            }),
        );
        return ixs;
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
        const ixs = await KAMINO_LIQUIDITY.buildIxs(ctx);
        const reg = PROTOCOL_REGISTRY[ctx.cluster];
        const entry = reg.protocols.kamino;
        if (!entry.programId) return ixs; // base preset already threw if missing
        ixs.push(
            ...(await allowedActionsForProtocol(ctx, "kamino", [
                entry.discriminators.borrow!,
                entry.discriminators.repay!,
            ])),
        );
        return ixs;
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
        const reg = PROTOCOL_REGISTRY[ctx.cluster];
        const entry = reg.protocols.lulo;
        if (!entry.programId) {
            throw new Error(`Lulo is not wired on ${ctx.cluster}. ${entry.note ?? ""}`);
        }
        const ixs: TransactionInstruction[] = [];
        ixs.push(
            ...(await allowedActionsForProtocol(ctx, "lulo", [
                entry.discriminators.deposit!,
                entry.discriminators.withdraw!,
            ])),
        );
        ixs.push(
            await buildAutoActionConfigIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                kind: 0,
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.deposit!),
                ixData: Buffer.alloc(0),
            }),
            await buildAutoActionConfigIx({
                program: ctx.program,
                admin: ctx.admin,
                vaultState: ctx.vaultState,
                strategyId: ctx.strategyId,
                strategy: ctx.strategy,
                kind: 1,
                targetProgram: entry.programId,
                discriminator: disc(entry.discriminators.withdraw!),
                ixData: Buffer.alloc(0),
            }),
        );
        return ixs;
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
        const reg = PROTOCOL_REGISTRY[ctx.cluster];
        const ixs: TransactionInstruction[] = [];
        // Allowed actions: swap discriminators on Raydium + Jupiter (no-op
        // on devnet because both stubbed; populated on mainnet via
        // FOLLOWUPS A4).
        for (const proto of ["raydium", "jupiter"] as const) {
            const entry = reg.protocols[proto];
            if (!entry.programId) continue;
            // output_mint_index = 1 by Plan-3 convention: caller must place
            // the output mint at remaining_accounts[1]. Curator can edit
            // post-hoc via AllowedActionsEditor.
            ixs.push(
                ...(await allowedActionsForProtocol(ctx, proto, ["swap"], {
                    lossPerCallBpsCap: RAYDIUM_SWAP_LOSS_BPS,
                    outputMintIndex: 1,
                })),
            );
        }

        // Value sources: per allow-listed mint, register
        //   [SplAtaBalance, PythPriceFeed]
        // pair. Each pair takes 2 VS slots. With MAX_VALUE_SOURCES = 16,
        // up to 8 mints can be priced in. Preset throws if the vault has
        // more allow-listed mints than fit.
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

        // Per-mint, derive the strategy's ATA + mock_pyth feed PDA, and
        // fetch the priced mint's decimals so we can derive the right
        // Pyth `scaleDen`. Note: the strategy ATA is NOT
        // `strategy.token_account` (that's the underlying); these are
        // satellite ATAs that the swap leg fills.
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
            // Fetch the priced mint's decimals so the Pyth contribution
            // lands in underlying-token base units regardless of the
            // mint's decimals. Math:
            //   contribution_underlying_base_units
            //     = balance_in_mint_base_units
            //       × price_int            (= usd × 10^|expo|)
            //       × 10^expo              (applied by the on-chain reader)
            //       × 10^underlyingDecimals
            //       / 10^mintDecimals
            //   For expo = -8: balance × price / 10^(8 + mintDecimals - underlyingDecimals).
            // Everything except the final divisor is handled by the
            // on-chain reader, so we set:
            //   scaleNum = 1
            //   scaleDen = 10^(8 + mintDecimals - underlyingDecimals)
            // If underlyingDecimals > mintDecimals + 8, swap to
            // scaleNum = 10^(underlyingDecimals - mintDecimals - 8),
            // scaleDen = 1 — but that case is unusual (would need a
            // 17-decimal underlying).
            const mintInfo = await getMint(ctx.connection, mint);
            const expoMagnitude = 8; // PYTH_MAX_STALENESS_SECS unrelated; expo is fixed by the keeper
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
            ixs.push(
                await buildValueSourceIx({
                    program: ctx.program,
                    admin: ctx.admin,
                    vaultState: ctx.vaultState,
                    strategyId: ctx.strategyId,
                    strategy: ctx.strategy,
                    index: balanceVsIndex,
                    kind: 0,
                    targetAccount: ata,
                }),
                await buildValueSourceIx({
                    program: ctx.program,
                    admin: ctx.admin,
                    vaultState: ctx.vaultState,
                    strategyId: ctx.strategyId,
                    strategy: ctx.strategy,
                    index: pythVsIndex,
                    kind: 2,
                    targetAccount: feedPda,
                    scaleNum,
                    scaleDen,
                    mintBalanceSourceIndex: balanceVsIndex,
                    maxStalenessSecs: PYTH_MAX_STALENESS_SECS,
                }),
            );
        }
        return ixs;
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
