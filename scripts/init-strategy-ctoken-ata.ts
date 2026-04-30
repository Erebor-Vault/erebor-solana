/**
 * init-strategy-ctoken-ata.ts — Create the strategy's cToken ATA for an
 * existing kamino_looper strategy. Required before the agent's first
 * deposit (mock_kamino mints cTokens into this ATA — without it, mint_to
 * fails with "Attempt to debit an account but found no record of a prior
 * credit").
 *
 * Idempotent: skips if the ATA already exists.
 *
 * Usage:
 *   bun scripts/init-strategy-ctoken-ata.ts --mint <USDC> --strategy-id 1
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

function loadKeypair(path: string) {
  return anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf-8")))
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  let mintAddress = "";
  let vaultId = 0;
  let strategyId = 0;
  let walletPath = "./id.json";
  let rpcUrl = "https://api.devnet.solana.com";
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mint":         mintAddress = args[++i]; break;
      case "--vault-id":     vaultId = Number(args[++i]); break;
      case "--strategy-id":  strategyId = Number(args[++i]); break;
      case "--wallet":       walletPath = args[++i]; break;
      case "--rpc":          rpcUrl = args[++i]; break;
    }
  }
  if (!mintAddress) {
    console.error("--mint required");
    process.exit(1);
  }
  return { mintAddress, vaultId, strategyId, walletPath, rpcUrl };
}

async function main() {
  const opts = parseArgs();
  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const liquidityMint = new PublicKey(opts.mintAddress);

  const vaultIdl = JSON.parse(fs.readFileSync("./target/idl/my_project.json", "utf-8"));
  const kaminoIdl = JSON.parse(fs.readFileSync("./target/idl/mock_kamino.json", "utf-8"));
  const vaultProgramId = new PublicKey(vaultIdl.address);
  const kaminoProgramId = new PublicKey(kaminoIdl.address);

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), liquidityMint.toBuffer(), new BN(opts.vaultId).toArrayLike(Buffer, "le", 8)],
    vaultProgramId
  );
  const [strategyAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgramId
  );
  const [collateralMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), liquidityMint.toBuffer()],
    kaminoProgramId
  );
  const ctokenAta = getAssociatedTokenAddressSync(collateralMintPda, strategyAuthorityPda, true);

  console.log(`Strategy authority: ${strategyAuthorityPda.toBase58()}`);
  console.log(`Collateral mint:    ${collateralMintPda.toBase58()}`);
  console.log(`cToken ATA:         ${ctokenAta.toBase58()}`);

  const existing = await connection.getAccountInfo(ctokenAta);
  if (existing) {
    console.log("\nAlready exists — nothing to do.");
    return;
  }

  console.log("\nCreating cToken ATA (owner is a PDA — using off-curve path)...");
  // strategy_authority is a PDA, so the high-level createAssociatedTokenAccount
  // helper rejects it (no allowOwnerOffCurve flag). Build the ix manually and
  // send the tx ourselves.
  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,             // payer
    ctokenAta,                   // ata to create
    strategyAuthorityPda,        // owner (off-curve PDA)
    collateralMintPda            // mint
  );
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  console.log(`Done. tx: ${sig}`);
}

main().catch((err) => {
  console.error("Failed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
