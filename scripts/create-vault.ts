/**
 * create-vault.ts — Initialize a new vault for an existing token mint
 * and transfer admin + authority to a target wallet.
 *
 * Usage:
 *   npx ts-mocha scripts/create-vault.ts
 *
 * Config: edit TOKEN_MINT and TARGET_WALLET below.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import BN from "bn.js";

// -------------------------------------------------------------------
// Config — edit these
// -------------------------------------------------------------------
const TOKEN_MINT = new PublicKey("45AbULTJqK9dpDNDQMb3fe9ojPwc53gr7uUsqHNwkDUY");
const VAULT_ID = 4;
const TARGET_WALLET = new PublicKey("8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv");
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function loadWallet(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
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

  console.log("\n=== Create Vault ===\n");
  console.log(`Token Mint:     ${TOKEN_MINT.toBase58()}`);
  console.log(`Target Wallet:  ${TARGET_WALLET.toBase58()}`);
  console.log(`Payer:          ${payer.publicKey.toBase58()}`);
  console.log(`Program:        ${program.programId.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer Balance:  ${(balance / 1e9).toFixed(4)} SOL\n`);

  // Derive PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)], program.programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()], program.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()], program.programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({ mint: TOKEN_MINT, owner: vaultAuthority });

  // Check if vault already exists
  const existing = await connection.getAccountInfo(vaultPda);
  if (existing) {
    const vault = await program.account.vaultState.fetch(vaultPda);
    console.log("Vault already exists for this token mint!\n");
    console.log(`  Vault PDA:   ${vaultPda.toBase58()}`);
    console.log(`  Admin:       ${vault.admin.toBase58()}`);
    console.log(`  Authority:   ${vault.authority.toBase58()}`);
    console.log(`  Strategies:  ${vault.strategyCount.toString()}`);
    console.log(`\nNote: One vault per token mint. Use a different mint for a new vault.`);
    process.exit(0);
  }

  // Check token mint exists
  const mintInfo = await connection.getAccountInfo(TOKEN_MINT);
  if (!mintInfo) {
    console.error("Token mint does not exist on-chain. Check the address.");
    process.exit(1);
  }

  // Initialize vault
  console.log("Initializing vault...");
  await program.methods.initializeVault(new BN(VAULT_ID)).accountsStrict({
    admin: payer.publicKey,
    vaultState: vaultPda,
    vaultAuthority,
    tokenMint: TOKEN_MINT,
    shareMint: shareMintPda,
    reserveAta,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  }).rpc();

  console.log("   Vault created!\n");

  // Two-step admin/authority transfer (audit #21). The recipient must call
  // accept_admin / accept_authority from their own keypair to finalise.
  if (!TARGET_WALLET.equals(payer.publicKey)) {
    console.log("Proposing admin & authority transfer...");

    await program.methods.proposeAuthority(TARGET_WALLET).accountsStrict({
      admin: payer.publicKey, vaultState: vaultPda,
    }).rpc();

    await program.methods.proposeAdmin(TARGET_WALLET).accountsStrict({
      admin: payer.publicKey, vaultState: vaultPda,
    }).rpc();

    console.log(`   Pending admin/authority -> ${TARGET_WALLET.toBase58()}`);
    console.log(`   (target must call accept_admin + accept_authority to finalise)\n`);
  }

  // Summary
  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log("=== Vault Ready ===\n");
  console.log(`Token Mint:   ${TOKEN_MINT.toBase58()}`);
  console.log(`Vault PDA:    ${vaultPda.toBase58()}`);
  console.log(`Share Mint:   ${shareMintPda.toBase58()}`);
  console.log(`Reserve ATA:  ${reserveAta.toBase58()}`);
  console.log(`Admin:        ${vault.admin.toBase58()}`);
  console.log(`Authority:    ${vault.authority.toBase58()}`);
  console.log(`Strategies:   0 (create from admin panel)\n`);
  console.log(`Update app/.env.local:`);
  console.log(`  NEXT_PUBLIC_TOKEN_MINT=${TOKEN_MINT.toBase58()}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
