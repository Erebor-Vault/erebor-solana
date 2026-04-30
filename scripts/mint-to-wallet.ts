/**
 * mint-to-wallet.ts — Create a test token, mint to a target wallet,
 * initialize vault, and transfer admin + authority to the target wallet.
 *
 * Usage:
 *   bunx ts-node scripts/mint-to-wallet.ts
 *
 * Prerequisites:
 *   - ./id.json wallet with devnet SOL (at least 0.5 SOL)
 *   - Program deployed on devnet
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
// Config — edit these
// -------------------------------------------------------------------
const TARGET_WALLET = new PublicKey("8qKtKHeN8hMRLGPXQgBF84CkwC8UPjks4CLuCtLNF2qv");
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const MINT_AMOUNT = 1_000_000_000; // 1000 tokens (6 decimals)

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
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature: sig,
  });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;

  console.log("\n=== Mint Tokens & Setup Vault for Target Wallet ===\n");
  console.log(`Payer:          ${payer.publicKey.toBase58()}`);
  console.log(`Target Wallet:  ${TARGET_WALLET.toBase58()}`);
  console.log(`Program:        ${program.programId.toBase58()}`);

  // Check payer balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer Balance:  ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.3e9) {
    console.error("Need at least 0.3 SOL on payer. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // Step 1: Create test token mint (payer is mint authority)
  // -------------------------------------------------------------------
  console.log("1. Creating test token mint...");
  const tokenMint = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority = payer
    null,
    6 // 6 decimals like USDC
  );
  console.log(`   Token Mint: ${tokenMint.toBase58()}`);

  // -------------------------------------------------------------------
  // Step 2: Create ATA for target wallet and mint tokens
  // -------------------------------------------------------------------
  console.log("\n2. Minting tokens to target wallet...");
  const targetAta = await createAssociatedTokenAccount(
    connection,
    payer,
    tokenMint,
    TARGET_WALLET
  );
  console.log(`   Target ATA: ${targetAta.toBase58()}`);

  const mintSig = await mintTo(
    connection,
    payer,
    tokenMint,
    targetAta,
    payer,
    MINT_AMOUNT
  );
  await confirmTx(connection, mintSig);
  console.log(`   Minted:     ${MINT_AMOUNT / 1e6} tokens`);

  // -------------------------------------------------------------------
  // Step 3: Initialize vault (payer is initial admin)
  // -------------------------------------------------------------------
  console.log("\n3. Initializing vault...");
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()],
    program.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    program.programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({
    mint: tokenMint,
    owner: vaultAuthority,
  });

  await program.methods
    .initializeVault(new BN(0))
    .accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
      vaultAuthority,
      tokenMint,
      shareMint: shareMintPda,
      reserveAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`   Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`   Vault Authority:  ${vaultAuthority.toBase58()}`);
  console.log(`   Share Mint:       ${shareMintPda.toBase58()}`);

  // -------------------------------------------------------------------
  // Step 4: Propose admin and authority transfer to target wallet
  // -------------------------------------------------------------------
  console.log("\n4. Proposing admin & authority transfer (two-step)...");

  await program.methods
    .proposeAuthority(TARGET_WALLET)
    .accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
    })
    .rpc();
  console.log(`   Pending authority: ${TARGET_WALLET.toBase58()}`);

  await program.methods
    .proposeAdmin(TARGET_WALLET)
    .accountsStrict({
      admin: payer.publicKey,
      vaultState: vaultPda,
    })
    .rpc();
  console.log(`   Pending admin:     ${TARGET_WALLET.toBase58()}`);
  console.log(`   (target must call accept_admin + accept_authority to finalise)`);

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  const vault = await program.account.vaultState.fetch(vaultPda);

  console.log("\n=== Setup Complete ===\n");
  console.log(`Token Mint:       ${tokenMint.toBase58()}`);
  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Share Mint:       ${shareMintPda.toBase58()}`);
  console.log(`Reserve ATA:      ${reserveAta.toBase58()}`);
  console.log(`Vault Admin:      ${vault.admin.toBase58()}`);
  console.log(`Vault Authority:  ${vault.authority.toBase58()}`);
  console.log(`Tokens Minted:    ${MINT_AMOUNT / 1e6} to ${TARGET_WALLET.toBase58()}`);
  console.log();
  console.log("Update app/.env.local:");
  console.log(`  NEXT_PUBLIC_TOKEN_MINT=${tokenMint.toBase58()}`);
  console.log();
  console.log("Explorer:");
  console.log(`  https://explorer.solana.com/address/${vaultPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
