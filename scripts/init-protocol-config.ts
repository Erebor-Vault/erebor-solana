/**
 * init-protocol-config.ts — one-shot bootstrap for the global ProtocolConfig
 * PDA. After every program upgrade that introduces or relayouts the config,
 * run this once with the deployer keypair (the wallet you want to be the
 * `governance` for set_treasury / set_protocol_fee_bps / set_governance).
 *
 * Usage (defaults to devnet, deployer = ./id.json, treasury = deployer wallet,
 * protocol_fee_bps = 200):
 *   bun scripts/init-protocol-config.ts
 *
 * Override:
 *   bun scripts/init-protocol-config.ts \
 *     --cluster devnet \
 *     --treasury 4wrBiaNfvvk8nEoePJ94ceBa2APanrfjPyoWbjZYu9fn \
 *     --bps 200
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

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

function parseArgs() {
  const a = process.argv.slice(2);
  let cluster = "devnet";
  let walletPath = "./id.json";
  let treasury: string | null = null;
  let bps = 200;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cluster") cluster = a[++i];
    else if (a[i] === "--wallet") walletPath = a[++i];
    else if (a[i] === "--treasury") treasury = a[++i];
    else if (a[i] === "--bps") bps = Number(a[++i]);
  }
  return { cluster, walletPath, treasury, bps };
}

async function main() {
  const { cluster, walletPath, treasury, bps } = parseArgs();
  const connection = new anchor.web3.Connection(clusterUrl(cluster), "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(payer);
  anchor.setProvider(
    new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" })
  );
  const program = anchor.workspace.myProject as Program<MyProject>;

  const treasuryPubkey = treasury ? new PublicKey(treasury) : payer.publicKey;
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId
  );

  console.log("\n=== Initialise ProtocolConfig ===\n");
  console.log(`Cluster:           ${cluster}`);
  console.log(`Program:           ${program.programId.toBase58()}`);
  console.log(`Governance signer: ${payer.publicKey.toBase58()}`);
  console.log(`Treasury:          ${treasuryPubkey.toBase58()}`);
  console.log(`protocol_fee_bps:  ${bps}`);
  console.log(`PDA:               ${protocolConfig.toBase58()}\n`);

  const existing = await connection.getAccountInfo(protocolConfig);
  if (existing) {
    console.log("ProtocolConfig already initialised. Current state:");
    const cfg = await program.account.protocolConfig.fetch(protocolConfig);
    console.log(`  governance:       ${cfg.governance.toBase58()}`);
    console.log(`  treasury:         ${cfg.treasury.toBase58()}`);
    console.log(`  protocol_fee_bps: ${cfg.protocolFeeBps}`);
    console.log("\nUse set_treasury / set_protocol_fee_bps / set_governance to change it.");
    return;
  }

  const sig = await program.methods
    .initializeProtocolConfig(treasuryPubkey, bps)
    .accountsStrict({
      governance: payer.publicKey,
      protocolConfig,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`tx: ${sig}\n`);

  const cfg = await program.account.protocolConfig.fetch(protocolConfig);
  console.log("ProtocolConfig initialised:");
  console.log(`  governance:       ${cfg.governance.toBase58()}`);
  console.log(`  treasury:         ${cfg.treasury.toBase58()}`);
  console.log(`  protocol_fee_bps: ${cfg.protocolFeeBps}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
