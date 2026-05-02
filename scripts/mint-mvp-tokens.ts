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
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { MVP_TOKEN_LIST, MvpMintsFile } from "./mvp-token-list";
import {
  createMetadataAccountV3Instruction,
  deriveMetadataPda,
} from "./metaplex-metadata";

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
    if (!existing[t.symbol]) {
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
      fs.writeFileSync(file, JSON.stringify(existing, null, 2));
    } else {
      console.log(`  · ${t.symbol.padEnd(8)} already minted: ${existing[t.symbol]}`);
    }
  }

  console.log(`\n${added} new mint${added === 1 ? "" : "s"}, ${MVP_TOKEN_LIST.length} total.`);

  // Pass 2: create Metaplex Token Metadata for any mint missing it. The
  // frontend reads these to resolve mint → symbol on-chain (no env-var
  // dependency). Idempotent: each metadata PDA's existence is checked
  // before submitting the create ix.
  console.log(`\n=== Metaplex metadata pass ===`);
  let metadataWritten = 0;
  for (const t of MVP_TOKEN_LIST) {
    const mintStr = existing[t.symbol];
    if (!mintStr) continue;
    const mint = new PublicKey(mintStr);
    const metadataPda = deriveMetadataPda(mint);
    const existingMetadata = await connection.getAccountInfo(metadataPda);
    if (existingMetadata) {
      console.log(`  · ${t.symbol.padEnd(8)} metadata exists`);
      continue;
    }
    const ix = createMetadataAccountV3Instruction({
      metadata: metadataPda,
      mint,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
      name: `${t.symbol} (devnet mock)`,
      symbol: t.symbol,
      uri: "",
    });
    const tx = new Transaction().add(ix);
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });
      metadataWritten += 1;
      console.log(`  ✓ ${t.symbol.padEnd(8)} metadata — ${sig.slice(0, 12)}…`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ! ${t.symbol.padEnd(8)} metadata failed: ${msg.slice(0, 120)}`);
    }
  }
  console.log(
    `${metadataWritten} new metadata account${metadataWritten === 1 ? "" : "s"} written.`
  );

  // Emit a paste-ready env line so the frontend can resolve mint → symbol.
  // The frontend reads `NEXT_PUBLIC_TOKEN_SYMBOLS` (a JSON map) at runtime
  // and the per-vault / protocol allow-list panels use it for display.
  const symbolMap: Record<string, string> = {};
  for (const t of MVP_TOKEN_LIST) {
    const m = existing[t.symbol];
    if (m) symbolMap[m] = t.symbol;
  }
  const envLine = `NEXT_PUBLIC_TOKEN_SYMBOLS='${JSON.stringify(symbolMap)}'`;

  console.log(`\n--- Frontend env (${cluster}) ---`);
  console.log(`Paste into app/.env.local so the admin panels show symbols`);
  console.log(`instead of bare mint addresses, then restart \`bun run dev\`:\n`);
  console.log(envLine);
  console.log("");
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
