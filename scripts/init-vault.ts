/**
 * init-vault.ts — Initialize a vault for a given token mint after deployment.
 *
 * Usage:
 *   bunx ts-node scripts/init-vault.ts --cluster devnet --mint <TOKEN_MINT_ADDRESS>
 *   bunx ts-node scripts/init-vault.ts --cluster mainnet --mint <TOKEN_MINT_ADDRESS> --wallet ~/.config/solana/id.json
 *
 * This script:
 *   1. Connects to the specified cluster
 *   2. Derives the vault PDA, share mint PDA, and reserve ATA
 *   3. Calls initialize_vault on the deployed program
 *   4. Prints all derived account addresses
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// -------------------------------------------------------------------
// Parse CLI args
// -------------------------------------------------------------------
function parseArgs(): { cluster: string; mint: string; wallet: string } {
  const args = process.argv.slice(2);
  let cluster = "devnet";
  let mint = "";
  let wallet = "./id.json";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cluster":
        cluster = args[++i];
        break;
      case "--mint":
        mint = args[++i];
        break;
      case "--wallet":
        wallet = args[++i];
        break;
      case "--help":
        console.log(
          "Usage: bunx ts-node scripts/init-vault.ts --cluster <devnet|mainnet> --mint <MINT_ADDRESS> [--wallet <WALLET_PATH>]"
        );
        process.exit(0);
    }
  }

  if (!mint) {
    console.error("Error: --mint is required");
    console.error(
      "Usage: bunx ts-node scripts/init-vault.ts --cluster <devnet|mainnet> --mint <MINT_ADDRESS>"
    );
    process.exit(1);
  }

  return { cluster, mint, wallet };
}

function clusterUrl(cluster: string): string {
  switch (cluster) {
    case "devnet":
      return "https://api.devnet.solana.com";
    case "mainnet":
      return "https://api.mainnet-beta.solana.com";
    case "localnet":
      return "http://localhost:8899";
    default:
      throw new Error(`Unknown cluster: ${cluster}`);
  }
}

async function main() {
  const { cluster, mint: mintStr, wallet: walletPath } = parseArgs();
  const tokenMint = new PublicKey(mintStr);

  console.log(`\nInitializing vault on ${cluster}`);
  console.log(`Token mint: ${tokenMint.toBase58()}`);
  console.log(`Wallet: ${walletPath}\n`);

  // Setup provider
  const url = clusterUrl(cluster);
  const connection = new anchor.web3.Connection(url, "confirmed");

  // Load wallet from file
  const fs = require("fs");
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;

  // Derive PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()],
    program.programId
  );

  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    program.programId
  );

  const reserveAta = anchor.utils.token.associatedAddress({
    mint: tokenMint,
    owner: vaultPda,
  });

  console.log("Derived accounts:");
  console.log(`  Vault PDA:   ${vaultPda.toBase58()}`);
  console.log(`  Share Mint:  ${shareMintPda.toBase58()}`);
  console.log(`  Reserve ATA: ${reserveAta.toBase58()}`);
  console.log();

  // Check if vault already exists
  const existing = await connection.getAccountInfo(vaultPda);
  if (existing) {
    console.log("Vault already initialized at this address. Fetching state...\n");
    const vault = await program.account.vaultState.fetch(vaultPda);
    console.log(`  Admin:            ${vault.admin.toBase58()}`);
    console.log(`  Authority:        ${vault.authority.toBase58()}`);
    console.log(`  Total Deposited:  ${vault.totalDeposited.toString()}`);
    console.log(`  Strategy Count:   ${vault.strategyCount.toString()}`);
    process.exit(0);
  }

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const solBalance = balance / 1e9;
  console.log(`Wallet balance: ${solBalance.toFixed(4)} SOL`);

  if (solBalance < 0.05) {
    console.error(
      `Insufficient SOL. Need at least 0.05 SOL for account rent. Current: ${solBalance} SOL`
    );
    process.exit(1);
  }

  // Initialize vault
  console.log("\nSending initialize_vault transaction...");

  const tx = await program.methods
    .initializeVault()
    .accountsStrict({
      admin: walletKeypair.publicKey,
      vaultState: vaultPda,
      tokenMint: tokenMint,
      shareMint: shareMintPda,
      reserveAta: reserveAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`\nTransaction: ${tx}`);

  const explorerCluster = cluster === "mainnet" ? "" : `?cluster=${cluster}`;
  console.log(
    `Explorer: https://explorer.solana.com/tx/${tx}${explorerCluster}`
  );

  // Verify
  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log("\nVault initialized successfully!");
  console.log(`  Admin:     ${vault.admin.toBase58()}`);
  console.log(`  Authority: ${vault.authority.toBase58()}`);
  console.log(`  Mint:      ${vault.tokenMint.toBase58()}`);
  console.log(`  Shares:    ${vault.shareMint.toBase58()}`);
}

main().catch((err) => {
  console.error("\nDeployment failed:", err.message || err);
  process.exit(1);
});
