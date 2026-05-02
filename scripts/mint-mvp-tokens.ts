/**
 * mint-mvp-tokens.ts — create 12 mock SPL mints on devnet representing
 * the MVP token list (wSOL, USDC, USDT, JUP, jitoSOL, RAY, mSOL, wETH,
 * BONK, WIF, PYTH, KMNO). Writes the resulting `symbol → mint` map to
 * `scripts/mvp-mints-<cluster>.json` so `seed-allowed-tokens.ts` can
 * reuse them.
 *
 * Idempotent: if the JSON already exists, missing symbols are minted
 * and merged in; existing entries are kept (we never silently rotate
 * a mint underneath the protocol allow-list).
 *
 * Usage:
 *   bun scripts/mint-mvp-tokens.ts                    # devnet, default wallet
 *   bun scripts/mint-mvp-tokens.ts --cluster localnet
 *   bun scripts/mint-mvp-tokens.ts --wallet ./id.json
 */

import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { MVP_TOKEN_LIST, MvpMintsFile } from "./mvp-token-list";

function parseArgs() {
  const a = process.argv.slice(2);
  let cluster = "devnet";
  let walletPath = "./id.json";
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--cluster") cluster = a[++i];
    else if (a[i] === "--wallet") walletPath = a[++i];
  }
  return { cluster, walletPath };
}

function clusterUrl(c: string): string {
  switch (c) {
    case "devnet":
      return "https://api.devnet.solana.com";
    case "mainnet":
      throw new Error(
        "mint-mvp-tokens.ts is for devnet/localnet only — on mainnet you'd point at real mints, not freshly minted mocks."
      );
    case "localnet":
      return "http://localhost:8899";
    default:
      throw new Error(`Unknown cluster: ${c}`);
  }
}

function jsonPath(cluster: string): string {
  return path.join(__dirname, `mvp-mints-${cluster}.json`);
}

async function main() {
  const { cluster, walletPath } = parseArgs();
  const url = clusterUrl(cluster);
  const connection = new anchor.web3.Connection(url, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const file = jsonPath(cluster);
  const existing: MvpMintsFile = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf-8"))
    : {};

  console.log(`\n=== Mint MVP tokens (${cluster}) ===`);
  console.log(`Payer:       ${payer.publicKey.toBase58()}`);
  console.log(`Output file: ${file}\n`);

  const balance = await connection.getBalance(payer.publicKey);
  const need = MVP_TOKEN_LIST.length * 0.0015e9; // ~1.5 mSOL per mint, conservative
  if (balance < need) {
    console.warn(
      `⚠ low balance: ${(balance / 1e9).toFixed(3)} SOL. Mint creation is ` +
      `~0.0015 SOL each → ~${(need / 1e9).toFixed(3)} SOL needed total.`
    );
  }

  let added = 0;
  for (const t of MVP_TOKEN_LIST) {
    if (existing[t.symbol]) {
      console.log(`  · ${t.symbol.padEnd(8)} already minted: ${existing[t.symbol]}`);
      continue;
    }
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey, // mint authority
      payer.publicKey, // freeze authority
      t.decimals
    );
    existing[t.symbol] = mint.toBase58();
    added += 1;
    console.log(`  ✓ ${t.symbol.padEnd(8)} ${mint.toBase58()} (decimals=${t.decimals})`);
    // Persist incrementally so a partial run isn't lost.
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  }

  console.log(`\nDone. ${added} new mint${added === 1 ? "" : "s"}, ${MVP_TOKEN_LIST.length} total.`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
