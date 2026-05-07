/**
 * mint-test-token-defi-alpha.ts — Generic helper to:
 *   1. init+crank a test mint's mock-pyth feed
 *   2. mint a fixed per-strategy amount into each active strategy's
 *      `(mint, strategy_authority[i])` ATA
 * The dApp's auto-add must have already created the kind=0 + kind=2
 * ValueSources for the mint when the admin toggled it on (otherwise the
 * Token mix panel and `settle_strategy_value` won't see the balance).
 *
 * Usage:
 *   bun scripts/mint-test-token-defi-alpha.ts \
 *       --mint <BASE58> --coingecko <id> [--amount-human 0.05] \
 *       --wallet ./id.json
 *
 * The keeper key (id.json) is the mint authority for every test mint
 * created by `setup-multi-vaults.ts`, so use that here regardless of the
 * vault admin.
 */
import * as anchor from "@coral-xyz/anchor";
import type { MockPyth } from "../target/types/mock_pyth";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";

const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
const VAULT_ID = 4;
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const KEEPER_EXPO = -8;

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function loadWallet(p: string) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}
function derivePriceFeedPda(programId: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("price"), mint.toBuffer()], programId)[0];
}
async function fetchPriceI64(coingeckoId: string): Promise<bigint> {
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`);
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const j = (await r.json()) as Record<string, { usd?: number }>;
  const usd = j[coingeckoId]?.usd;
  if (typeof usd !== "number") throw new Error(`no ${coingeckoId} price`);
  return BigInt(Math.round(usd * 1e8));
}

async function main() {
  const mintB58 = getArg("mint");
  const coingeckoId = getArg("coingecko");
  const amountHumanStr = getArg("amount-human") ?? "0.05";
  const walletPath = getArg("wallet") ?? process.env.WALLET ?? "./id.json";
  if (!mintB58 || !coingeckoId) {
    console.error("usage: --mint <BASE58> --coingecko <id> [--amount-human 0.05] [--wallet path]");
    process.exit(2);
  }
  const mint = new PublicKey(mintB58);

  const conn = new anchor.web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadWallet(walletPath);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPyth = new anchor.Program<MockPyth>(
    JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8")) as never,
    provider,
  );

  // Verify mint + read decimals.
  const mintInfo = await conn.getAccountInfo(mint);
  if (!mintInfo) throw new Error(`mint ${mintB58} not found`);
  const decimals = mintInfo.data[44];
  const mintAuth =
    mintInfo.data.readUInt32LE(0) === 1
      ? new PublicKey(mintInfo.data.subarray(4, 36))
      : null;
  console.log(`mint ${mintB58} (${decimals} dp), authority=${mintAuth?.toBase58() ?? "(none)"}`);
  if (!mintAuth?.equals(payer.publicKey)) {
    console.error(`payer ${payer.publicKey.toBase58()} is not the mint authority`);
    process.exit(1);
  }

  const amountRaw = BigInt(Math.round(Number(amountHumanStr) * 10 ** decimals));
  console.log(`per-strategy amount: ${amountHumanStr} (${amountRaw} raw)`);

  // ── 1. init+crank feed ────────────────────────────────────────────────
  const feedPda = derivePriceFeedPda(MOCK_PYTH, mint);
  if (!(await conn.getAccountInfo(feedPda))) {
    console.log(`init mock-pyth feed at ${feedPda.toBase58()}…`);
    await mockPyth.methods
      .initializeFeed(new BN(100_000_000), KEEPER_EXPO)
      .accountsStrict({ payer: payer.publicKey, mint, feed: feedPda, systemProgram: SystemProgram.programId })
      .rpc();
  }
  const px = await fetchPriceI64(coingeckoId);
  await mockPyth.methods
    .setPrice(new BN(px.toString()), KEEPER_EXPO)
    .accountsStrict({ payer: payer.publicKey, mint, feed: feedPda })
    .rpc();
  console.log(`feed primed at $${(Number(px) / 1e8).toFixed(2)}`);

  // ── 2. mint into each strategy authority's ATA ────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const v = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nVault: ${vaultPda.toBase58()}`);
  for (let id = 0; id < v.strategyCount.toNumber(); id++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const sData = await program.account.strategyAllocation.fetch(sPda);
    if (!sData.isActive) { console.log(`  s#${id} inactive — skip`); continue; }
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ata = getAssociatedTokenAddressSync(mint, sAuth, true);
    await getOrCreateAssociatedTokenAccount(conn, payer, mint, sAuth, true);
    const before = Number((await getAccount(conn, ata)).amount);
    await mintTo(conn, payer, mint, ata, payer, Number(amountRaw));
    const after = Number((await getAccount(conn, ata)).amount);
    console.log(`  s#${id}: ${(before / 10 ** decimals).toFixed(4)} → ${(after / 10 ** decimals).toFixed(4)}`);
  }

  console.log("\nDone. Click Settle in the dApp (or run scripts/settle-defi-alpha.ts) to update TVL.");
}

main().catch((e) => { console.error(e); process.exit(1); });
