// vault.ts — Builds execute_action transactions for the kamino_looper.
//
// Each kamino operation (deposit/withdraw/borrow/repay) becomes one
// execute_action call wrapped in a transaction. The vault validates the
// (strategy, target_program, discriminator) triple against an on-chain
// AllowedAction PDA, signs the inner CPI as strategy_authority[i], and
// runs the anti-theft snapshot on caller's + delegate's underlying ATAs.
//
// Discriminator naming: must match Anchor's sha256("global:<method>")[..8]
// for the OLD_Erebor mock_kamino instruction names. add_allowed_action must
// have been called with the same (target_program, discriminator) tuples
// before any of these helpers will succeed — see scripts/setup-kamino-strategy.ts.

import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionSignature,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { createHash } from "crypto";
import type { MyProject } from "../../../../target/types/my_project.js";
import { deriveAllowedActionPda } from "../../../shared/vault-client.js";
import {
  deriveKaminoCollateralMintPda,
  deriveKaminoObligationPda,
  deriveKaminoReservePda,
} from "./kamino.js";

// =============================================================================
// DISCRIMINATORS
// =============================================================================

export function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

// OLD_Erebor mock_kamino instruction names. Must match the Anchor handlers
// exactly — change here breaks the AllowedAction PDA seeds.
export const KAMINO_DEPOSIT_IX_NAME =
  "deposit_reserve_liquidity_and_obligation_collateral";
export const KAMINO_WITHDRAW_IX_NAME =
  "withdraw_obligation_collateral_and_redeem_reserve_collateral";
export const KAMINO_BORROW_IX_NAME = "borrow_obligation_liquidity";
export const KAMINO_REPAY_IX_NAME = "repay_obligation_liquidity";

export const KAMINO_DEPOSIT_DISCRIMINATOR = anchorDiscriminator(
  KAMINO_DEPOSIT_IX_NAME
);
export const KAMINO_WITHDRAW_DISCRIMINATOR = anchorDiscriminator(
  KAMINO_WITHDRAW_IX_NAME
);
export const KAMINO_BORROW_DISCRIMINATOR =
  anchorDiscriminator(KAMINO_BORROW_IX_NAME);
export const KAMINO_REPAY_DISCRIMINATOR =
  anchorDiscriminator(KAMINO_REPAY_IX_NAME);

// =============================================================================
// CONTEXT
// =============================================================================

export interface KaminoActionContext {
  vaultProgram: Program<MyProject>;
  agentKeypair: Keypair;
  vaultPda: PublicKey;
  strategyPda: PublicKey;
  strategyTokenPda: PublicKey;          // strategy's underlying ATA
  strategyAuthorityPda: PublicKey;      // signs the inner CPI
  vaultProgramId: PublicKey;
  kaminoProgramId: PublicKey;
  liquidityMint: PublicKey;             // vault's underlying mint (e.g. USDC)
  strategyId: number;
  // Caller's + delegate's underlying ATAs — both are anti-theft snapshot
  // points. When agent == delegate (the common case), both equal the agent's
  // own ATA. Both must already exist on-chain; setup script creates the
  // agent's USDC ATA before the agent first runs.
  callerTokenAta: PublicKey;
  delegateTokenAta: PublicKey;
}

// =============================================================================
// CORE BUILDER
// =============================================================================

interface ExecuteActionArgs {
  ctx: KaminoActionContext;
  discriminator: Buffer;
  ixData: Buffer;                              // body only — no discriminator prefix
  remainingAccounts: {
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }[];
}

async function executeKaminoAction(
  args: ExecuteActionArgs
): Promise<TransactionSignature> {
  const { ctx, discriminator, ixData, remainingAccounts } = args;

  const allowedActionPda = deriveAllowedActionPda(
    ctx.strategyPda,
    ctx.kaminoProgramId,
    discriminator,
    ctx.vaultProgramId
  );

  return await ctx.vaultProgram.methods
    .executeAction(
      new BN(ctx.strategyId),
      ctx.kaminoProgramId,
      Array.from(discriminator) as any,
      ixData
    )
    .accountsStrict({
      caller: ctx.agentKeypair.publicKey,
      vaultState: ctx.vaultPda,
      strategy: ctx.strategyPda,
      strategyAuthority: ctx.strategyAuthorityPda,
      allowedAction: allowedActionPda,
      callerTokenAta: ctx.callerTokenAta,
      delegateTokenAta: ctx.delegateTokenAta,
      targetProgramAccount: ctx.kaminoProgramId,
      // output_mint_index is None for all kamino actions, so the vault
      // doesn't read this account. Pass any program-owned account as a
      // placeholder per the Anchor IDL's allowance.
      allowedOutputToken: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .remainingAccounts(remainingAccounts)
    .signers([ctx.agentKeypair])
    .rpc();
}

// =============================================================================
// PER-ACTION HELPERS
// =============================================================================

// Pack a single u64 amount little-endian as the ix_data body.
function encodeAmount(amount: number | BN): Buffer {
  return new BN(amount).toArrayLike(Buffer, "le", 8);
}

// Build the ATAs and reserve PDAs that all four kamino actions share.
function buildSharedAccounts(ctx: KaminoActionContext) {
  const reservePda = deriveKaminoReservePda(ctx.liquidityMint, ctx.kaminoProgramId);
  const collateralMint = deriveKaminoCollateralMintPda(
    ctx.liquidityMint,
    ctx.kaminoProgramId
  );
  const liquiditySupplyAta = getAssociatedTokenAddressSync(
    ctx.liquidityMint,
    reservePda,
    true // allowOwnerOffCurve — reserve PDA is off-curve
  );
  const strategyCollateralAta = getAssociatedTokenAddressSync(
    collateralMint,
    ctx.strategyAuthorityPda,
    true
  );
  return { reservePda, collateralMint, liquiditySupplyAta, strategyCollateralAta };
}

// deposit_reserve_liquidity_and_obligation_collateral
//
//   remaining_accounts (recipient_index = 0):
//     0  source_liquidity (mut)        = strategy ATA
//     1  destination_collateral (mut)  = strategy cToken ATA
//     2  reserve (mut)
//     3  liquidity_mint
//     4  collateral_mint (mut)
//     5  liquidity_supply (mut)
//     6  user_transfer_authority       = strategy_authority (marked signer by execute_action)
//     7  token_program
export async function kaminoDeposit(
  ctx: KaminoActionContext,
  amount: number | BN
): Promise<TransactionSignature> {
  const sa = buildSharedAccounts(ctx);
  return executeKaminoAction({
    ctx,
    discriminator: KAMINO_DEPOSIT_DISCRIMINATOR,
    ixData: encodeAmount(amount),
    remainingAccounts: [
      { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
      { pubkey: sa.strategyCollateralAta, isSigner: false, isWritable: true },
      { pubkey: sa.reservePda, isSigner: false, isWritable: true },
      { pubkey: ctx.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: sa.collateralMint, isSigner: false, isWritable: true },
      { pubkey: sa.liquiditySupplyAta, isSigner: false, isWritable: true },
      { pubkey: ctx.strategyAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

// withdraw_obligation_collateral_and_redeem_reserve_collateral
//
// `amount` here is the cToken (collateral) amount to burn. The mock_kamino
// handler returns the corresponding liquidity at the current redemption rate.
//
//   remaining_accounts (recipient_index = 1):
//     0  source_collateral (mut)       = strategy cToken ATA
//     1  destination_liquidity (mut)   = strategy ATA
//     2  reserve (mut)
//     3  liquidity_mint
//     4  collateral_mint (mut)
//     5  liquidity_supply (mut)
//     6  user_transfer_authority       = strategy_authority
//     7  token_program
export async function kaminoWithdraw(
  ctx: KaminoActionContext,
  collateralAmount: number | BN
): Promise<TransactionSignature> {
  const sa = buildSharedAccounts(ctx);
  return executeKaminoAction({
    ctx,
    discriminator: KAMINO_WITHDRAW_DISCRIMINATOR,
    ixData: encodeAmount(collateralAmount),
    remainingAccounts: [
      { pubkey: sa.strategyCollateralAta, isSigner: false, isWritable: true },
      { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
      { pubkey: sa.reservePda, isSigner: false, isWritable: true },
      { pubkey: ctx.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: sa.collateralMint, isSigner: false, isWritable: true },
      { pubkey: sa.liquiditySupplyAta, isSigner: false, isWritable: true },
      { pubkey: ctx.strategyAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

// borrow_obligation_liquidity
//
//   remaining_accounts (recipient_index = 4):
//     0  obligation (mut)              = ["obligation", reserve, strategy_authority]
//     1  reserve (mut)
//     2  liquidity_mint
//     3  liquidity_supply (mut)
//     4  destination_liquidity (mut)   = strategy ATA
//     5  collateral_mint
//     6  collateral_token_account      = strategy cToken ATA (read for HF check)
//     7  owner                         = strategy_authority (signer)
//     8  token_program
export async function kaminoBorrow(
  ctx: KaminoActionContext,
  amount: number | BN
): Promise<TransactionSignature> {
  const sa = buildSharedAccounts(ctx);
  const obligationPda = deriveKaminoObligationPda(
    sa.reservePda,
    ctx.strategyAuthorityPda,
    ctx.kaminoProgramId
  );
  return executeKaminoAction({
    ctx,
    discriminator: KAMINO_BORROW_DISCRIMINATOR,
    ixData: encodeAmount(amount),
    remainingAccounts: [
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: sa.reservePda, isSigner: false, isWritable: true },
      { pubkey: ctx.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: sa.liquiditySupplyAta, isSigner: false, isWritable: true },
      { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
      { pubkey: sa.collateralMint, isSigner: false, isWritable: false },
      { pubkey: sa.strategyCollateralAta, isSigner: false, isWritable: false },
      { pubkey: ctx.strategyAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

// repay_obligation_liquidity
//
//   remaining_accounts (recipient_index = 4):
//     0  obligation (mut)
//     1  reserve (mut)
//     2  liquidity_mint
//     3  liquidity_supply (mut)
//     4  source_liquidity (mut)        = strategy ATA
//     5  user_transfer_authority       = strategy_authority (signer)
//     6  token_program
export async function kaminoRepay(
  ctx: KaminoActionContext,
  amount: number | BN
): Promise<TransactionSignature> {
  const sa = buildSharedAccounts(ctx);
  const obligationPda = deriveKaminoObligationPda(
    sa.reservePda,
    ctx.strategyAuthorityPda,
    ctx.kaminoProgramId
  );
  return executeKaminoAction({
    ctx,
    discriminator: KAMINO_REPAY_DISCRIMINATOR,
    ixData: encodeAmount(amount),
    remainingAccounts: [
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: sa.reservePda, isSigner: false, isWritable: true },
      { pubkey: ctx.liquidityMint, isSigner: false, isWritable: false },
      { pubkey: sa.liquiditySupplyAta, isSigner: false, isWritable: true },
      { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
      { pubkey: ctx.strategyAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

// =============================================================================
// SHARED-ACCOUNT EXPORTS (used by tests + setup scripts)
// =============================================================================

// Recipient indices for the four actions — must match what
// add_allowed_action(...) is called with during setup. Off-by-one here means
// every execute_action call reverts with RecipientMismatch.
export const KAMINO_RECIPIENT_INDEX = {
  deposit: 0,                       // source_liquidity = strategy ATA
  withdraw: 1,                      // destination_liquidity = strategy ATA
  borrow: 4,                        // destination_liquidity = strategy ATA
  repay: 4,                         // source_liquidity = strategy ATA
} as const;
