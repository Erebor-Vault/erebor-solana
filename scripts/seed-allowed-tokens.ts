/**
 * seed-allowed-tokens.ts — batch-seed the protocol-level `AllowedToken`
 * allow-list with the 12 MVP mints listed in `mvp-mints-<cluster>.json`.
 *
 * Reads the JSON written by `mint-mvp-tokens.ts` (devnet mocks) — for
 * mainnet, swap in a hand-curated JSON with the canonical mint pubkeys
 * before running.
 *
 * Idempotent: skips mints whose `["allowed_token", mint]` PDA already
 * exists. `--remove` closes those PDAs (refunds rent to governance).
 *
 * Governance signer required (= the wallet that ran `init-protocol-config.ts`).
 *
 * Usage:
 *   bun scripts/seed-allowed-tokens.ts                    # devnet, add all
 *   bun scripts/seed-allowed-tokens.ts --remove           # close all
 *   bun scripts/seed-allowed-tokens.ts --cluster localnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { MVP_TOKEN_LIST, MvpMintsFile } from "./mvp-token-list";

function parseArgs() {
  const a = process.argv.slice(2);
  let cluster = "devnet";
  let walletPath = "./id.json";
  let remove = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cluster") cluster = a[++i];
    else if (a[i] === "--wallet") walletPath = a[++i];
    else if (a[i] === "--remove") remove = true;
  }
  return { cluster, walletPath, remove };
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
  const { cluster, walletPath, remove } = parseArgs();
  const file = path.join(__dirname, `mvp-mints-${cluster}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} not found. Run \`bun scripts/mint-mvp-tokens.ts --cluster ${cluster}\` first.`
    );
  }
  const mints: MvpMintsFile = JSON.parse(fs.readFileSync(file, "utf-8"));

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

  console.log(`\n=== ${remove ? "Remove" : "Seed"} protocol AllowedToken (${cluster}) ===`);
  console.log(`Governance:  ${payer.publicKey.toBase58()}`);
  console.log(`Mints file:  ${file}\n`);

  let acted = 0;
  let skipped = 0;
  for (const t of MVP_TOKEN_LIST) {
    const mintStr = mints[t.symbol];
    if (!mintStr) {
      console.warn(`  ! ${t.symbol.padEnd(8)} missing from ${path.basename(file)} — skip`);
      continue;
    }
    const mint = new PublicKey(mintStr);
    const [allowedToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowed_token"), mint.toBuffer()],
      program.programId
    );
    const existing = await connection.getAccountInfo(allowedToken);

    if (remove) {
      if (!existing) {
        console.log(`  · ${t.symbol.padEnd(8)} not on list — skip`);
        skipped += 1;
        continue;
      }
      const sig = await program.methods
        .removeAllowedToken(mint)
        .accountsStrict({
          governance: payer.publicKey,
          protocolConfig,
          allowedToken,
        })
        .rpc();
      acted += 1;
      console.log(`  ✓ ${t.symbol.padEnd(8)} removed — ${sig.slice(0, 12)}…`);
    } else {
      if (existing) {
        console.log(`  · ${t.symbol.padEnd(8)} already on list — skip`);
        skipped += 1;
        continue;
      }
      const sig = await program.methods
        .addAllowedToken(mint)
        .accountsStrict({
          governance: payer.publicKey,
          protocolConfig,
          allowedToken,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      acted += 1;
      console.log(`  ✓ ${t.symbol.padEnd(8)} added — ${sig.slice(0, 12)}…`);
    }
  }

  console.log(
    `\nDone. ${remove ? "Removed" : "Added"} ${acted}, skipped ${skipped} (already in target state).`
  );
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
