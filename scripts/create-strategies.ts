/**
 * create-strategies.ts — Set up a vault strategy for an AI agent.
 *
 * This script performs the complete setup sequence:
 *   1. Creates a test token mint (or uses existing --mint)
 *   2. Initializes the vault (if not already initialized)
 *   3. Creates a strategy with the specified delegate keypair
 *   4. Sets the strategy weight
 *   5. Whitelists mock_lulo deposit + withdraw instructions (add_allowed_action)
 *   6. Initializes the mock_lulo treasury (if needed)
 *   7. Mints test tokens to the deployer
 *   8. Deposits tokens into the vault reserve
 *   9. Allocates tokens from reserve to the strategy
 *  10. Prints agent .env values ready to copy
 *
 * Usage:
 *   bunx ts-node scripts/create-strategies.ts --delegate ./agent_keypair.json
 *   bunx ts-node scripts/create-strategies.ts --delegate ./agent_keypair.json --mint <EXISTING_MINT>
 *   bunx ts-node scripts/create-strategies.ts --delegate ./agent_keypair.json --weight 5000 --deposit 100000000 --allocate 50000000
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { MockLulo } from "../target/types/mock_lulo";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import bs58 from "bs58";
import { createHash } from "crypto";

// -------------------------------------------------------------------
// CLI argument parsing
// -------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let delegatePath = "";
  let mintAddress = "";
  let weightBps = 5000;       // default: 50%
  let depositAmount = 50_000_000;   // default: 50 USDC (6 decimals)
  let allocateAmount = 25_000_000;  // default: 25 USDC
  let rpcUrl = "https://api.devnet.solana.com";
  let walletPath = "./id.json";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--delegate":  delegatePath = args[++i]; break;
      case "--mint":      mintAddress = args[++i]; break;
      case "--weight":    weightBps = Number(args[++i]); break;
      case "--deposit":   depositAmount = Number(args[++i]); break;
      case "--allocate":  allocateAmount = Number(args[++i]); break;
      case "--rpc":       rpcUrl = args[++i]; break;
      case "--wallet":    walletPath = args[++i]; break;
      case "--help":
        console.log(`Usage: bunx ts-node scripts/create-strategies.ts --delegate <KEYPAIR_PATH> [options]

Options:
  --delegate <path>   Path to agent keypair JSON (REQUIRED)
  --mint <address>    Use existing token mint (default: create new)
  --weight <bps>      Strategy weight in basis points (default: 5000 = 50%)
  --deposit <amount>  Micro-USDC to deposit into vault (default: 50000000 = 50 USDC)
  --allocate <amount> Micro-USDC to allocate to strategy (default: 25000000 = 25 USDC)
  --rpc <url>         Solana RPC URL (default: devnet)
  --wallet <path>     Deployer wallet keypair (default: ./id.json)`);
        process.exit(0);
    }
  }

  if (!delegatePath) {
    console.error("Error: --delegate is required. Pass the path to the agent keypair JSON file.");
    console.error("  Example: bunx ts-node scripts/create-strategies.ts --delegate ./agent_keypair.json");
    process.exit(1);
  }

  return { delegatePath, mintAddress, weightBps, depositAmount, allocateAmount, rpcUrl, walletPath };
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(name: string): number[] {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Array.from(hash.subarray(0, 8));
}

async function confirmTx(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const delegateKeypair = loadKeypair(opts.delegatePath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const mockLuloProgram = anchor.workspace.mockLulo as Program<MockLulo>;

  console.log("\n=== Erebor Agent Strategy Setup ===\n");
  console.log(`Deployer:      ${payer.publicKey.toBase58()}`);
  console.log(`Agent (delegate): ${delegateKeypair.publicKey.toBase58()}`);
  console.log(`Vault Program: ${vaultProgram.programId.toBase58()}`);
  console.log(`Mock Lulo:     ${mockLuloProgram.programId.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Deployer SOL:  ${(balance / 1e9).toFixed(4)}\n`);
  if (balance < 0.1e9) {
    console.error("Need at least 0.1 SOL. Fund the deployer wallet first.");
    process.exit(1);
  }

  // ── Step 1: Token mint ──────────────────────────────────────────────────
  let tokenMint: PublicKey;
  if (opts.mintAddress) {
    tokenMint = new PublicKey(opts.mintAddress);
    console.log(`1. Using existing mint: ${tokenMint.toBase58()}`);
  } else {
    console.log("1. Creating test token mint (6 decimals)...");
    tokenMint = await createMint(connection, payer, payer.publicKey, null, 6);
    console.log(`   Mint: ${tokenMint.toBase58()}`);
  }

  // ── Step 2: Initialize vault ────────────────────────────────────────────
  const vaultId = new BN(0);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    vaultProgram.programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({ mint: tokenMint, owner: vaultPda });

  const existingVault = await connection.getAccountInfo(vaultPda);
  if (existingVault) {
    console.log(`\n2. Vault already initialized at ${vaultPda.toBase58()}`);
  } else {
    console.log("\n2. Initializing vault...");
    await vaultProgram.methods.initializeVault(vaultId).accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
      tokenMint,
      shareMint: shareMintPda,
      reserveAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    }).rpc();
    console.log(`   Vault PDA:   ${vaultPda.toBase58()}`);
    console.log(`   Share Mint:  ${shareMintPda.toBase58()}`);
    console.log(`   Reserve ATA: ${reserveAta.toBase58()}`);
  }

  // ── Step 3: Create strategy with agent as delegate ──────────────────────
  const vault = await vaultProgram.account.vaultState.fetch(vaultPda);
  const strategyIndex = vault.strategyCount.toNumber();

  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );

  console.log(`\n3. Creating Strategy #${strategyIndex}...`);
  await vaultProgram.methods.createStrategy().accountsStrict({
    admin: payer.publicKey,
    vaultState: vaultPda,
    strategy: strategyPda,
    tokenMint,
    strategyTokenAccount: strategyTokenPda,
    delegate: delegateKeypair.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();
  console.log(`   Strategy PDA:   ${strategyPda.toBase58()}`);
  console.log(`   Token Account:  ${strategyTokenPda.toBase58()}`);
  console.log(`   Delegate:       ${delegateKeypair.publicKey.toBase58()}`);

  // ── Step 4: Set strategy weight ─────────────────────────────────────────
  console.log(`\n4. Setting weight to ${opts.weightBps} bps (${opts.weightBps / 100}%)...`);
  await vaultProgram.methods.setStrategyWeight(opts.weightBps).accountsStrict({
    admin: payer.publicKey,
    vaultState: vaultPda,
    strategy: strategyPda,
  }).rpc();

  // ── Step 5: Whitelist mock_lulo deposit + withdraw ──────────────────────
  console.log("\n5. Whitelisting mock_lulo actions...");
  const depositDisc = anchorDiscriminator("deposit");
  const withdrawDisc = anchorDiscriminator("withdraw");

  // Fetch strategy to get current action_count
  let strategy = await vaultProgram.account.strategyAllocation.fetch(strategyPda);

  // Add deposit action
  const [depositActionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_action"), strategyPda.toBuffer(), new BN(strategy.actionCount).toArrayLike(Buffer, "le", 2)],
    vaultProgram.programId
  );
  await vaultProgram.methods
    .addAllowedAction(mockLuloProgram.programId, depositDisc)
    .accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      allowedAction: depositActionPda,
      systemProgram: SystemProgram.programId,
    }).rpc();
  console.log(`   #0: deposit  → ${depositActionPda.toBase58()}`);

  // Re-fetch for updated action_count
  strategy = await vaultProgram.account.strategyAllocation.fetch(strategyPda);

  // Add withdraw action
  const [withdrawActionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_action"), strategyPda.toBuffer(), new BN(strategy.actionCount).toArrayLike(Buffer, "le", 2)],
    vaultProgram.programId
  );
  await vaultProgram.methods
    .addAllowedAction(mockLuloProgram.programId, withdrawDisc)
    .accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      allowedAction: withdrawActionPda,
      systemProgram: SystemProgram.programId,
    }).rpc();
  console.log(`   #1: withdraw → ${withdrawActionPda.toBase58()}`);

  // ── Step 6: Initialize mock_lulo treasury ───────────────────────────────
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), tokenMint.toBuffer()],
    mockLuloProgram.programId
  );

  const existingTreasury = await connection.getAccountInfo(treasuryPda);
  if (existingTreasury) {
    console.log(`\n6. Mock Lulo treasury already initialized at ${treasuryPda.toBase58()}`);
  } else {
    console.log("\n6. Initializing mock_lulo treasury...");
    await mockLuloProgram.methods.initializeTreasury().accountsStrict({
      payer: payer.publicKey,
      mint: tokenMint,
      treasury: treasuryPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).rpc();
    console.log(`   Treasury PDA: ${treasuryPda.toBase58()}`);
  }

  // ── Step 6b: Initialize mock_lulo position for this strategy ─────────
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    mockLuloProgram.programId
  );

  const existingPosition = await connection.getAccountInfo(positionPda);
  if (existingPosition) {
    console.log(`   Position already initialized at ${positionPda.toBase58()}`);
  } else {
    console.log("   Initializing position tracker...");
    await mockLuloProgram.methods.initializePosition().accountsStrict({
      payer: payer.publicKey,
      strategyTokenAccount: strategyTokenPda,
      position: positionPda,
      systemProgram: SystemProgram.programId,
    }).rpc();
    console.log(`   Position PDA: ${positionPda.toBase58()}`);
  }

  // ── Step 7: Mint test tokens ────────────────────────────────────────────
  if (!opts.mintAddress) {
    console.log("\n7. Minting test tokens to deployer...");
    const payerAta = await createAssociatedTokenAccount(connection, payer, tokenMint, payer.publicKey);
    const mintAmount = Math.max(opts.depositAmount * 2, 100_000_000); // at least 100 USDC
    const mintSig = await mintTo(connection, payer, tokenMint, payerAta, payer, mintAmount);
    await confirmTx(connection, mintSig);
    console.log(`   Minted ${(mintAmount / 1e6).toFixed(2)} USDC to ${payer.publicKey.toBase58()}`);
  } else {
    console.log("\n7. Skipping mint (using existing token)");
  }

  // ── Step 8: Deposit to vault ────────────────────────────────────────────
  if (opts.depositAmount > 0) {
    console.log(`\n8. Depositing ${(opts.depositAmount / 1e6).toFixed(2)} USDC to vault...`);
    const payerAta = anchor.utils.token.associatedAddress({ mint: tokenMint, owner: payer.publicKey });
    const payerShareAta = anchor.utils.token.associatedAddress({ mint: shareMintPda, owner: payer.publicKey });

    await vaultProgram.methods.deposit(new BN(opts.depositAmount)).accountsStrict({
      user: payer.publicKey,
      vaultState: vaultPda,
      tokenMint,
      shareMint: shareMintPda,
      userTokenAccount: payerAta,
      reserveAta,
      userShareToken: payerShareAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    }).rpc();
    console.log(`   Deposited ${(opts.depositAmount / 1e6).toFixed(2)} USDC`);
  }

  // ── Step 9: Allocate to strategy ────────────────────────────────────────
  if (opts.allocateAmount > 0) {
    console.log(`\n9. Allocating ${(opts.allocateAmount / 1e6).toFixed(2)} USDC to strategy...`);
    await vaultProgram.methods.allocateToStrategy(new BN(opts.allocateAmount)).accountsStrict({
      authority: payer.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      tokenMint,
      reserveAta,
      strategyTokenAccount: strategyTokenPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    console.log(`   Allocated ${(opts.allocateAmount / 1e6).toFixed(2)} USDC`);
  }

  // ── Step 10: Print agent .env values ────────────────────────────────────
  const agentPrivateKeyBase58 = bs58.encode(delegateKeypair.secretKey);

  console.log("\n=== Setup Complete ===\n");
  console.log(`Token Mint:     ${tokenMint.toBase58()}`);
  console.log(`Vault PDA:      ${vaultPda.toBase58()}`);
  console.log(`Strategy #${strategyIndex}:   ${strategyPda.toBase58()}`);
  console.log(`Token Account:  ${strategyTokenPda.toBase58()}`);
  console.log(`Delegate:       ${delegateKeypair.publicKey.toBase58()}`);
  console.log(`Weight:         ${opts.weightBps / 100}%`);
  console.log(`Deposited:      ${(opts.depositAmount / 1e6).toFixed(2)} USDC`);
  console.log(`Allocated:      ${(opts.allocateAmount / 1e6).toFixed(2)} USDC`);
  console.log(`Mock Lulo:      ${mockLuloProgram.programId.toBase58()}`);
  console.log(`Treasury:       ${treasuryPda.toBase58()}`);
  console.log(`Actions:        deposit (#0), withdraw (#1)`);

  console.log("\n--- Copy to agent/.env ---\n");
  console.log(`SOLANA_PRIVATE_KEY=${agentPrivateKeyBase58}`);
  console.log(`RPC_URL=${opts.rpcUrl}`);
  console.log(`ANTHROPIC_API_KEY=<your_claude_api_key>`);
  console.log(`VAULT_TOKEN_MINT=${tokenMint.toBase58()}`);
  console.log(`VAULT_ID=0`);
  console.log(`STRATEGY_ID=${strategyIndex}`);
  console.log(`LULO_PROGRAM_ID=${mockLuloProgram.programId.toBase58()}`);
  console.log(`LULO_TREASURY=${treasuryPda.toBase58()}`);
  console.log(`POLL_INTERVAL_MS=30000`);
  console.log(`MIN_LEND_AMOUNT=1000000`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
