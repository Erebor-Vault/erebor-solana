/**
 * bootstrap-test-wsol-defi-alpha.ts — Make the *test* wSOL mint
 * (BApn44…YtoP, 9 dp — what the dApp labels "wSOL") visible inside the
 * DeFi Alpha vault's `settle_strategy_value` accounting.
 *
 * Why a separate script from `bootstrap-wsol-defi-alpha.ts`: that one
 * targeted native wSOL (`So11…1112`), but the dApp's allow-list and panel
 * labels all use the test mint instead.
 *
 * Keeper actions (id.json — payer + mint authority + mock_pyth payer):
 *   1. initialize_feed      — [b"price", BApn…YtoP] under mock_pyth (idempotent)
 *   2. set_price            — push fresh SOL/USD from CoinGecko
 *   3. mintTo               — small amount of test-wSOL into each active
 *                             strategy_authority[i]'s test-wSOL ATA
 *
 * Admin actions (printed for DhCA…Hike to sign):
 *   4. remove_value_source  — for any duplicate ValueSource rows the
 *                             pre-fix buggy slot allocator created
 *   5. settle_strategy_value — folds the new contribution into TVL
 *
 * Run from repo root:
 *   bun scripts/bootstrap-test-wsol-defi-alpha.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import type { MockPyth } from "../target/types/mock_pyth";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// ---- Config ----
const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE"); // DeFi Alpha underlying (USDC, 6 dp)
const VAULT_ID = 4;
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const TEST_WSOL = new PublicKey("BApn44vuNabDPPmcoZ9SSEVu7kBAHsLGhAaDk6EQYtoP");
const TEST_WSOL_DECIMALS = 9;
const UNDERLYING_DECIMALS = 6;
const PER_STRATEGY_AMOUNT = 50_000_000; // 0.05 test-wSOL (yield-tick scale)
const KEEPER_EXPO = -8;
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

function derivePriceFeedPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("price"), mint.toBuffer()], programId)[0];
}

async function fetchSolUsd(): Promise<bigint> {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const j = (await r.json()) as { solana?: { usd?: number } };
  if (typeof j.solana?.usd !== "number") throw new Error("no SOL price");
  return BigInt(Math.round(j.solana.usd * 1e8));
}

async function confirm(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
}

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPythIdl = JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8"));
  const mockPyth = new anchor.Program<MockPyth>(mockPythIdl as never, provider);

  console.log("=== Bootstrap test-wSOL pricing for DeFi Alpha ===");
  console.log(`Payer:      ${payer.publicKey.toBase58()}`);
  console.log(`Test wSOL:  ${TEST_WSOL.toBase58()} (${TEST_WSOL_DECIMALS} dp)`);

  // ---- 1+2. Mock-Pyth feed init + crank --------------------------------
  const feedPda = derivePriceFeedPda(MOCK_PYTH, TEST_WSOL);
  console.log(`\nFeed PDA: ${feedPda.toBase58()}`);
  const feedInfo = await connection.getAccountInfo(feedPda);
  if (!feedInfo) {
    console.log("  initialize_feed at $1.00…");
    await mockPyth.methods
      .initializeFeed(new BN(100_000_000), KEEPER_EXPO)
      .accountsStrict({
        payer: payer.publicKey,
        mint: TEST_WSOL,
        feed: feedPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("  feed already initialised");
  }
  const priceI64 = await fetchSolUsd();
  console.log(`  set_price → $${(Number(priceI64) / 1e8).toFixed(2)} (CoinGecko)`);
  await mockPyth.methods
    .setPrice(new BN(priceI64.toString()), KEEPER_EXPO)
    .accountsStrict({ payer: payer.publicKey, mint: TEST_WSOL, feed: feedPda })
    .rpc();
  console.log("  ✓ feed initialised + priced");

  // ---- Vault state ------------------------------------------------------
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nVault PDA:  ${vaultPda.toBase58()}`);
  console.log(`Authority:  ${vault.authority.toBase58()}`);
  console.log(`TVL before: ${Number(vault.totalDeposited) / 1e6} USDC`);
  const isAuthority = vault.authority.equals(payer.publicKey);

  const adminCleanupIxs: { strategyId: number; ix: TransactionInstruction; description: string }[] = [];
  const settleIxs: { strategyId: number; ix: TransactionInstruction }[] = [];

  for (let id = 0; id < vault.strategyCount.toNumber(); id++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const sData = await program.account.strategyAllocation.fetch(sPda);
    if (!sData.isActive) {
      console.log(`\nStrategy #${id}: inactive — skip`);
      continue;
    }
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ata = getAssociatedTokenAddressSync(TEST_WSOL, sAuth, true);

    // ---- 3. mint test-wSOL into the strategy authority's ATA -----------
    const ataAcct = await getOrCreateAssociatedTokenAccount(connection, payer, TEST_WSOL, sAuth, true);
    const balBefore = Number((await getAccount(connection, ata)).amount);
    const mintSig = await mintTo(connection, payer, TEST_WSOL, ataAcct.address, payer, PER_STRATEGY_AMOUNT);
    await confirm(connection, mintSig);
    const balAfter = Number((await getAccount(connection, ata)).amount);
    console.log(`\nStrategy #${id}`);
    console.log(`  authority: ${sAuth.toBase58()}`);
    console.log(`  test-wSOL ATA: ${ata.toBase58()}  ${balBefore / 1e9} → ${balAfter / 1e9}`);

    // ---- 4. inspect ValueSources, find dups ---------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: sPda.toBase58() } },
    ]);
    type Row = { publicKey: PublicKey; account: { index: number; kind: number; targetAccount: PublicKey; mintBalanceSourceIndex: number } };
    const all = vsRows as Row[];
    const balRows = all.filter((r) => r.account.kind === 0 && r.account.targetAccount.equals(ata)).sort((a, b) => a.account.index - b.account.index);
    const pythRows = all.filter((r) => r.account.kind === 2 && r.account.targetAccount.equals(feedPda)).sort((a, b) => a.account.index - b.account.index);
    console.log(`  test-wSOL balance sources: ${balRows.length}`);
    console.log(`  test-wSOL pyth sources:    ${pythRows.length}`);

    // Keep the lowest-indexed row of each pair; flag the rest for removal.
    const keepBal = balRows[0];
    const keepPyth = pythRows[0];
    if (!keepBal || !keepPyth) {
      console.log(`  ⚠ strategy is missing the wSOL ValueSource pair — re-toggle wSOL in the UI for this vault, then re-run.`);
      continue;
    }
    for (const r of balRows.slice(1).concat(pythRows.slice(1))) {
      adminCleanupIxs.push({
        strategyId: id,
        description: `remove_value_source slot ${r.account.index} (duplicate ${r.account.kind === 0 ? "balance" : "pyth"})`,
        ix: await program.methods
          .removeValueSource(sData.strategyId, r.account.index)
          .accountsStrict({
            admin: vault.admin,
            vaultState: vaultPda,
            strategy: sPda,
            valueSource: r.publicKey,
          })
          .instruction(),
      });
    }

    // Build the settle ix — remaining_accounts must be (vs_pda, target) pairs
    // for every ValueSource we want to score in this call. We score JUST the
    // surviving pair (others have already been booked or are duplicates).
    const remaining = [
      { pubkey: keepBal.publicKey, isSigner: false, isWritable: true },
      { pubkey: keepBal.account.targetAccount, isSigner: false, isWritable: false },
      { pubkey: keepPyth.publicKey, isSigner: false, isWritable: true },
      { pubkey: keepPyth.account.targetAccount, isSigner: false, isWritable: false },
    ];
    const [strategyTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    settleIxs.push({
      strategyId: id,
      ix: await program.methods
        .settleStrategyValue(sData.strategyId)
        .accountsStrict({
          authority: vault.authority,
          vaultState: vaultPda,
          strategy: sPda,
          strategyTokenAccount: strategyTokenPda,
        })
        .remainingAccounts(remaining)
        .instruction(),
    });
  }

  // ---- 5. Send admin/authority ixs if id.json owns the role ----------
  console.log("\n=== Admin / authority instructions ===");
  if (adminCleanupIxs.length === 0 && settleIxs.length === 0) {
    console.log("(nothing queued)");
    return;
  }
  if (vault.admin.equals(payer.publicKey) || isAuthority) {
    for (const { ix, description } of adminCleanupIxs) {
      const sig = await provider.sendAndConfirm(new Transaction().add(ix));
      console.log(`✓ admin: ${description}  (${sig.slice(0, 8)}…)`);
    }
    for (const { strategyId, ix } of settleIxs) {
      const sig = await provider.sendAndConfirm(new Transaction().add(ix));
      console.log(`✓ authority: settle_strategy_value strategy #${strategyId}  (${sig.slice(0, 8)}…)`);
    }
    const after = await program.account.vaultState.fetch(vaultPda);
    console.log(`\nTVL after: ${Number(after.totalDeposited) / 1e6} USDC`);
  } else {
    console.log(`Payer is not the admin or authority. Hand the following ixs to ${vault.admin.toBase58()}:\n`);
    for (const { strategyId, description, ix } of adminCleanupIxs) {
      console.log(`  Strategy #${strategyId}: ${description}`);
      console.log(`    programId: ${ix.programId.toBase58()}, ${ix.keys.length} accounts`);
      console.log(`    data:      ${ix.data.toString("base64")}\n`);
    }
    for (const { strategyId, ix } of settleIxs) {
      console.log(`  Strategy #${strategyId}: settle_strategy_value`);
      console.log(`    programId: ${ix.programId.toBase58()}, ${ix.keys.length} accounts`);
      console.log(`    data:      ${ix.data.toString("base64")}\n`);
    }
    console.log("After signing the cleanup + settle ixs, vault.total_deposited should jump by");
    console.log(`  ${(PER_STRATEGY_AMOUNT / 1e9).toFixed(2)} SOL × $price × n_strategies (≈ in USDC raw via 1/1000 scale).`);
  }
}

main().catch((e) => {
  console.error("\nFailed:", e.message ?? e);
  process.exit(1);
});
