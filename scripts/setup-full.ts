/**
 * setup-full.ts — Full devnet setup:
 *   1. Create test token mint
 *   2. Mint 1000 tokens to target wallet
 *   3. Initialize vault
 *   4. Create 5 AI agent strategies with weights
 *   5. Transfer admin + authority to target wallet
 *
 * Usage:
 *   npx ts-mocha scripts/setup-full.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
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

// -------------------------------------------------------------------
// Config
// -------------------------------------------------------------------
const TARGET_WALLET = new PublicKey("8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv");
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const MINT_AMOUNT = 1_000_000_000; // 1000 tokens (6 decimals)

const STRATEGIES = [
  { name: "AI Lending Agent (Kamino)",    weightBps: 2500 }, // 25%
  { name: "AI Yield Agent (Drift)",       weightBps: 2000 }, // 20%
  { name: "AI LP Agent (Raydium)",        weightBps: 1500 }, // 15%
  { name: "AI Staking Agent (MarginFi)",  weightBps: 1000 }, // 10%
  { name: "AI Arbitrage Agent (Jupiter)", weightBps: 500 },  // 5%
];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function loadWallet(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function confirmTx(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;

  console.log("\n=== Full Devnet Setup ===\n");
  console.log(`Payer:          ${payer.publicKey.toBase58()}`);
  console.log(`Target Wallet:  ${TARGET_WALLET.toBase58()}`);
  console.log(`Program:        ${program.programId.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer Balance:  ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.1e9) {
    console.error("Need at least 0.1 SOL. Fund the payer wallet first.");
    process.exit(1);
  }

  // ---- Step 1: Create token mint ----
  console.log("1. Creating test token mint...");
  const tokenMint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log(`   Token Mint: ${tokenMint.toBase58()}`);

  // ---- Step 2: Mint tokens to target wallet ----
  console.log("\n2. Minting tokens to target wallet...");
  const targetAta = await createAssociatedTokenAccount(connection, payer, tokenMint, TARGET_WALLET);
  const mintSig = await mintTo(connection, payer, tokenMint, targetAta, payer, MINT_AMOUNT);
  await confirmTx(connection, mintSig);
  console.log(`   Minted ${MINT_AMOUNT / 1e6} tokens to ${TARGET_WALLET.toBase58()}`);

  // ---- Step 3: Initialize vault ----
  console.log("\n3. Initializing vault...");
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)], program.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()], program.programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({ mint: tokenMint, owner: vaultPda });

  await program.methods.initializeVault(new BN(0)).accountsStrict({
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

  // ---- Step 4: Create 5 strategies ----
  console.log("\n4. Creating 5 AI agent strategies...\n");

  const strategyResults: {
    id: number; name: string; pda: string; tokenAccount: string; delegate: string; weightBps: number;
  }[] = [];

  for (let i = 0; i < STRATEGIES.length; i++) {
    const agentKeypair = Keypair.generate();

    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(i).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [sToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(i).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods.createStrategy().accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
      strategy: sPda,
      tokenMint,
      strategyTokenAccount: sToken,
      delegate: agentKeypair.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    await program.methods.setStrategyWeight(STRATEGIES[i].weightBps).accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
      strategy: sPda,
    }).rpc();

    console.log(`   #${i} ${STRATEGIES[i].name}`);
    console.log(`      Delegate: ${agentKeypair.publicKey.toBase58()}`);
    console.log(`      Weight:   ${STRATEGIES[i].weightBps / 100}%`);

    strategyResults.push({
      id: i,
      name: STRATEGIES[i].name,
      pda: sPda.toBase58(),
      tokenAccount: sToken.toBase58(),
      delegate: agentKeypair.publicKey.toBase58(),
      weightBps: STRATEGIES[i].weightBps,
    });
  }

  // ---- Step 5: Transfer admin + authority to target wallet ----
  console.log("\n5. Transferring admin & authority to target wallet...");

  await program.methods.setAuthority(TARGET_WALLET).accountsStrict({
    admin: payer.publicKey, vaultState: vaultPda,
  }).rpc();
  console.log(`   Authority -> ${TARGET_WALLET.toBase58()}`);

  await program.methods.transferAdmin(TARGET_WALLET).accountsStrict({
    admin: payer.publicKey, vaultState: vaultPda,
  }).rpc();
  console.log(`   Admin -> ${TARGET_WALLET.toBase58()}`);

  // ---- Summary ----
  const vault = await program.account.vaultState.fetch(vaultPda);
  const totalWeight = STRATEGIES.reduce((s, x) => s + x.weightBps, 0);

  console.log("\n=== Setup Complete ===\n");
  console.log(`Token Mint:       ${tokenMint.toBase58()}`);
  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Share Mint:       ${shareMintPda.toBase58()}`);
  console.log(`Reserve ATA:      ${reserveAta.toBase58()}`);
  console.log(`Vault Admin:      ${vault.admin.toBase58()}`);
  console.log(`Vault Authority:  ${vault.authority.toBase58()}`);
  console.log(`Tokens Minted:    ${MINT_AMOUNT / 1e6} to ${TARGET_WALLET.toBase58()}`);
  console.log(`Strategies:       ${strategyResults.length}`);
  console.log(`Total Weight:     ${totalWeight / 100}% (${100 - totalWeight / 100}% reserve)\n`);

  console.log("## Devnet Strategies\n");
  console.log("| # | Name | Delegate (AI Agent Wallet) | Weight | Strategy PDA | Token Account |");
  console.log("|---|------|---------------------------|--------|--------------|---------------|");
  for (const s of strategyResults) {
    console.log(`| ${s.id} | ${s.name} | \`${s.delegate}\` | ${s.weightBps / 100}% | \`${s.pda}\` | \`${s.tokenAccount}\` |`);
  }

  console.log(`\nUpdate app/.env.local:`);
  console.log(`  NEXT_PUBLIC_TOKEN_MINT=${tokenMint.toBase58()}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
