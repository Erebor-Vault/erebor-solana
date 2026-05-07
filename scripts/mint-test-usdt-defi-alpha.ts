/**
 * mint-test-usdt-defi-alpha.ts — Mint ~13.33 test-USDT per strategy
 * (≈ 40 total) into the DeFi Alpha vault, init+crank the test-USDT
 * mock-pyth feed, optionally settle.
 *
 * Run from repo root:
 *   bun scripts/mint-test-usdt-defi-alpha.ts --wallet ./defi-alpha-admin.json
 *
 * If the wallet matches the vault admin/authority, the script also runs
 * `settle_strategy_value` per strategy and prints the resulting TVL.
 * Otherwise it just mints + cranks (you click Settle in the UI).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import type { MockPyth } from "../target/types/mock_pyth";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
const VAULT_ID = 4;
const TEST_USDT = new PublicKey("5zfd1K5Z4Mp7UL1kkX2gdvtFeWispNd7AW79Wifk3sA9");
const TEST_WSOL = new PublicKey("BApn44vuNabDPPmcoZ9SSEVu7kBAHsLGhAaDk6EQYtoP");
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const PER_STRATEGY = 13_333_333; // 6 dp ⇒ 13.33 USDT per strategy
const KEEPER_EXPO = -8;

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
  return BigInt(Math.round(usd * 1e8)); // expo -8
}

async function main() {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf("--wallet");
  const walletPath = (flagIdx !== -1 ? argv[flagIdx + 1] : undefined) ?? process.env.WALLET ?? "./id.json";
  console.log(`Using keypair: ${walletPath}`);

  const conn = new anchor.web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadWallet(walletPath);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPyth = new anchor.Program<MockPyth>(
    JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8")) as never,
    provider,
  );

  // Verify we have mint authority for test USDT (otherwise we can't mint).
  const usdtMintInfo = await conn.getAccountInfo(TEST_USDT);
  if (!usdtMintInfo) throw new Error("test USDT mint not found");
  // Mint layout: bytes 0..36 = COption<Pubkey> mint_authority. Tag (4) then pubkey.
  const tag = usdtMintInfo.data.readUInt32LE(0);
  const mintAuth = tag === 1 ? new PublicKey(usdtMintInfo.data.subarray(4, 36)) : null;
  console.log(`USDT mint authority: ${mintAuth?.toBase58() ?? "(none)"}`);
  // If our keypair isn't the mint auth, we'll fail at mintTo below — surface
  // it loudly. (The wSOL/USDC test mints all live under the same keeper key.)

  // ── 1. Init + crank both relevant mock-pyth feeds (USDT + wSOL) ────────
  // settle walks ALL ValueSources for the strategy, so even feeds we're
  // not minting into here will revert with ValueSourcePythStale if they're
  // older than max_staleness_secs (60s by default).
  const feedPda = derivePriceFeedPda(MOCK_PYTH, TEST_USDT);
  async function crank(mint: PublicKey, coingeckoId: string, label: string) {
    const fpda = derivePriceFeedPda(MOCK_PYTH, mint);
    if (!(await conn.getAccountInfo(fpda))) {
      console.log(`\nInitializing ${label} mock-pyth feed at ${fpda.toBase58()}…`);
      await mockPyth.methods
        .initializeFeed(new BN(100_000_000), KEEPER_EXPO)
        .accountsStrict({ payer: payer.publicKey, mint, feed: fpda, systemProgram: SystemProgram.programId })
        .rpc();
    }
    const px = await fetchPriceI64(coingeckoId);
    await mockPyth.methods
      .setPrice(new BN(px.toString()), KEEPER_EXPO)
      .accountsStrict({ payer: payer.publicKey, mint, feed: fpda })
      .rpc();
    console.log(`  ${label} feed → $${(Number(px) / 1e8).toFixed(4)}`);
  }
  console.log("\nCranking feeds…");
  await crank(TEST_USDT, "tether", "USDT");
  await crank(TEST_WSOL, "solana", "wSOL");

  // ── 2. Vault state + per-strategy work ────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const v0 = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nVault: ${vaultPda.toBase58()}`);
  console.log(`Authority: ${v0.authority.toBase58()}`);
  console.log(`TVL before: ${Number(v0.totalDeposited) / 1e6} USDC`);
  const isAuthority = v0.authority.equals(payer.publicKey);

  type Plan = {
    strategyId: number;
    strategyPda: PublicKey;
    sAuth: PublicKey;
    ata: PublicKey;
    balanceVsPda?: PublicKey;
    pythVsPda?: PublicKey;
    /** All ValueSources on this strategy (used to feed settle's remaining_accounts). */
    allVs: { pda: PublicKey; target: PublicKey }[];
  };
  const plans: Plan[] = [];

  for (let id = 0; id < v0.strategyCount.toNumber(); id++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const sData = await program.account.strategyAllocation.fetch(sPda);
    if (!sData.isActive) continue;
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ata = getAssociatedTokenAddressSync(TEST_USDT, sAuth, true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = (await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: sPda.toBase58() } },
    ])) as { publicKey: PublicKey; account: { index: number; kind: number; targetAccount: PublicKey } }[];

    const balanceRow = vsRows.find((r) => r.account.kind === 0 && r.account.targetAccount.equals(ata));
    const pythRow = vsRows.find((r) => r.account.kind === 2 && r.account.targetAccount.equals(feedPda));
    if (!balanceRow || !pythRow) {
      console.log(
        `\n⚠ Strategy #${id}: missing USDT ValueSource pair ` +
          `(balance=${!!balanceRow}, pyth=${!!pythRow}). ` +
          `Make sure USDT was just toggled ON in the dApp's Allowed Tokens panel; ` +
          `the auto-add must have failed.`,
      );
      continue;
    }
    plans.push({
      strategyId: id,
      strategyPda: sPda,
      sAuth,
      ata,
      balanceVsPda: balanceRow.publicKey,
      pythVsPda: pythRow.publicKey,
      allVs: vsRows.map((r) => ({ pda: r.publicKey, target: r.account.targetAccount })),
    });
  }
  if (plans.length === 0) {
    console.error("No strategies have a USDT ValueSource pair. Toggle USDT on in the dApp first.");
    process.exit(1);
  }

  // ── 3. Mint test-USDT into each strategy's authority ATA ──────────────
  console.log("\nMinting test-USDT into strategy authorities…");
  for (const p of plans) {
    const acct = await getOrCreateAssociatedTokenAccount(conn, payer, TEST_USDT, p.sAuth, true);
    const before = Number((await getAccount(conn, acct.address)).amount);
    await mintTo(conn, payer, TEST_USDT, acct.address, payer, PER_STRATEGY);
    const after = Number((await getAccount(conn, acct.address)).amount);
    console.log(`  s#${p.strategyId}: ${(before / 1e6).toFixed(2)} → ${(after / 1e6).toFixed(2)} USDT`);
  }

  // ── 4. Settle if we hold the authority ─────────────────────────────────
  if (!isAuthority) {
    console.log("\nKeeper is not the vault authority — click Settle in the dApp to update TVL.");
    return;
  }

  // Re-crank both feeds right before settle so the staleness check passes.
  console.log("\nRe-cranking feeds…");
  await crank(TEST_USDT, "tether", "USDT");
  await crank(TEST_WSOL, "solana", "wSOL");

  console.log("\nSettling…");
  for (const p of plans) {
    const [strategyTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(p.strategyId).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const remaining = p.allVs.flatMap((vs) => [
      { pubkey: vs.pda, isSigner: false, isWritable: true },
      { pubkey: vs.target, isSigner: false, isWritable: false },
    ]);
    try {
      const sig = await program.methods
        .settleStrategyValue(new BN(p.strategyId))
        .accountsStrict({
          authority: v0.authority,
          vaultState: vaultPda,
          strategy: p.strategyPda,
          strategyTokenAccount: strategyTokenPda,
        })
        .remainingAccounts(remaining)
        .rpc();
      console.log(`  ✓ s#${p.strategyId}: ${sig.slice(0, 8)}…`);
    } catch (err) {
      console.error(`  ✗ s#${p.strategyId}:`, (err as Error).message ?? err);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
