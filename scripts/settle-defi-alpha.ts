/**
 * settle-defi-alpha.ts — Crank every kind=2 mock-pyth feed referenced by
 * any active DeFi Alpha strategy's ValueSource registry, then call
 * `settle_strategy_value` per strategy. Both happen in the same script run
 * so the staleness check (default 60s) won't trip.
 *
 * Run from repo root:
 *   bun scripts/settle-defi-alpha.ts --wallet ./defi-alpha-admin.json
 *
 * Requires the wallet to be the vault authority (DhCA…Hike).
 *
 * Map of supported feeds: keyed by mock-pyth feed PDA. Add an entry here
 * when you allow-list a new mint on the protocol so the script can crank
 * its feed.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import type { MockPyth } from "../target/types/mock_pyth";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
const VAULT_ID = 4;
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const KEEPER_EXPO = -8;

// Feed mints we know how to crank. Extend as you allow-list new mints.
const KNOWN_MINTS: { mint: PublicKey; coingeckoId: string; label: string }[] = [
  { mint: new PublicKey("BApn44vuNabDPPmcoZ9SSEVu7kBAHsLGhAaDk6EQYtoP"), coingeckoId: "solana", label: "wSOL" },
  { mint: new PublicKey("5zfd1K5Z4Mp7UL1kkX2gdvtFeWispNd7AW79Wifk3sA9"), coingeckoId: "tether", label: "USDT" },
  { mint: new PublicKey("EA85kR8c9QDbK7Lmuzg3cjbbAHMRCKgofZTrMcgy59jp"), coingeckoId: "usd-coin", label: "USDC" },
  { mint: new PublicKey("8gyvY5BDxY7pYNnLFgh1YXgRFuxeNTZu1qWzcsuTTzXV"), coingeckoId: "weth", label: "wETH" },
  { mint: new PublicKey("35LEpQDEfCDN1P5A7avee2nq7kDcgSmxFw8ASGyj8SRc"), coingeckoId: "jupiter-exchange-solana", label: "JUP" },
  { mint: new PublicKey("GcvDs7U3XtUFNkn1DmMWijTUvn2zrxir8pPYsVzGV3y3"), coingeckoId: "jito-staked-sol", label: "jitoSOL" },
  { mint: new PublicKey("Et9BBsMFXYTMie2DrWQ3jUwsrMMDsTEDJjhpySbktVvX"), coingeckoId: "raydium", label: "RAY" },
  { mint: new PublicKey("G7nkqwtnmq3BL4rvzPRALbnJeFk4beE1qhVMM3pJXvHH"), coingeckoId: "msol", label: "mSOL" },
  { mint: new PublicKey("Hj3Tnp4iHZagYCth8knkmFQYeMuLcRxiNrqfCLNL87to"), coingeckoId: "bonk", label: "BONK" },
  { mint: new PublicKey("F9TnvVFNmqvHNB9LSmU5KFsh2hPhFhjydiLmzdoPYqfS"), coingeckoId: "dogwifcoin", label: "WIF" },
  { mint: new PublicKey("DzsuEFh3H9865qthqMTW54twpKT3rUYpMTsCjZ8hzq1N"), coingeckoId: "pyth-network", label: "PYTH" },
  { mint: new PublicKey("8dTktSDs2jRfd9bVw896EELPeqaHenudGCKtB9gBQgnf"), coingeckoId: "kamino", label: "KMNO" },
];

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}
function derivePriceFeedPda(programId: PublicKey, mint: PublicKey): PublicKey {
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
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf("--wallet");
  const walletPath = (flagIdx !== -1 ? argv[flagIdx + 1] : undefined) ?? process.env.WALLET ?? "./id.json";

  const conn = new anchor.web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadWallet(walletPath);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPyth = new anchor.Program<MockPyth>(
    JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8")) as never,
    provider,
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const v0 = await program.account.vaultState.fetch(vaultPda);
  console.log(`Vault: ${vaultPda.toBase58()}`);
  console.log(`Authority: ${v0.authority.toBase58()}`);
  console.log(`TVL before: ${Number(v0.totalDeposited) / 1e6} USDC`);
  if (!v0.authority.equals(payer.publicKey)) {
    console.error(`❌ wallet is not the vault authority. Use the right keypair (--wallet).`);
    process.exit(1);
  }

  // ── Discover which feed PDAs are actually referenced on this vault. ──
  const referencedFeeds = new Set<string>();
  type StratPlan = { id: number; sPda: PublicKey; allVs: { pda: PublicKey; target: PublicKey }[] };
  const strats: StratPlan[] = [];

  for (let id = 0; id < v0.strategyCount.toNumber(); id++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const sData = await program.account.strategyAllocation.fetch(sPda);
    if (!sData.isActive) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = (await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: sPda.toBase58() } },
    ])) as { publicKey: PublicKey; account: { kind: number; targetAccount: PublicKey } }[];
    for (const r of vsRows) {
      if (r.account.kind === 2) referencedFeeds.add(r.account.targetAccount.toBase58());
    }
    strats.push({
      id,
      sPda,
      allVs: vsRows.map((r) => ({ pda: r.publicKey, target: r.account.targetAccount })),
    });
  }
  console.log(`\nReferenced kind=2 feeds: ${referencedFeeds.size}`);

  // ── Crank every known feed that's referenced. Warn on unknown ones. ──
  const knownByFeed = new Map<string, (typeof KNOWN_MINTS)[number]>();
  for (const k of KNOWN_MINTS) knownByFeed.set(derivePriceFeedPda(MOCK_PYTH, k.mint).toBase58(), k);
  const unknown = [...referencedFeeds].filter((f) => !knownByFeed.has(f));
  if (unknown.length > 0) {
    console.warn(`⚠ unknown feed(s) referenced — script can't crank them, settle may stale-revert:`);
    for (const u of unknown) console.warn(`    ${u}`);
  }
  for (const f of referencedFeeds) {
    const known = knownByFeed.get(f);
    if (!known) continue;
    const px = await fetchPriceI64(known.coingeckoId);
    await mockPyth.methods
      .setPrice(new BN(px.toString()), KEEPER_EXPO)
      .accountsStrict({ payer: payer.publicKey, mint: known.mint, feed: new PublicKey(f) })
      .rpc();
    console.log(`  ${known.label} feed → $${(Number(px) / 1e8).toFixed(4)}`);
  }

  // ── Settle each strategy with all its ValueSources in remaining_accounts.
  console.log("\nSettling…");
  for (const s of strats) {
    const [strategyTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(s.id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const remaining = s.allVs.flatMap((vs) => [
      { pubkey: vs.pda, isSigner: false, isWritable: true },
      { pubkey: vs.target, isSigner: false, isWritable: false },
    ]);
    try {
      const sig = await program.methods
        .settleStrategyValue(new BN(s.id))
        .accountsStrict({
          authority: v0.authority,
          vaultState: vaultPda,
          strategy: s.sPda,
          strategyTokenAccount: strategyTokenPda,
        })
        .remainingAccounts(remaining)
        .rpc();
      console.log(`  ✓ s#${s.id}: ${sig.slice(0, 8)}…`);
    } catch (err) {
      console.error(`  ✗ s#${s.id}:`, (err as Error).message ?? err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logs = (err as any).logs ?? (err as any).transactionLogs;
      if (logs) for (const l of logs) console.error("    " + l);
      throw err;
    }
  }

  const v1 = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nTVL after: ${Number(v1.totalDeposited) / 1e6} USDC`);
  console.log(`Δ TVL:     ${(Number(v1.totalDeposited) - Number(v0.totalDeposited)) / 1e6} USDC`);
}

main().catch((e) => { console.error(e); process.exit(1); });
