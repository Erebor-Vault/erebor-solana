// vault.ts — Builds execute_strategy_action transactions for the kamino_looper.
//
// Each kamino operation (deposit, withdraw, borrow, repay) becomes one
// execute_strategy_action call wrapped in a transaction. The vault validates
// the action against the AllowedAction whitelist, then CPIs into mock_kamino
// signing as the vault PDA.
//
// Anchor instruction discriminators are computed from sha256("global:<name>")[0..8].

import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionSignature } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { createHash } from "crypto";
import type { MyProject } from "../../../../target/types/my_project.js";
import { findAllowedActionByDiscriminator } from "../../../shared/vault-client.js";
import {
  deriveKaminoObligationPda,
  deriveKaminoOraclePda,
  deriveKaminoReservePda,
  deriveKaminoTreasuryPda,
} from "./kamino.js";

// Asset codes (must match mock_kamino enum order)
export const ASSET_USDC = 0;
export const ASSET_BTC = 1;
export const ASSET_SOL = 2;

export type AssetCode = 0 | 1 | 2;

function anchorDiscriminator(name: string): number[] {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Array.from(hash.subarray(0, 8));
}

export const KAMINO_DEPOSIT_DISCRIMINATOR = anchorDiscriminator("deposit");
export const KAMINO_WITHDRAW_DISCRIMINATOR = anchorDiscriminator("withdraw");
export const KAMINO_BORROW_DISCRIMINATOR = anchorDiscriminator("borrow");
export const KAMINO_REPAY_DISCRIMINATOR = anchorDiscriminator("repay");

// Build the instruction data for a kamino operation:
//   [8-byte discriminator][1-byte asset][8-byte amount LE]
function buildKaminoInstructionData(
  discriminator: number[],
  asset: AssetCode,
  amount: number
): Buffer {
  const buf = Buffer.alloc(17);
  Buffer.from(discriminator).copy(buf, 0);
  buf.writeUInt8(asset, 8);
  new BN(amount).toArrayLike(Buffer, "le", 8).copy(buf, 9);
  return buf;
}

export interface KaminoActionContext {
  vaultProgram: Program<MyProject>;
  agentKeypair: import("@solana/web3.js").Keypair;
  vaultPda: PublicKey;
  strategyPda: PublicKey;
  strategyTokenPda: PublicKey;
  vaultProgramId: PublicKey;
  kaminoProgramId: PublicKey;
  mint: PublicKey;
  asset: AssetCode;
}

// Send a kamino deposit/withdraw/borrow/repay through execute_strategy_action.
// Looks up the AllowedAction PDA matching the discriminator, builds the CPI
// remaining_accounts (matching mock_kamino's expected layout), and submits.
export async function executeKaminoAction(
  ctx: KaminoActionContext,
  discriminator: number[],
  amount: number,
  needsOracle: boolean
): Promise<TransactionSignature> {
  // Find the matching AllowedAction
  const strategy = await ctx.vaultProgram.account.strategyAllocation.fetch(
    ctx.strategyPda
  );
  const found = await findAllowedActionByDiscriminator(
    ctx.vaultProgram,
    ctx.strategyPda,
    (strategy as any).actionCount,
    ctx.kaminoProgramId,
    discriminator,
    ctx.vaultProgramId
  );
  if (!found) {
    throw new Error(
      `No active AllowedAction found for kamino action on program ${ctx.kaminoProgramId.toBase58()}`
    );
  }

  const treasuryPda = deriveKaminoTreasuryPda(ctx.mint, ctx.kaminoProgramId);
  const reservePda = deriveKaminoReservePda(ctx.mint, ctx.kaminoProgramId);
  const obligationPda = deriveKaminoObligationPda(
    ctx.strategyTokenPda,
    ctx.kaminoProgramId
  );

  // Build remaining_accounts matching mock_kamino's Deposit/Withdraw/Borrow/Repay
  // account structs in order:
  //   mint, user_token_account, treasury, reserve, obligation, [oracle], user_authority, token_program
  const remainingAccounts = [
    { pubkey: ctx.mint, isSigner: false, isWritable: false },
    { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
    { pubkey: treasuryPda, isSigner: false, isWritable: true },
    { pubkey: reservePda, isSigner: false, isWritable: true },
    { pubkey: obligationPda, isSigner: false, isWritable: true },
  ];

  // withdraw and borrow need the oracle (HF check)
  if (needsOracle) {
    remainingAccounts.push({
      pubkey: deriveKaminoOraclePda(ctx.kaminoProgramId),
      isSigner: false,
      isWritable: false,
    });
  }

  remainingAccounts.push(
    { pubkey: ctx.vaultPda, isSigner: false, isWritable: false }, // user_authority (vault PDA)
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  );

  const instructionData = buildKaminoInstructionData(discriminator, ctx.asset, amount);

  return await ctx.vaultProgram.methods
    .executeStrategyAction(instructionData)
    .accountsStrict({
      caller: ctx.agentKeypair.publicKey,
      vaultState: ctx.vaultPda,
      strategy: ctx.strategyPda,
      allowedAction: found.pda,
      targetProgram: ctx.kaminoProgramId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([ctx.agentKeypair])
    .rpc();
}

export async function kaminoDeposit(
  ctx: KaminoActionContext,
  amount: number
): Promise<TransactionSignature> {
  return executeKaminoAction(ctx, KAMINO_DEPOSIT_DISCRIMINATOR, amount, false);
}

export async function kaminoWithdraw(
  ctx: KaminoActionContext,
  amount: number
): Promise<TransactionSignature> {
  return executeKaminoAction(ctx, KAMINO_WITHDRAW_DISCRIMINATOR, amount, true);
}

export async function kaminoBorrow(
  ctx: KaminoActionContext,
  amount: number
): Promise<TransactionSignature> {
  return executeKaminoAction(ctx, KAMINO_BORROW_DISCRIMINATOR, amount, true);
}

export async function kaminoRepay(
  ctx: KaminoActionContext,
  amount: number
): Promise<TransactionSignature> {
  return executeKaminoAction(ctx, KAMINO_REPAY_DISCRIMINATOR, amount, false);
}
