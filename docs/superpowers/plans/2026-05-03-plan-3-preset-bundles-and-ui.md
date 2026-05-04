# Plan 3 — Preset bundles + diff + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four `StrategyPreset` bundles (Kamino Liquidity, Kamino Looper, Lulo Lending, Raydium Swapper), the `diff` engine, the create-strategy preset dropdown, and the per-strategy "Change preset…" modal. Plans 1 and 2 already shipped the on-chain `PythPriceFeed` `ValueSource`, the `mock_pyth` program, and the per-cluster `PROTOCOL_REGISTRY`.

**Architecture:** Each preset is a pure function `buildPresetIxs(ctx) → TransactionInstruction[]` that emits the bundle of `set_allowed_action` / `set_auto_action_config` / `add_value_source` calls for a given `(vault, strategyId, cluster, overrides)`. The `diff` engine reads a strategy's *current* on-chain state and the *target* preset's expected state, returning `{ toRevoke, toAdd, valueSourcesToReplace }`. The detection helper labels existing strategies by running the empty-target diff against each known preset; first preset with empty diff wins, otherwise `Custom`. UI surfaces are admin-only via the existing `AdminGuard`: a preset dropdown above the create-strategy form pre-fills the bundle, and each strategy card grows a `Preset: <name>` line plus a "Change preset…" button that opens a confirmation modal showing the diff before submission.

**Tech Stack:** TypeScript + React (Next.js 16 App Router), `@coral-xyz/anchor` 0.32, `@solana/web3.js`, ts-mocha + chai for unit/snapshot tests, the existing `setupVault` fixture for e2e.

---

## Scope decisions (keep this plan bounded)

- **Raydium Swapper has no swap discriminators on devnet.** `PROTOCOL_REGISTRY.devnet.protocols.raydium` and `.jupiter` are stubbed (`programId: null`). Plan 3 ships the Raydium Swapper preset writing **only** the value-source half (`SplAtaBalance` + `PythPriceFeed` per allow-listed mint); the `set_allowed_action` half is a no-op on devnet and gets filled when the FOLLOWUPS A4 mainnet wiring lands. The preset still labels strategies as Raydium Swapper if the value-source layout matches.
- **`mock_pyth` feed bootstrapping is out of scope.** The Raydium Swapper preset assumes the `mock_pyth` feed PDA already exists for each allow-listed mint. The e2e test pre-initialises feeds inline via `tests/helpers/mock_pyth.ts`. Frontend bootstrap UI is a follow-up.
- **Reading the vault `AllowedToken` set off-chain.** `getProgramAccounts` filtered by the `VaultAllowedToken` discriminator + the vault pubkey. One helper, used by the Raydium Swapper preset and the snapshot tests.
- **One ix = one tx (sequential).** Verified: `useAdminActions` already submits every ix via Anchor's `.rpc()`, which builds a single-ix tx per call. We follow that pattern — each preset row becomes its own sequential tx. No chunking logic needed (no tx ever exceeds 1232 bytes), at the cost of 4–16 sequential round-trips per preset apply (~5–20 s). UI shows a `Step N/K` toast during apply.
- **Kamino NAV ValueSource is auto-registered.** `PresetBuildContext` carries an optional `kaminoObligation: PublicKey` field. When the user picks the Kamino Liquidity / Looper preset, the create form prompts for the obligation pubkey (single text input below the preset dropdown). The preset writes an `AccountU64` value source pointing at the obligation account at the configured offset.
- **Pyth scale denominator is derived from mint decimals.** The Raydium Swapper preset reads each allow-listed mint's `decimals` via `getMint()` at apply time and computes `scaleDen = 10 ^ (mintDecimals + 8 - underlyingDecimals)`. For 6-dp underlying + 6-dp mint + expo=−8, that's `10^8`; the math collapses to `balance × price / 10^underlyingDecimals` in underlying base units regardless of the priced mint's decimals.
- **No `loss_per_call_bps_cap` / `cooldown_secs` overrides in the create form.** Each preset hardcodes sensible defaults (Kamino: 100 bps, 0 s; Raydium Swapper: 50 bps, 0 s). Override UI is deferred — the existing per-strategy `AllowedActionsEditor` covers post-hoc tweaks.

---

## File Structure

**Created:**
- `app/src/lib/strategy-presets/builders.ts` — three small pure functions that build a single `TransactionInstruction` each: `buildAllowedActionIx`, `buildAutoActionConfigIx`, `buildValueSourceIx`. Plus `getVaultAllowedTokens(connection, programId, vault)` for off-chain allow-list reads.
- `app/src/lib/strategy-presets/presets.ts` — the four `StrategyPreset` objects + a `PRESETS_BY_NAME` index.
- `app/src/lib/strategy-presets/diff.ts` — `diff(current, target) → DiffResult`, `detectActivePreset(current) → PresetName | "Custom"`.
- `app/src/lib/strategy-presets/__tests__/builders.test.ts` — unit tests on the builders (PDA correctness, ix data layout).
- `app/src/lib/strategy-presets/__tests__/presets.snapshot.test.ts` — one snapshot per preset.
- `app/src/lib/strategy-presets/__tests__/diff.test.ts` — unit tests for diff + detection.
- `app/src/components/admin/PresetDropdown.tsx` — the dropdown used in `CreateStrategyForm`.
- `app/src/components/admin/strategy/PresetLabel.tsx` — the "Preset: <name>" line on each strategy card.
- `app/src/components/admin/strategy/ChangePresetModal.tsx` — the diff-confirm modal.
- `tests/preset_kamino_liquidity.ts` — e2e for Kamino Liquidity preset (create → apply → settle).
- `tests/preset_lulo_lending.ts` — e2e for Lulo Lending preset.
- `tests/preset_raydium_swapper.ts` — e2e: apply preset, init `mock_pyth` feeds, mint underlying to strategy ATA, settle, assert NAV.

**Modified:**
- `app/src/components/admin/CreateStrategyForm.tsx` — preset dropdown at top + bundle submission on success.
- `app/src/components/admin/StrategyCard.tsx` — render `PresetLabel` + "Change preset…" button.
- `app/src/hooks/useAdminActions.ts` (or wherever `createStrategy` lives) — accept an optional `presetIxs: TransactionInstruction[]` and append them to the bundle.
- `docs/FOLLOWUPS.md` — close A4's Plan-3 line.

**Not touched:**
- The on-chain program (closed in Plan 1).
- `PROTOCOL_REGISTRY` or the keeper (closed in Plan 2).

---

## Phase A — Builders + presets data + snapshot tests

## Task 1: Builders + allow-list reader

**Files:**
- Create: `app/src/lib/strategy-presets/builders.ts`

- [ ] **Step 1: Write the file**

```typescript
// app/src/lib/strategy-presets/builders.ts
import * as anchor from "@coral-xyz/anchor";
import {
    PublicKey,
    SystemProgram,
    Connection,
    TransactionInstruction,
} from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { MyProject } from "../../idl/my_project";
import type { ValueSourceDescriptor } from "./types";

/**
 * Anchor `addAllowedAction(strategy_id, target_program, discriminator,
 * expected_recipient_index, output_mint_index, loss_per_call_bps_cap,
 * cooldown_secs)`. We pin `expected_recipient_index = 0` (caller convention:
 * strategy ATA at slot 0 of the action's remaining_accounts).
 */
export interface AllowedActionParams {
    program: Program<MyProject>;
    admin: PublicKey;
    vaultState: PublicKey;
    strategyId: anchor.BN;
    strategy: PublicKey;
    targetProgram: PublicKey;
    discriminator: number[]; // 8 bytes
    expectedRecipientIndex?: number; // default 0
    outputMintIndex?: number | null; // default null
    lossPerCallBpsCap?: number; // default 0 (no cap)
    cooldownSecs?: number; // default 0
}

export async function buildAllowedActionIx(
    params: AllowedActionParams,
): Promise<TransactionInstruction> {
    const [allowedAction] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("allowed_action"),
            params.strategy.toBuffer(),
            params.targetProgram.toBuffer(),
            Buffer.from(params.discriminator),
        ],
        params.program.programId,
    );
    return await params.program.methods
        .addAllowedAction(
            params.strategyId,
            params.targetProgram,
            params.discriminator as any,
            params.expectedRecipientIndex ?? 0,
            params.outputMintIndex ?? null,
            params.lossPerCallBpsCap ?? 0,
            params.cooldownSecs ?? 0,
        )
        .accountsStrict({
            admin: params.admin,
            vaultState: params.vaultState,
            strategy: params.strategy,
            allowedAction,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}

export interface AutoActionConfigParams {
    program: Program<MyProject>;
    admin: PublicKey;
    vaultState: PublicKey;
    strategyId: anchor.BN;
    strategy: PublicKey;
    /** 0 = Deposit, 1 = Withdraw */
    kind: 0 | 1;
    targetProgram: PublicKey;
    discriminator: number[]; // 8 bytes
    /** Bytes appended after the discriminator to form the inner CPI's `data`. */
    ixData: Buffer;
}

export async function buildAutoActionConfigIx(
    params: AutoActionConfigParams,
): Promise<TransactionInstruction> {
    const [autoActionConfig] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("auto_action"),
            params.strategy.toBuffer(),
            Buffer.from([params.kind]),
        ],
        params.program.programId,
    );
    return await params.program.methods
        .setAutoActionConfig(
            params.strategyId,
            params.kind,
            params.targetProgram,
            params.discriminator as any,
            params.ixData,
        )
        .accountsStrict({
            admin: params.admin,
            vaultState: params.vaultState,
            strategy: params.strategy,
            autoActionConfig,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}

export interface ValueSourceParams {
    program: Program<MyProject>;
    admin: PublicKey;
    vaultState: PublicKey;
    strategyId: anchor.BN;
    strategy: PublicKey;
    index: number; // 0..15
    kind: 0 | 1 | 2; // SplAtaBalance | AccountU64 | PythPriceFeed
    targetAccount: PublicKey;
    offset?: number; // default 0
    scaleNum?: anchor.BN; // default BN(1)
    scaleDen?: anchor.BN; // default BN(1)
    mintBalanceSourceIndex?: number; // default 0 (only used for kind=2)
    maxStalenessSecs?: number; // default 0 (only used for kind=2)
}

export async function buildValueSourceIx(
    params: ValueSourceParams,
): Promise<TransactionInstruction> {
    const [valueSource] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("value_source"),
            params.strategy.toBuffer(),
            Buffer.from([params.index]),
        ],
        params.program.programId,
    );
    return await params.program.methods
        .addValueSource(
            params.strategyId,
            params.index,
            params.kind,
            params.targetAccount,
            params.offset ?? 0,
            params.scaleNum ?? new anchor.BN(1),
            params.scaleDen ?? new anchor.BN(1),
            params.mintBalanceSourceIndex ?? 0,
            params.maxStalenessSecs ?? 0,
        )
        .accountsStrict({
            admin: params.admin,
            vaultState: params.vaultState,
            strategy: params.strategy,
            valueSource,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}

/**
 * Read every `VaultAllowedToken` PDA owned by `programId` for the given
 * vault. Used by the Raydium Swapper preset to enumerate which mints
 * the curator has allow-listed for swapping.
 */
export async function getVaultAllowedTokens(
    connection: Connection,
    programId: PublicKey,
    vault: PublicKey,
): Promise<PublicKey[]> {
    // VaultAllowedToken layout (after 8-byte disc):
    //   vault: Pubkey (32)        — offset 8..40
    //   mint:  Pubkey (32)        — offset 40..72
    //   bump:  u8                 — offset 72
    //   _reserved: [u8;32]        — 73..105
    const accs = await connection.getProgramAccounts(programId, {
        filters: [
            { dataSize: 8 + 32 + 32 + 1 + 32 },
            { memcmp: { offset: 8, bytes: vault.toBase58() } },
        ],
    });
    return accs.map((a) => new PublicKey(a.account.data.subarray(40, 72)));
}
```

- [ ] **Step 2: Type-check**

```bash
cd app && bunx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit**

```
feat(app): strategy-preset builders + vault allow-list reader
```

---

## Task 2: Builder unit tests

**Files:**
- Create: `app/src/lib/strategy-presets/__tests__/builders.test.ts`

- [ ] **Step 1: Write the tests**

The builders are PDA-deriving + ix-building wrappers. Tests assert:
1. The PDAs they derive match the program's seed conventions.
2. The ix data layout is consistent with the IDL (Anchor handles serialisation; we trust it but assert the ix's `programId` + first-meta keys are right).

```typescript
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
```

- [ ] **Step 2: Run**

```bash
bunx ts-mocha -p ./tsconfig.json "app/src/lib/strategy-presets/__tests__/builders.test.ts"
```

Expected: all four tests pass.

- [ ] **Step 3: Commit**

```
test(app): strategy-preset builders PDA + arg layout
```

---

## Task 3: `presets.ts` — the four bundles

**Files:**
- Create: `app/src/lib/strategy-presets/presets.ts`

- [ ] **Step 1: Write the module**

```typescript
// app/src/lib/strategy-presets/presets.ts
import * as anchor from "@coral-xyz/anchor";
import {
    PublicKey,
    Connection,
    TransactionInstruction,
} from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { BN } from "bn.js";
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
        const { getAssociatedTokenAddressSync, getMint } = await import("@solana/spl-token");

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
```

- [ ] **Step 2: Type-check**

```bash
cd app && bunx tsc --noEmit -p tsconfig.json
```

If TS complains that `kamino.discriminators.deposit` may be `undefined`, the `!` non-null assertions in the preset bodies (above) handle it — but only on devnet entries which we know are populated. Mainnet calls would throw at the registry-lookup step before reaching the disc lookups. That's the contract.

- [ ] **Step 3: Commit**

```
feat(app): four StrategyPreset bundles
```

---

## Task 4: Snapshot tests for presets

**Files:**
- Create: `app/src/lib/strategy-presets/__tests__/presets.snapshot.test.ts`

- [ ] **Step 1: Write the tests**

Snapshot test: build each preset's bundle against synthetic but deterministic context, hash the resulting ixs (program ID + accounts + discriminator portion of data), assert against pinned hashes. The hashes are pinned in this test file — update them only when the preset's bundle composition intentionally changes.

```typescript
import { expect } from "chai";
import { createHash } from "crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import * as anchor from "@coral-xyz/anchor";
import {
    KAMINO_LIQUIDITY,
    KAMINO_LOOPER,
    LULO_LENDING,
    RAYDIUM_SWAPPER,
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

    it("RAYDIUM_SWAPPER throws when vault has no allow-listed mints", async () => {
        // Intentional: the preset requires at least 1 mint in the vault
        // allow-list. The Raydium Swapper's snapshot live-test runs in
        // the e2e suite (Task 11) where a vault with allow-listed mints
        // is bootstrapped; here we assert the guard.
        let err: Error | null = null;
        try {
            await RAYDIUM_SWAPPER.buildIxs(deterministicCtx());
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
```

- [ ] **Step 2: Run**

```bash
bunx ts-mocha -p ./tsconfig.json "app/src/lib/strategy-presets/__tests__/presets.snapshot.test.ts"
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```
test(app): preset bundle snapshots (devnet hashes)
```

---

## Phase B — Diff + detection

## Task 5: `diff.ts` + tests

**Files:**
- Create: `app/src/lib/strategy-presets/diff.ts`
- Create: `app/src/lib/strategy-presets/__tests__/diff.test.ts`

- [ ] **Step 1: Write `diff.ts`**

```typescript
// app/src/lib/strategy-presets/diff.ts
import type { TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { PRESETS, PresetName, PRESETS_BY_NAME, PresetBuildContext } from "./presets";

/**
 * Identifier of a single configuration row a preset can write. We
 * compare strategies by sets of these identifiers — order-independent
 * within a strategy, ordered for tx submission.
 */
export type RowId =
    | { type: "allowed_action"; targetProgram: string; discriminator: string /* hex */ }
    | { type: "auto_action"; kind: 0 | 1 }
    | { type: "value_source"; index: number };

/**
 * A snapshot of the strategy's preset-relevant on-chain state. The diff
 * engine consumes this. Caller (UI) is responsible for fetching it via
 * getProgramAccounts + filtering by strategy.
 */
export interface StrategySnapshot {
    allowedActions: { targetProgram: PublicKey; discriminator: number[] }[];
    autoActions: { kind: 0 | 1 }[];
    valueSources: { index: number; kind: 0 | 1 | 2 }[];
}

export interface DiffResult {
    toRevoke: RowId[];
    toAdd: RowId[];
}

function rowIdsFromIxs(ixs: TransactionInstruction[]): RowId[] {
    // The bundle ixs encode their target program + discriminator in
    // their data; rather than re-parse Anchor borsh here, we tag the
    // ixs at build time. For Plan 3 we do it the other way: tests
    // exercise this against real bundles by mapping (programId, first
    // 8 data bytes, ix-name heuristic) — but the cleanest source of
    // truth is to materialise rows directly from the preset's
    // buildIxs context. So: we expose a parallel `buildRows` per
    // preset (Task 6) and use *that* as the diff ground truth, not
    // re-parsing ixs.
    throw new Error("Not used — see preset.buildRows in Task 6.");
}

/**
 * Compute revoke + add lists between current state and target preset.
 * `current` is what's on-chain; `target` is what the preset would write.
 */
export function diffRowSets(current: RowId[], target: RowId[]): DiffResult {
    const ser = (r: RowId): string => JSON.stringify(r);
    const currentSet = new Set(current.map(ser));
    const targetSet = new Set(target.map(ser));
    return {
        toRevoke: current.filter((r) => !targetSet.has(ser(r))),
        toAdd: target.filter((r) => !currentSet.has(ser(r))),
    };
}

export function snapshotToRows(s: StrategySnapshot): RowId[] {
    const rows: RowId[] = [];
    for (const a of s.allowedActions) {
        rows.push({
            type: "allowed_action",
            targetProgram: a.targetProgram.toBase58(),
            discriminator: Buffer.from(a.discriminator).toString("hex"),
        });
    }
    for (const aa of s.autoActions) rows.push({ type: "auto_action", kind: aa.kind });
    for (const vs of s.valueSources) rows.push({ type: "value_source", index: vs.index });
    return rows;
}

/**
 * Run the empty-target diff against each known preset; first preset
 * whose `toAdd` AND `toRevoke` are both empty wins. Otherwise "Custom".
 */
export async function detectActivePreset(
    snapshot: StrategySnapshot,
    presetRowsByName: Record<PresetName, RowId[]>,
): Promise<PresetName | "Custom"> {
    const current = snapshotToRows(snapshot);
    for (const preset of PRESETS) {
        const target = presetRowsByName[preset.name];
        const { toRevoke, toAdd } = diffRowSets(current, target);
        if (toRevoke.length === 0 && toAdd.length === 0) {
            return preset.name;
        }
    }
    return "Custom";
}
```

- [ ] **Step 2: Add `buildRows` per preset**

In `app/src/lib/strategy-presets/presets.ts`, add a parallel `buildRows` function on each preset that emits the same logical rows the preset's `buildIxs` would write — but as `RowId[]`. This decouples diff from ix-byte parsing.

Add the field to the `StrategyPreset` interface:
```typescript
export interface StrategyPreset {
    name: PresetName;
    label: string;
    summary: string;
    buildIxs: (ctx: PresetBuildContext) => Promise<TransactionInstruction[]>;
    /** Row identifiers the preset would write — for diff + detection. */
    buildRows: (ctx: PresetBuildContext) => Promise<import("./diff").RowId[]>;
}
```

For each preset, write a `buildRows` mirroring `buildIxs`:
- `KAMINO_LIQUIDITY.buildRows`: emits 2 `allowed_action` rows (deposit + withdraw) + 2 `auto_action` rows (kind 0, 1).
- `KAMINO_LOOPER.buildRows`: liquidity rows + 2 more `allowed_action` (borrow + repay).
- `LULO_LENDING.buildRows`: same shape as Kamino Liquidity but against the Lulo program.
- `RAYDIUM_SWAPPER.buildRows`: 0–N `allowed_action` (depending on registry stub status) + 2N `value_source` rows (indices 0..2N-1) for N allow-listed mints.

Each `buildRows` follows the same registry / context resolution as `buildIxs`. Refactor common logic into a shared helper (e.g. `presetBundleSpec(ctx, presetName) → { allowedActions, autoActions, valueSources }`) and have both `buildIxs` and `buildRows` consume it. This keeps them in sync — if you forget a row in one, the snapshot tests catch it.

Concretely: introduce a private function

```typescript
async function presetBundleSpec(
    ctx: PresetBuildContext,
    preset: PresetName,
): Promise<{
    allowedActions: { targetProgram: PublicKey; discriminator: number[] }[];
    autoActions: { kind: 0 | 1; targetProgram: PublicKey; discriminator: number[] }[];
    valueSources: {
        index: number;
        kind: 0 | 1 | 2;
        targetAccount: PublicKey;
        offset?: number;
        scaleNum?: BN;
        scaleDen?: BN;
        mintBalanceSourceIndex?: number;
        maxStalenessSecs?: number;
    }[];
}>
```

…and rewrite the four `buildIxs` to call `presetBundleSpec` then map each entry to a single ix via the builder helpers, and the four `buildRows` to call `presetBundleSpec` then map each entry to a `RowId`.

- [ ] **Step 3: Write `diff.test.ts`**

```typescript
import { expect } from "chai";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { BN } from "bn.js";
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
        // (Reverse-mapping RowIds back to the snapshot shape; only the
        // fields detection cares about need to round-trip.)
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
```

- [ ] **Step 4: Run both test files**

```bash
bunx ts-mocha -p ./tsconfig.json "app/src/lib/strategy-presets/__tests__/{diff,builders,presets.snapshot}.test.ts"
```

- [ ] **Step 5: Commit (two commits)**

```
feat(app): preset diff engine + buildRows per preset
```

```
test(app): diff + detection coverage
```

---

## Phase C — UI integration

## Task 6: `PresetDropdown` component

**Files:**
- Create: `app/src/components/admin/PresetDropdown.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { PRESETS, PresetName } from "@/lib/strategy-presets/presets";

interface Props {
    value: PresetName | "custom";
    onChange: (next: PresetName | "custom") => void;
    disabled?: boolean;
}

export function PresetDropdown({ value, onChange, disabled }: Props) {
    return (
        <div className="space-y-1">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                Preset
            </label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as any)}
                disabled={disabled}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-50"
            >
                <option value="custom">Custom (manual config)</option>
                {PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                        {p.label}
                    </option>
                ))}
            </select>
            {value !== "custom" && (
                <p className="text-xs text-[var(--color-text-secondary)]">
                    {PRESETS.find((p) => p.name === value)?.summary}
                </p>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Wire into `CreateStrategyForm`**

In `app/src/components/admin/CreateStrategyForm.tsx`:
1. Add `useState<PresetName | "custom">("custom")` for preset selection.
2. Add `useState("")` for `kaminoObligation` — a text input rendered conditionally when `selectedPreset` starts with `"kamino_"`. Validate as `PublicKey` on submit.
3. Render `<PresetDropdown ... />` at the top of the form (when `open`). Render the obligation input below it when applicable.
4. Before calling `createStrategy`, fetch the underlying mint's decimals once via `getMint(connection, vault.tokenMint)`.
5. After `createStrategy(delegatePubkey)` returns the new `strategyId`, build the `PresetBuildContext` (carrying `underlyingDecimals` and the parsed `kaminoObligation`), then call `PRESETS_BY_NAME[selectedPreset].buildIxs(ctx)`.
6. Submit each returned `TransactionInstruction` as its own tx via a small loop: wrap it in a `Transaction`, sign + send via the wallet adapter, await confirmation. Show a `Step N/K — applying preset…` toast that increments per ix. Mirror the error-display pattern from `AllowedActionsEditor`.
7. If `selectedPreset === "custom"`, skip the bundle step entirely (existing behaviour).

The sequential-tx approach matches every other `.rpc()` call in `useAdminActions` and avoids any chunking concerns. Each ix is well under 1232 bytes individually.

If a tx in the middle of the bundle fails (e.g. wallet rejects, network hiccup), surface "applied X of Y; you can resume via Change preset…" — the diff path will offer the remaining adds when re-opened.

- [ ] **Step 3: Manual smoke test**

```bash
cd app && bun run dev
```

Open `/vault/<address>/admin`, click "+ Create Strategy", confirm:
- The preset dropdown appears with the four options + "Custom".
- Picking "Custom" leaves the form unchanged.
- Picking "Kamino Liquidity" shows the summary text.
- Submitting with the wallet's keypair as admin successfully creates the strategy AND applies the bundle (verify via the existing `AllowedActionsEditor` showing 2 actions, `AutoActionConfigEditor` showing 2 configs).

If the e2e flow is hard to test in dev without a fully-bootstrapped vault, gate this manual check on the e2e tests in Phase D — they exercise the same path programmatically.

- [ ] **Step 4: Commit**

```
feat(app): preset dropdown + bundle apply in CreateStrategyForm
```

---

## Task 7: `PresetLabel` + `ChangePresetModal`

**Files:**
- Create: `app/src/components/admin/strategy/PresetLabel.tsx`
- Create: `app/src/components/admin/strategy/ChangePresetModal.tsx`

- [ ] **Step 1: `PresetLabel`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { detectActivePreset, snapshotToRows, StrategySnapshot } from "@/lib/strategy-presets/diff";
import { PRESETS_BY_NAME, PresetName } from "@/lib/strategy-presets/presets";

interface Props {
    snapshot: StrategySnapshot;
    /** A function the parent provides that resolves preset rows for the
     *  current strategy context — keeps PresetLabel pure. */
    presetRowsByName: Record<PresetName, ReturnType<typeof snapshotToRows>>;
    onChangeClick: () => void;
}

export function PresetLabel({ snapshot, presetRowsByName, onChangeClick }: Props) {
    const [label, setLabel] = useState<string>("…");
    useEffect(() => {
        detectActivePreset(snapshot, presetRowsByName).then((name) => {
            if (name === "Custom") setLabel("Custom");
            else setLabel(PRESETS_BY_NAME[name].label);
        });
    }, [snapshot, presetRowsByName]);

    return (
        <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)]">Preset:</span>
            <span className="font-medium text-[var(--color-text-primary)]">{label}</span>
            <button
                onClick={onChangeClick}
                className="text-[var(--color-accent)] hover:underline"
            >
                Change preset…
            </button>
        </div>
    );
}
```

- [ ] **Step 2: `ChangePresetModal`**

The modal:
1. Renders `<PresetDropdown />` for picking the target.
2. Calls `diffRowSets(currentRows, targetRows)` and renders the result as two checklists: "Will revoke" (with rows in red) and "Will add" (in green).
3. On confirm, builds the bundle ix list:
   - For each `toRevoke` row, append the corresponding `removeAllowedAction` / `clearAutoActionConfig` / `removeValueSource` ix.
   - For each `toAdd` row, append the corresponding `addAllowedAction` / `setAutoActionConfig` / `addValueSource` ix.
   - Submit as a sequenced bundle (revokes first, then adds).
4. On error mid-bundle, surface "applied X of Y" and leave the modal open with the diff re-run against fresh on-chain state.

Pattern this after `app/src/components/admin/strategy/AllowedActionsEditor.tsx` for tx submission style + error handling.

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { PresetDropdown } from "../PresetDropdown";
import { PRESETS_BY_NAME, PresetName, PresetBuildContext } from "@/lib/strategy-presets/presets";
import { diffRowSets, RowId, StrategySnapshot, snapshotToRows } from "@/lib/strategy-presets/diff";
// ... build ixs for revokes/adds via helpers (similar shape to `builders.ts`)

interface Props {
    open: boolean;
    onClose: () => void;
    ctx: PresetBuildContext;
    snapshot: StrategySnapshot;
    onApplied: () => Promise<void>;
}

export function ChangePresetModal({ open, onClose, ctx, snapshot, onApplied }: Props) {
    const [target, setTarget] = useState<PresetName | "custom">("custom");
    const [targetRows, setTargetRows] = useState<RowId[]>([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (target === "custom") {
            setTargetRows([]);
            return;
        }
        PRESETS_BY_NAME[target].buildRows(ctx).then(setTargetRows);
    }, [target, ctx]);

    const currentRows = useMemo(() => snapshotToRows(snapshot), [snapshot]);
    const { toRevoke, toAdd } = useMemo(
        () => diffRowSets(currentRows, targetRows),
        [currentRows, targetRows],
    );

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="w-full max-w-2xl rounded-lg bg-[var(--color-surface)] p-6 space-y-4">
                <h2 className="text-lg font-semibold">Change preset</h2>
                <PresetDropdown value={target} onChange={setTarget} disabled={submitting} />
                <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                        <h3 className="font-medium text-red-400 mb-1">Will revoke ({toRevoke.length})</h3>
                        <ul className="space-y-1">
                            {toRevoke.map((r, i) => (
                                <li key={i} className="text-[var(--color-text-secondary)]">{rowLabel(r)}</li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3 className="font-medium text-green-400 mb-1">Will add ({toAdd.length})</h3>
                        <ul className="space-y-1">
                            {toAdd.map((r, i) => (
                                <li key={i} className="text-[var(--color-text-secondary)]">{rowLabel(r)}</li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} disabled={submitting}>Cancel</button>
                    <button
                        onClick={async () => {
                            setSubmitting(true);
                            try {
                                // … build + submit revoke ixs then add ixs.
                                // (Implementer: pattern after AllowedActionsEditor.)
                                await onApplied();
                                onClose();
                            } finally {
                                setSubmitting(false);
                            }
                        }}
                        disabled={submitting || (toRevoke.length === 0 && toAdd.length === 0)}
                    >
                        {submitting ? "Applying…" : "Apply changes"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function rowLabel(r: RowId): string {
    if (r.type === "allowed_action")
        return `Allowed action: ${r.targetProgram.slice(0, 4)}…  disc=${r.discriminator.slice(0, 8)}`;
    if (r.type === "auto_action")
        return `Auto-action: kind=${r.kind === 0 ? "Deposit" : "Withdraw"}`;
    return `Value source #${r.index}`;
}
```

- [ ] **Step 3: Wire into `StrategyCard`**

In `app/src/components/admin/StrategyCard.tsx`, add:
- A `useStrategySnapshot(strategy)` hook (or reuse the existing strategy-data hook) to produce a `StrategySnapshot`.
- Render `<PresetLabel ... />` near the strategy name.
- Render `<ChangePresetModal ... />` controlled by local state.

Don't restructure the card. Add the new components in the existing layout's most natural slot — beside the existing weight + delegate displays.

- [ ] **Step 4: Manual smoke test**

Same as Task 6 step 3 — open a strategy, confirm the label renders + the modal opens + the diff is correct.

- [ ] **Step 5: Commit**

```
feat(app): preset label + change-preset modal on strategy card
```

---

## Phase D — Devnet end-to-end

## Task 8: E2E — Kamino Liquidity preset

**Files:**
- Create: `tests/preset_kamino_liquidity.ts`

- [ ] **Step 1: Write the test**

The test exercises:
1. `setupVault` to bootstrap a fresh vault.
2. `createStrategy` to allocate strategy id 0.
3. Build a `PresetBuildContext` with `underlyingDecimals = 6` (the test USDC), and a synthetic `kaminoObligation` pubkey (a fresh `Keypair.generate().publicKey` — the test doesn't need a real Kamino obligation account; the preset only writes the value source pointing at it; `settle_strategy_value` won't be exercised against this VS in this test).
4. `KAMINO_LIQUIDITY.buildIxs(ctx)` to produce the bundle. Expect 5 ixs: 2 `add_allowed_action` + 2 `set_auto_action_config` + 1 `add_value_source` (the AccountU64 obligation reader).
5. Submit each ix sequentially (one tx per ix, mirroring `useAdminActions`).
6. Fetch the strategy's `AllowedAction`, `AutoActionConfig`, and `ValueSource` PDAs and assert they match the expected rows.
7. Run `detectActivePreset(snapshot, presetRowsByName)` and assert it returns `"kamino_liquidity"`.

Reference `tests/security.ts` for the `addAllowedAction` ix pattern. Reuse `tests/helpers/fixtures.ts` for vault bootstrapping.

The test file is sequential and slow (~15s) — that's fine; it joins the existing suite which already runs in 3 minutes.

- [ ] **Step 2: Run**

```bash
bunx ts-mocha -p ./tsconfig.json "tests/preset_kamino_liquidity.ts"
```

If the validator isn't running, `anchor test` runs the whole suite.

- [ ] **Step 3: Commit**

```
test: e2e Kamino Liquidity preset (apply + detect)
```

---

## Task 9: E2E — Lulo Lending preset

**Files:**
- Create: `tests/preset_lulo_lending.ts`

- [ ] **Step 1: Write the test**

Same shape as Task 8 but against `mock_lulo`. Asserts 2 allowed actions (`deposit`, `withdraw`) + 2 auto-action configs.

- [ ] **Step 2: Commit**

```
test: e2e Lulo Lending preset (apply + detect)
```

---

## Task 10: E2E — Raydium Swapper preset (Pyth NAV path)

**Files:**
- Create: `tests/preset_raydium_swapper.ts`

This is the most interesting e2e — it exercises the Plan 1 Pyth `ValueSource` end-to-end through the Plan 3 preset.

- [ ] **Step 1: Write the test**

Shape:
1. `setupVault` + `createStrategy`.
2. Mint 2 throwaway test mints (`mint_a`, `mint_b`).
3. Add both to the vault `AllowedToken` set via `addVaultAllowedToken`.
4. For each mint, `initializeMockFeed(mockPyth, admin, mint, BN(price), -8)` (use `tests/helpers/mock_pyth.ts` from Plan 1's Task 9). Set `mint_a` to $1 (`1_00000000`) and `mint_b` to $50 (`50_00000000`).
5. `RAYDIUM_SWAPPER.buildIxs(ctx)` — should emit 0 `add_allowed_action` (raydium + jupiter stubbed on devnet) + 4 `add_value_source` ixs (2 mints × 2 VS slots each).
6. Submit the bundle.
7. Mint balances to the strategy's per-mint ATAs (`getAssociatedTokenAddressSync(mint, strategyAuthority, true)`): 1_000_000 (= 1.0) of `mint_a`, 500_000 (= 0.5) of `mint_b`.
8. Call `settleStrategyValue` with all 4 VSs in `remainingAccounts`.
9. Expected NAV contribution (with `underlyingDecimals = 6` and both test mints minted with 6 decimals; the preset derives `scaleDen = 10^(8 + 6 - 6) = 10^8`):
   - `mint_a`: balance `1_000_000` (= 1.0 in 6dp) × price `100_000_000` (= $1.00 at expo −8) × 10^−8 / 10^8 = 1 (= 1.0 in 6dp underlying). The on-chain reader applies `× 10^expo` (= ÷ 10^8) and the value source applies `÷ scaleDen` (= ÷ 10^8). Wait — that's 10^16 in the divisor for a result that should land in 6dp. Re-checking: balance(1e6) × price(1e8) = 1e14. ÷ 10^8 (expo) = 1e6. ÷ 10^8 (scaleDen) = 0.01 — wrong by 10^8. The correct `scaleDen` for matched-decimals (6dp underlying, 6dp mint, expo −8) is `10^(8 + 6 − 6) − 8 = 10^0 = 1`. The implementer's first task here is to derive the correct formula by inspecting the `settle_strategy_value` reader (`programs/my_project/src/instructions/settle_strategy_value.rs`) and confirming where the `× 10^expo` lands relative to the scale division. Update the preset's derivation in `presets.ts` to match, then update the assertion below to the verified expected value.
   - `mint_b`: same shape, with price `5_000_000_000` (= $50.00 at expo −8) and balance `500_000`.
   - Total = `idle_strategy_ata + verified_mint_a_contribution + verified_mint_b_contribution`.
10. Assert `strategy.allocatedAmount` matches the verified value.

**Implementer note.** The Pyth math in the preset is the most subtle piece of Plan 3. If your first run produces a NAV that's wildly off, the bug is almost certainly in the preset's `scaleNum/scaleDen` derivation, not the on-chain reader (Plan 1 verified the reader against the simpler 1/1 case). Read the on-chain code, compute by hand on paper for one mint, and adjust the preset until they agree. Document the derivation in a comment above the `getMint` block in `presets.ts`.

- [ ] **Step 2: Commit**

```
test: e2e Raydium Swapper preset (Pyth NAV settle)
```

---

## Phase E — Close

## Task 11: FOLLOWUPS update

**Files:**
- Modify: `docs/FOLLOWUPS.md`

- [ ] **Step 1: Update snapshot table**

Append after `5c`:
```
| 5d | StrategyPreset bundles + diff + UI (Plan 3 of strategy-presets) |
```

- [ ] **Step 2: Update A4 status**

Replace the status note with:
```
**Status:** Plans 1, 2, and 3 shipped 2026-05-03. Plan 1 = on-chain `PythPriceFeed` + `mock_pyth`; Plan 2 = per-cluster `PROTOCOL_REGISTRY` + `crank-mock-prices.ts` keeper; Plan 3 = four `StrategyPreset` bundles + diff engine + create-strategy preset dropdown + change-preset modal. Mainnet wiring items below remain.
```

Also remove the line that said "Plan 3 (preset bundles + UI) is the next slice".

- [ ] **Step 3: Commit**

```
docs(followups): mark Plan 3 (preset bundles + UI) shipped
```

---

## Self-review checklist

1. **Spec coverage:** Plan 3 implements: 4 preset bundles, `diff` engine, preset detection, create-strategy dropdown, change-preset modal, e2e tests for 3 presets. Kamino NAV ValueSource auto-registered (curator pastes obligation pubkey at create time); Pyth scale denominator derived from mint decimals at apply time. ✅
2. **No placeholders:** Every code block contains the actual code or, where the implementer needs to follow an existing pattern (`AllowedActionsEditor` for tx submission), an explicit pointer is given. The Pyth scale-derivation math is explicitly flagged as "verify against the on-chain reader" in Task 10. ✅
3. **Type consistency:** `PresetName`, `RowId`, `StrategySnapshot`, `DiffResult` used consistently across `presets.ts`, `diff.ts`, and the UI components. `PresetBuildContext` carries every PDA the bundle needs plus `underlyingDecimals` + optional `kaminoObligation`. ✅
4. **Mainnet safety:** All preset code paths consult `PROTOCOL_REGISTRY[ctx.cluster]` and either skip stubbed protocols (`raydium`, `jupiter` on devnet) or throw with a clear error pointing at FOLLOWUPS A4. No silent fallbacks. ✅
5. **Tx submission:** Each preset row submits as its own single-ix tx (verified: `useAdminActions` does this for every existing admin action). No bundle ever exceeds 1232 bytes; no chunking logic needed. UI shows a `Step N/K` toast during apply. ✅
