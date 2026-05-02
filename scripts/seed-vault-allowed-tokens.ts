/**
 * seed-vault-allowed-tokens.ts — batch-seed the *per-vault* curator
 * allow-list (`VaultAllowedToken` PDAs) for a single vault. Defense-
 * in-depth alongside the protocol-level allow-list seeded by
 * `seed-allowed-tokens.ts`.
 *
 * Each per-vault entry requires the protocol-level entry to already
 * exist for the same mint (the program enforces this — the admin can
 * only narrow the protocol-approved set, never extend it).
 *
 * Admin signer required (= the wallet that initialised the vault).
 *
 * Usage:
 *   bun scripts/seed-vault-allowed-tokens.ts --vault <PDA>
 *   bun scripts/seed-vault-allowed-tokens.ts --vault <PDA> --symbols USDC,USDT,wSOL
 *   bun scripts/seed-vault-allowed-tokens.ts --vault <PDA> --remove
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
  let vault: string | null = null;
  let symbols: string[] | null = null;
  let remove = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cluster") cluster = a[++i];
    else if (a[i] === "--wallet") walletPath = a[++i];
    else if (a[i] === "--vault") vault = a[++i];
    else if (a[i] === "--symbols") symbols = a[++i].split(",").map((s) => s.trim());
    else if (a[i] === "--remove") remove = true;
  }
  if (!vault) throw new Error("--vault <PDA> is required");
  return { cluster, walletPath, vault, symbols, remove };
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
  const { cluster, walletPath, vault, symbols, remove } = parseArgs();
  const file = path.join(__dirname, `mvp-mints-${cluster}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} not found. Run \`bun scripts/mint-mvp-tokens.ts --cluster ${cluster}\` first.`
    );
  }
  const mints: MvpMintsFile = JSON.parse(fs.readFileSync(file, "utf-8"));
  const vaultState = new PublicKey(vault);

  const connection = new anchor.web3.Connection(clusterUrl(cluster), "confirmed");
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  anchor.setProvider(
    new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
      commitment: "confirmed",
    })
  );
  const program = anchor.workspace.myProject as Program<MyProject>;

  // Filter the token list. Default = all 12.
  const targets = symbols
    ? MVP_TOKEN_LIST.filter((t) => symbols.includes(t.symbol))
    : MVP_TOKEN_LIST;
  if (symbols && targets.length !== symbols.length) {
    const found = targets.map((t) => t.symbol);
    const missing = symbols.filter((s) => !found.includes(s));
    throw new Error(`Unknown symbol(s): ${missing.join(", ")}`);
  }

  console.log(`\n=== ${remove ? "Remove" : "Seed"} VaultAllowedToken (${cluster}) ===`);
  console.log(`Vault:       ${vaultState.toBase58()}`);
  console.log(`Admin:       ${admin.publicKey.toBase58()}`);
  console.log(`Mints file:  ${file}`);
  console.log(`Tokens:      ${targets.map((t) => t.symbol).join(", ")}\n`);

  let acted = 0;
  let skipped = 0;
  for (const t of targets) {
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
    const [vaultAllowedToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_allowed_token"), vaultState.toBuffer(), mint.toBuffer()],
      program.programId
    );
    const existing = await connection.getAccountInfo(vaultAllowedToken);

    if (remove) {
      if (!existing) {
        console.log(`  · ${t.symbol.padEnd(8)} not on vault list — skip`);
        skipped += 1;
        continue;
      }
      const sig = await program.methods
        .removeVaultAllowedToken(mint)
        .accountsStrict({
          admin: admin.publicKey,
          vaultState,
          vaultAllowedToken,
        })
        .rpc();
      acted += 1;
      console.log(`  ✓ ${t.symbol.padEnd(8)} removed — ${sig.slice(0, 12)}…`);
    } else {
      if (existing) {
        console.log(`  · ${t.symbol.padEnd(8)} already on vault list — skip`);
        skipped += 1;
        continue;
      }
      // Fail loudly if the protocol-level entry is missing — the
      // program would revert anyway, but a clearer error here saves
      // the user a tx.
      const protocolEntry = await connection.getAccountInfo(allowedToken);
      if (!protocolEntry) {
        console.warn(
          `  ! ${t.symbol.padEnd(8)} not on PROTOCOL list yet — run ` +
          `\`bun scripts/seed-allowed-tokens.ts\` first. Skip.`
        );
        skipped += 1;
        continue;
      }
      const sig = await program.methods
        .addVaultAllowedToken(mint)
        .accountsStrict({
          admin: admin.publicKey,
          vaultState,
          allowedToken,
          vaultAllowedToken,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      acted += 1;
      console.log(`  ✓ ${t.symbol.padEnd(8)} added — ${sig.slice(0, 12)}…`);
    }
  }

  console.log(
    `\nDone. ${remove ? "Removed" : "Added"} ${acted}, skipped ${skipped}.`
  );
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
