/**
 * init-allowed-token.ts — add a mint to the protocol-level token allow-list.
 * Governance signer required (= deployer wallet by default).
 *
 * Usage:
 *   bun scripts/init-allowed-token.ts --mint 5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N
 *   bun scripts/init-allowed-token.ts --mint <PUBKEY> --remove
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

function parseArgs() {
  const a = process.argv.slice(2);
  let cluster = "devnet";
  let walletPath = "./id.json";
  let mint: string | null = null;
  let remove = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cluster") cluster = a[++i];
    else if (a[i] === "--wallet") walletPath = a[++i];
    else if (a[i] === "--mint") mint = a[++i];
    else if (a[i] === "--remove") remove = true;
  }
  if (!mint) throw new Error("--mint is required");
  return { cluster, walletPath, mint, remove };
}

function clusterUrl(c: string): string {
  switch (c) {
    case "devnet":
      return "https://api.devnet.solana.com";
    case "mainnet":
      return "https://api.mainnet-beta.solana.com";
    case "localnet":
      return "http://localhost:8899";
    default:
      throw new Error(`Unknown cluster: ${c}`);
  }
}

async function main() {
  const { cluster, walletPath, mint, remove } = parseArgs();
  const mintPubkey = new PublicKey(mint);
  const connection = new anchor.web3.Connection(clusterUrl(cluster), "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  anchor.setProvider(
    new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
    })
  );
  const program = anchor.workspace.myProject as Program<MyProject>;

  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId
  );
  const [allowedToken] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_token"), mintPubkey.toBuffer()],
    program.programId
  );

  console.log(`\n=== ${remove ? "Remove" : "Add"} AllowedToken ===\n`);
  console.log(`Cluster:      ${cluster}`);
  console.log(`Mint:         ${mintPubkey.toBase58()}`);
  console.log(`Allowed PDA:  ${allowedToken.toBase58()}`);
  console.log(`Governance:   ${payer.publicKey.toBase58()}\n`);

  if (remove) {
    const sig = await program.methods
      .removeAllowedToken(mintPubkey)
      .accountsStrict({
        governance: payer.publicKey,
        protocolConfig,
        allowedToken,
      })
      .rpc();
    console.log(`removed — tx ${sig}`);
  } else {
    const existing = await connection.getAccountInfo(allowedToken);
    if (existing) {
      console.log("Already on the allow-list. Nothing to do.");
      return;
    }
    const sig = await program.methods
      .addAllowedToken(mintPubkey)
      .accountsStrict({
        governance: payer.publicKey,
        protocolConfig,
        allowedToken,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`added — tx ${sig}`);
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
