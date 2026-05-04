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
