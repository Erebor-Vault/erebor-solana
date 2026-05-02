/**
 * setup-kamino-strategy.ts — Full setup for the kamino_looper agent on the
 * OLD_Erebor account model.
 *
 * Steps:
 *   1. Resolve the underlying mint (USDC test mint) — reuse existing or create
 *   2. Initialize the Erebor vault for that mint (or reuse)
 *   3. Initialize mock_kamino's reserve for the mint (single-mint, cToken model)
 *   4. Create a strategy with the kamino_looper agent keypair as delegate
 *   5. Initialize the obligation PDA at ["obligation", reserve, strategy_authority]
 *   6. Whitelist mock_kamino's 4 actions with the correct
 *      expected_recipient_index per agent/kamino_looper:
 *          deposit_reserve_liquidity_and_obligation_collateral → 0
 *          withdraw_obligation_collateral_and_redeem_reserve_collateral → 1
 *          borrow_obligation_liquidity → 4
 *          repay_obligation_liquidity → 4
 *   7. Create the agent's underlying ATA (caller_token_ata + delegate_token_ata
 *      anti-theft snapshot points; both equal the agent's USDC ATA)
 *   8. Mint test USDC, deposit into vault, allocate to the strategy
 *   9. Print agent .env values
 *
 * Usage:
 *   bun scripts/setup-kamino-strategy.ts --delegate ./agent_keypair.json
 *
 * Default amounts (override via flags):
 *   --weight 5000           50% of vault → strategy
 *   --deposit 100000000     100 USDC test funds
 *   --allocate 50000000     50 USDC allocated to the strategy
 *
 * Optional:
 *   --mint <USDC>           Reuse an existing USDC mint (default: create new)
 *   --vault-id <N>          Default 0 (shared vault for lulo + kamino)
 *
 * The script is idempotent: if the reserve / vault / strategy / obligation
 * already exist, it skips re-initialization.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { MockKamino } from "../target/types/mock_kamino";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import bs58 from "bs58";
import { createHash } from "crypto";

// =============================================================================
// CONSTANTS — must match agent/kamino_looper/src/chain/vault.ts
// =============================================================================

const KAMINO_DEPOSIT_IX = "deposit_reserve_liquidity_and_obligation_collateral";
const KAMINO_WITHDRAW_IX = "withdraw_obligation_collateral_and_redeem_reserve_collateral";
const KAMINO_BORROW_IX = "borrow_obligation_liquidity";
const KAMINO_REPAY_IX = "repay_obligation_liquidity";

// remaining_accounts slot of `strategy.token_account` per action. Off-by-one
// here means every execute_action call reverts with RecipientMismatch.
const KAMINO_RECIPIENT_INDEX = {
  [KAMINO_DEPOSIT_IX]: 0,
  [KAMINO_WITHDRAW_IX]: 1,
  [KAMINO_BORROW_IX]: 4,
  [KAMINO_REPAY_IX]: 4,
} as const;

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

async function accountExists(connection: anchor.web3.Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let delegatePath = "";
  let weightBps = 5000;
  let depositAmount = 100_000_000;
  let allocateAmount = 50_000_000;
  let rpcUrl = "https://api.devnet.solana.com";
  let walletPath = "./id.json";
  let mintArg = "";
  let vaultId = 0;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--delegate": delegatePath = args[++i]; break;
      case "--weight":   weightBps = Number(args[++i]); break;
      case "--deposit":  depositAmount = Number(args[++i]); break;
      case "--allocate": allocateAmount = Number(args[++i]); break;
      case "--rpc":      rpcUrl = args[++i]; break;
      case "--wallet":   walletPath = args[++i]; break;
      case "--mint":     mintArg = args[++i]; break;
      case "--vault-id": vaultId = Number(args[++i]); break;
    }
  }

  if (!delegatePath) {
    console.error("Error: --delegate is required");
    process.exit(1);
  }
  return { delegatePath, weightBps, depositAmount, allocateAmount, rpcUrl, walletPath, mintArg, vaultId };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const opts = parseArgs();

  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const delegateKeypair = loadKeypair(opts.delegatePath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const kaminoProgram = anchor.workspace.mockKamino as Program<MockKamino>;

  console.log("\n=== Erebor Kamino Looper Setup ===\n");
  console.log(`Deployer:      ${payer.publicKey.toBase58()}`);
  console.log(`Agent:         ${delegateKeypair.publicKey.toBase58()}`);
  console.log(`Vault Program: ${vaultProgram.programId.toBase58()}`);
  console.log(`Kamino:        ${kaminoProgram.programId.toBase58()}\n`);

  // ── Step 1: Resolve mint ──────────────────────────────────────────────
  console.log("1. Resolving USDC mint...");
  const usdcMint = opts.mintArg
    ? new PublicKey(opts.mintArg)
    : await createMint(connection, payer, payer.publicKey, null, 6);
  console.log(`   USDC: ${usdcMint.toBase58()}${opts.mintArg ? " (reused)" : " (new)"}\n`);

  // ── Step 2: Initialize Erebor vault ───────────────────────────────────
  console.log(`2. Initializing Erebor vault (vault_id=${opts.vaultId})...`);
  const vaultId = new BN(opts.vaultId);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), usdcMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()],
    vaultProgram.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    vaultProgram.programId
  );
  const reserveAta = getAssociatedTokenAddressSync(usdcMint, vaultAuthorityPda, true);

  if (await accountExists(connection, vaultPda)) {
    console.log(`   Vault already exists at ${vaultPda.toBase58()} (reusing)`);
  } else {
    await vaultProgram.methods
      .initializeVault(vaultId)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        tokenMint: usdcMint,
        shareMint: shareMintPda,
        reserveAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`   Vault PDA: ${vaultPda.toBase58()}`);
  }
  console.log();

  // ── Step 3: Initialize mock_kamino reserve ────────────────────────────
  console.log("3. Initializing mock_kamino reserve...");
  const [reservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), usdcMint.toBuffer()],
    kaminoProgram.programId
  );
  const [collateralMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), usdcMint.toBuffer()],
    kaminoProgram.programId
  );
  const liquiditySupplyAta = getAssociatedTokenAddressSync(usdcMint, reservePda, true);

  if (await accountExists(connection, reservePda)) {
    console.log(`   Reserve already exists at ${reservePda.toBase58()} (reusing)`);
  } else {
    await kaminoProgram.methods
      .initReserve()
      .accountsStrict({
        admin: payer.publicKey,
        liquidityMint: usdcMint,
        reserve: reservePda,
        collateralMint: collateralMintPda,
        liquiditySupply: liquiditySupplyAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`   Reserve: ${reservePda.toBase58()}`);
    console.log(`   Collateral mint: ${collateralMintPda.toBase58()}`);

    // Seed the reserve so borrows have liquidity to draw from.
    await mintTo(connection, payer, usdcMint, liquiditySupplyAta, payer, 1_000_000_000);
    console.log(`   Liquidity supply seeded with 1000 USDC`);
  }
  console.log();

  // ── Step 4: Create strategy ───────────────────────────────────────────
  const vaultState = await vaultProgram.account.vaultState.fetch(vaultPda);
  const strategyIndex = vaultState.strategyCount.toNumber();
  console.log(`4. Creating strategy #${strategyIndex} with kamino_looper as delegate...`);
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );

  if (await accountExists(connection, strategyPda)) {
    console.log(`   Strategy already exists at ${strategyPda.toBase58()} (reusing)`);
  } else {
    // Pass existing active strategy PDAs in remaining_accounts so the
    // dedupe loop can reject delegate collisions (audit #10).
    const existingStrategyMetas = [];
    for (let j = 0; j < strategyIndex; j++) {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(j).toArrayLike(Buffer, "le", 8)],
        vaultProgram.programId
      );
      existingStrategyMetas.push({ pubkey: pda, isSigner: false, isWritable: false });
    }

    await vaultProgram.methods
      .createStrategy()
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
        strategyAuthority: strategyAuthorityPda,
        tokenMint: usdcMint,
        strategyTokenAccount: strategyTokenPda,
        delegate: delegateKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(existingStrategyMetas)
      .rpc();
    console.log(`   Strategy PDA: ${strategyPda.toBase58()}`);
    console.log(`   Strategy authority: ${strategyAuthorityPda.toBase58()}`);
    console.log(`   Strategy token: ${strategyTokenPda.toBase58()}`);

    await vaultProgram.methods
      .setStrategyWeight(opts.weightBps)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
      })
      .rpc();
    console.log(`   Weight: ${opts.weightBps / 100}%`);
  }
  console.log();

  // ── Step 5: Initialize the obligation ─────────────────────────────────
  console.log("5. Initializing kamino obligation...");
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), reservePda.toBuffer(), strategyAuthorityPda.toBuffer()],
    kaminoProgram.programId
  );
  if (await accountExists(connection, obligationPda)) {
    console.log(`   Obligation already exists at ${obligationPda.toBase58()} (reusing)`);
  } else {
    await kaminoProgram.methods
      .initObligation()
      .accountsStrict({
        payer: payer.publicKey,
        reserve: reservePda,
        owner: strategyAuthorityPda,
        obligation: obligationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   Obligation PDA: ${obligationPda.toBase58()}`);
  }

  // Create the strategy's cToken ATA — owned by strategy_authority (off-curve).
  // mock_kamino's deposit handler mints cTokens here; if the ATA doesn't exist,
  // mint_to fails with "Attempt to debit an account but found no record of a
  // prior credit". The high-level createAssociatedTokenAccount helper rejects
  // off-curve owners, so we build the ix manually.
  const strategyCollateralAta = getAssociatedTokenAddressSync(
    collateralMintPda,
    strategyAuthorityPda,
    true
  );
  if (await accountExists(connection, strategyCollateralAta)) {
    console.log(`   Strategy cToken ATA already exists at ${strategyCollateralAta.toBase58()}`);
  } else {
    const ataIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      strategyCollateralAta,
      strategyAuthorityPda,
      collateralMintPda
    );
    await sendAndConfirmTransaction(connection, new Transaction().add(ataIx), [payer]);
    console.log(`   Strategy cToken ATA: ${strategyCollateralAta.toBase58()}`);
  }
  console.log();

  // ── Step 6: Whitelist 4 mock_kamino actions ───────────────────────────
  console.log("6. Whitelisting mock_kamino actions...");
  const actions = [
    { name: KAMINO_DEPOSIT_IX,  recipientIndex: KAMINO_RECIPIENT_INDEX[KAMINO_DEPOSIT_IX] },
    { name: KAMINO_WITHDRAW_IX, recipientIndex: KAMINO_RECIPIENT_INDEX[KAMINO_WITHDRAW_IX] },
    { name: KAMINO_BORROW_IX,   recipientIndex: KAMINO_RECIPIENT_INDEX[KAMINO_BORROW_IX] },
    { name: KAMINO_REPAY_IX,    recipientIndex: KAMINO_RECIPIENT_INDEX[KAMINO_REPAY_IX] },
  ];
  for (const action of actions) {
    const disc = anchorDiscriminator(action.name);
    const [actionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_action"),
        strategyPda.toBuffer(),
        kaminoProgram.programId.toBuffer(),
        disc,
      ],
      vaultProgram.programId
    );
    if (await accountExists(connection, actionPda)) {
      console.log(`   ${action.name.slice(0, 30)}… already whitelisted (reusing)`);
      continue;
    }
    await vaultProgram.methods
      .addAllowedAction(
        new BN(strategyIndex),
        kaminoProgram.programId,
        Array.from(disc) as any,
        action.recipientIndex,
        null,
        0,
        0
      )
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
        allowedAction: actionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   ${action.name.slice(0, 30)}… (recipient_index=${action.recipientIndex})`);
  }
  console.log();

  // ── Step 7: Ensure agent USDC ATA exists ──────────────────────────────
  console.log("7. Ensuring agent USDC ATA exists (anti-theft snapshot point)...");
  const agentTokenAta = getAssociatedTokenAddressSync(usdcMint, delegateKeypair.publicKey);
  if (await accountExists(connection, agentTokenAta)) {
    console.log(`   Agent ATA already exists at ${agentTokenAta.toBase58()}`);
  } else {
    await createAssociatedTokenAccount(connection, payer, usdcMint, delegateKeypair.publicKey);
    console.log(`   Agent ATA: ${agentTokenAta.toBase58()}`);
  }
  console.log();

  // ── Step 8: Fund deployer + deposit + allocate ────────────────────────
  console.log("8. Minting test USDC and funding the strategy...");
  const payerAta = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  if (!(await accountExists(connection, payerAta))) {
    await createAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey);
  }
  await mintTo(connection, payer, usdcMint, payerAta, payer, opts.depositAmount * 2);

  const payerShareAta = getAssociatedTokenAddressSync(shareMintPda, payer.publicKey);
  await vaultProgram.methods
    .deposit(new BN(opts.depositAmount))
    .accountsStrict({
      user: payer.publicKey,
      vaultState: vaultPda,
      vaultAuthority: vaultAuthorityPda,
      tokenMint: usdcMint,
      shareMint: shareMintPda,
      userTokenAccount: payerAta,
      reserveAta,
      userShareToken: payerShareAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`   Deposited ${(opts.depositAmount / 1e6).toFixed(2)} USDC`);

  await vaultProgram.methods
    .allocateToStrategy(new BN(opts.allocateAmount))
    .accountsStrict({
      authority: payer.publicKey,
      vaultState: vaultPda,
      vaultAuthority: vaultAuthorityPda,
      strategy: strategyPda,
      tokenMint: usdcMint,
      reserveAta,
      strategyTokenAccount: strategyTokenPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`   Allocated ${(opts.allocateAmount / 1e6).toFixed(2)} USDC to strategy\n`);

  // ── Step 9: Print agent .env values ───────────────────────────────────
  console.log("=== Setup Complete ===\n");
  console.log("--- Copy to agent/kamino_looper/.env ---\n");
  console.log(`SOLANA_PRIVATE_KEY=${bs58.encode(delegateKeypair.secretKey)}`);
  console.log(`RPC_URL=${opts.rpcUrl}`);
  console.log(`VAULT_TOKEN_MINT=${usdcMint.toBase58()}`);
  console.log(`VAULT_ID=${opts.vaultId}`);
  console.log(`STRATEGY_ID=${strategyIndex}`);
  console.log(`KAMINO_PROGRAM_ID=${kaminoProgram.programId.toBase58()}`);
  console.log(`EVAL_INTERVAL_MS=300000`);
  console.log(`MAX_LEVERAGE=2.0`);
  console.log(`TARGET_LEVERAGE_MIN=1.5`);
  console.log(`TARGET_LEVERAGE_MAX=1.9`);
  console.log(`MIN_LOOP_NET_APY_PCT=1.5`);
  console.log(`HF_COMFORTABLE=1.8`);
  console.log(`HF_WARNING=1.3`);
  console.log(`USDC_SUPPLY_APY_BPS=600`);
  console.log(`USDC_BORROW_APY_BPS=400`);
  console.log(`DRY_RUN=false`);
  console.log("\n⚠ The agent wallet has 0 SOL — fund it for tx fees BEFORE running the agent:");
  console.log(`  solana transfer ${delegateKeypair.publicKey.toBase58()} 0.1 --allow-unfunded-recipient\n`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
