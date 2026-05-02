/**
 * unwind-kamino-position.ts — Force-close a kamino_looper strategy's
 * leveraged position via the same execute_action path the agent uses.
 *
 * Sequence (mirrors closeUsdcLoop in agent/kamino_looper):
 *   - If borrowed > 0:
 *       1. ctoken_for_repay = ceil(borrowed × ctoken_supply / total_liquidity) + 1
 *       2. withdraw(ctoken_for_repay)   — turns cTokens into liquidity in strategy ATA
 *       3. repay(borrowed)              — pays the obligation
 *       4. withdraw(remaining_ctokens)  — sweep the rest
 *   - If borrowed == 0:
 *       1. withdraw(ctoken_balance)     — single sweep
 *
 * Signed by the agent's delegate keypair (same one used by the running
 * kamino_looper). Uses the exact 9-account top-level set + 8/9-account
 * remaining_accounts that agent/kamino_looper builds, with strategy_authority
 * acting as the inner-CPI signer.
 *
 * Usage:
 *   bun scripts/unwind-kamino-position.ts \
 *     --delegate ./agent_keypair.json \
 *     --mint <USDC> \
 *     --strategy-id 1
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Connection } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import { createHash } from "crypto";

// =============================================================================
// CONSTANTS — must match agent/kamino_looper/src/chain/vault.ts
// =============================================================================

const KAMINO_DEPOSIT_IX = "deposit_reserve_liquidity_and_obligation_collateral";
const KAMINO_WITHDRAW_IX = "withdraw_obligation_collateral_and_redeem_reserve_collateral";
const KAMINO_BORROW_IX = "borrow_obligation_liquidity";
const KAMINO_REPAY_IX = "repay_obligation_liquidity";

// =============================================================================
// HELPERS
// =============================================================================

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

interface ReserveData {
  totalLiquidity: BN;
  totalCollateralSupply: BN;
}

async function readReserve(
  connection: Connection,
  reservePda: PublicKey
): Promise<ReserveData | null> {
  const info = await connection.getAccountInfo(reservePda);
  if (!info || info.data.length < 152) return null;
  return {
    totalLiquidity: new BN(info.data.subarray(8 + 128, 8 + 136), "le"),
    totalCollateralSupply: new BN(info.data.subarray(8 + 136, 8 + 144), "le"),
  };
}

async function readObligationDebt(
  connection: Connection,
  obligationPda: PublicKey
): Promise<BN> {
  const info = await connection.getAccountInfo(obligationPda);
  if (!info || info.data.length < 80) return new BN(0);
  return new BN(info.data.subarray(8 + 64, 8 + 72), "le");
}

async function readTokenBalance(connection: Connection, ata: PublicKey): Promise<BN> {
  const info = await connection.getAccountInfo(ata);
  if (!info || info.data.length < 72) return new BN(0);
  return new BN(info.data.subarray(64, 72), "le");
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let delegatePath = "";
  let mintAddress = "";
  let vaultId = 0;
  let strategyId = 1;
  let rpcUrl = "https://api.devnet.solana.com";
  let walletPath = "./id.json";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--delegate":     delegatePath = args[++i]; break;
      case "--mint":         mintAddress = args[++i]; break;
      case "--vault-id":     vaultId = Number(args[++i]); break;
      case "--strategy-id":  strategyId = Number(args[++i]); break;
      case "--rpc":          rpcUrl = args[++i]; break;
      case "--wallet":       walletPath = args[++i]; break;
    }
  }

  if (!delegatePath || !mintAddress) {
    console.error("Error: --delegate and --mint are required");
    process.exit(1);
  }
  return { delegatePath, mintAddress, vaultId, strategyId, rpcUrl, walletPath };
}

// =============================================================================
// EXECUTE_ACTION BUILDER
// =============================================================================

interface UnwindContext {
  vaultProgram: Program<MyProject>;
  kaminoProgramId: PublicKey;
  delegate: Keypair;
  vaultPda: PublicKey;
  strategyPda: PublicKey;
  strategyAuthorityPda: PublicKey;
  strategyTokenPda: PublicKey;
  strategyCollateralAta: PublicKey;
  obligationPda: PublicKey;
  reservePda: PublicKey;
  collateralMintPda: PublicKey;
  liquiditySupplyAta: PublicKey;
  liquidityMint: PublicKey;
  agentTokenAta: PublicKey;
  strategyId: number;
}

async function executeAction(
  ctx: UnwindContext,
  ixName: string,
  ixData: Buffer,
  remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
): Promise<string> {
  const disc = anchorDiscriminator(ixName);
  const [allowedActionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_action"),
      ctx.strategyPda.toBuffer(),
      ctx.kaminoProgramId.toBuffer(),
      disc,
    ],
    ctx.vaultProgram.programId
  );

  return ctx.vaultProgram.methods
    .executeAction(
      new BN(ctx.strategyId),
      ctx.kaminoProgramId,
      Array.from(disc) as any,
      ixData
    )
    .accountsStrict({
      caller: ctx.delegate.publicKey,
      vaultState: ctx.vaultPda,
      strategy: ctx.strategyPda,
      strategyAuthority: ctx.strategyAuthorityPda,
      allowedAction: allowedActionPda,
      callerTokenAta: ctx.agentTokenAta,
      delegateTokenAta: ctx.agentTokenAta,
      targetProgramAccount: ctx.kaminoProgramId,
      allowedOutputToken: SystemProgram.programId,
      vaultAllowedOutputToken: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .remainingAccounts(remainingAccounts)
    .signers([ctx.delegate])
    .rpc();
}

function withdrawAccounts(ctx: UnwindContext) {
  // recipient_index = 1 → strategy ATA at slot 1.
  return [
    { pubkey: ctx.strategyCollateralAta, isSigner: false, isWritable: true },
    { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
    { pubkey: ctx.reservePda, isSigner: false, isWritable: true },
    { pubkey: ctx.liquidityMint, isSigner: false, isWritable: false },
    { pubkey: ctx.collateralMintPda, isSigner: false, isWritable: true },
    { pubkey: ctx.liquiditySupplyAta, isSigner: false, isWritable: true },
    { pubkey: ctx.strategyAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

function repayAccounts(ctx: UnwindContext) {
  // recipient_index = 4 → strategy ATA at slot 4 (source_liquidity).
  return [
    { pubkey: ctx.obligationPda, isSigner: false, isWritable: true },
    { pubkey: ctx.reservePda, isSigner: false, isWritable: true },
    { pubkey: ctx.liquidityMint, isSigner: false, isWritable: false },
    { pubkey: ctx.liquiditySupplyAta, isSigner: false, isWritable: true },
    { pubkey: ctx.strategyTokenPda, isSigner: false, isWritable: true },
    { pubkey: ctx.strategyAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

function encodeAmount(amount: BN): Buffer {
  return amount.toArrayLike(Buffer, "le", 8);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const opts = parseArgs();

  const connection = new Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const delegate = loadKeypair(opts.delegatePath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const liquidityMint = new PublicKey(opts.mintAddress);

  // Derive kamino program id from the IDL on disk to avoid drift after
  // anchor keys sync.
  const kaminoIdl = JSON.parse(fs.readFileSync("./target/idl/mock_kamino.json", "utf-8"));
  const kaminoProgramId = new PublicKey(kaminoIdl.address);

  console.log("\n=== Kamino Position Unwind ===\n");
  console.log(`Delegate:       ${delegate.publicKey.toBase58()}`);
  console.log(`Vault program:  ${vaultProgram.programId.toBase58()}`);
  console.log(`Kamino program: ${kaminoProgramId.toBase58()}`);
  console.log(`Mint:           ${liquidityMint.toBase58()}`);
  console.log(`Strategy:       ${opts.strategyId}\n`);

  // ── Derive all PDAs ─────────────────────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), liquidityMint.toBuffer(), new BN(opts.vaultId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [reservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), liquidityMint.toBuffer()],
    kaminoProgramId
  );
  const [collateralMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), liquidityMint.toBuffer()],
    kaminoProgramId
  );
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), reservePda.toBuffer(), strategyAuthorityPda.toBuffer()],
    kaminoProgramId
  );
  const liquiditySupplyAta = getAssociatedTokenAddressSync(liquidityMint, reservePda, true);
  const strategyCollateralAta = getAssociatedTokenAddressSync(collateralMintPda, strategyAuthorityPda, true);
  const agentTokenAta = getAssociatedTokenAddressSync(liquidityMint, delegate.publicKey);

  // ── Read current state ──────────────────────────────────────────────
  const [reserve, borrowed, ctokenBalance] = await Promise.all([
    readReserve(connection, reservePda),
    readObligationDebt(connection, obligationPda),
    readTokenBalance(connection, strategyCollateralAta),
  ]);

  if (!reserve) {
    console.log("Reserve NOT initialized — nothing to unwind.");
    return;
  }

  const suppliedLiquidity = reserve.totalCollateralSupply.isZero()
    ? new BN(0)
    : ctokenBalance.mul(reserve.totalLiquidity).div(reserve.totalCollateralSupply);
  console.log(
    `Current state: ctoken=${ctokenBalance.toString()} (${(Number(suppliedLiquidity) / 1e6).toFixed(2)} USDC supplied), borrowed=${(Number(borrowed) / 1e6).toFixed(2)} USDC`
  );

  if (ctokenBalance.isZero() && borrowed.isZero()) {
    console.log("Position is already empty.");
    return;
  }

  const ctx: UnwindContext = {
    vaultProgram,
    kaminoProgramId,
    delegate,
    vaultPda,
    strategyPda,
    strategyAuthorityPda,
    strategyTokenPda,
    strategyCollateralAta,
    obligationPda,
    reservePda,
    collateralMintPda,
    liquiditySupplyAta,
    liquidityMint,
    agentTokenAta,
    strategyId: opts.strategyId,
  };

  let remainingCtokens = ctokenBalance;

  // ── Step 1: cover repay (only when there's outstanding debt) ────────
  if (!borrowed.isZero() && !reserve.totalLiquidity.isZero() && !reserve.totalCollateralSupply.isZero()) {
    // ctoken_for_repay = ceil(borrowed × ctoken_supply / total_liquidity) + 1
    const ctokenForRepay = borrowed
      .mul(reserve.totalCollateralSupply)
      .add(reserve.totalLiquidity.subn(1))
      .div(reserve.totalLiquidity)
      .addn(1);
    const ctokenToWithdraw = BN.min(ctokenForRepay, remainingCtokens);

    console.log(
      `\n1. Withdrawing ${ctokenToWithdraw.toString()} cTokens (≈${(Number(borrowed) / 1e6).toFixed(2)} USDC) for repay…`
    );
    const sig1 = await executeAction(ctx, KAMINO_WITHDRAW_IX, encodeAmount(ctokenToWithdraw), withdrawAccounts(ctx));
    console.log(`   tx: ${sig1}`);
    remainingCtokens = remainingCtokens.sub(ctokenToWithdraw);

    console.log(`2. Repaying ${(Number(borrowed) / 1e6).toFixed(2)} USDC…`);
    const sig2 = await executeAction(ctx, KAMINO_REPAY_IX, encodeAmount(borrowed), repayAccounts(ctx));
    console.log(`   tx: ${sig2}`);
  }

  // ── Step 2: sweep remaining cTokens ─────────────────────────────────
  if (!remainingCtokens.isZero()) {
    console.log(`\n3. Withdrawing remaining ${remainingCtokens.toString()} cTokens…`);
    const sig3 = await executeAction(ctx, KAMINO_WITHDRAW_IX, encodeAmount(remainingCtokens), withdrawAccounts(ctx));
    console.log(`   tx: ${sig3}`);
  }

  // ── Verify ──────────────────────────────────────────────────────────
  const [borrowedAfter, ctokenAfter, idleAfter] = await Promise.all([
    readObligationDebt(connection, obligationPda),
    readTokenBalance(connection, strategyCollateralAta),
    readTokenBalance(connection, strategyTokenPda),
  ]);
  console.log(
    `\nFinal state: ctoken=${ctokenAfter.toString()}, borrowed=${(Number(borrowedAfter) / 1e6).toFixed(2)} USDC, idle=${(Number(idleAfter) / 1e6).toFixed(2)} USDC`
  );
  if (ctokenAfter.isZero() && borrowedAfter.isZero()) {
    console.log("Loop unwound cleanly. Funds are now in the strategy ATA — authority can deallocate to reserve.");
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
