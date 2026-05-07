/**
 * bootstrap-wsol-defi-alpha.ts — Make wSOL visible inside the DeFi Alpha
 * vault's `settle_strategy_value` accounting end-to-end.
 *
 * What the script can do with the keeper key (id.json, mint authority):
 *   1. initialize_feed    — creates [b"price", wSOL] under mock_pyth at $1.
 *   2. set_price          — pushes a fresh SOL/USD from CoinGecko (expo=-8).
 *   3. inspect strategies — checks each DeFi Alpha strategy for existing
 *      ValueSource entries pointing at the wSOL ATA / wSOL feed PDA.
 *
 * What requires the vault admin (DhCA…Hike) — printed as ready-to-sign
 * instruction blobs at the end:
 *   4. add_value_source  ×2 per strategy (slot A: kind=0 wSOL ATA balance,
 *      slot B: kind=2 wSOL/USD Pyth feed, mint_balance_source_index = A,
 *      scale 1/1000 to convert 9-dp wSOL into 6-dp USDC).
 *   5. settle_strategy_value per strategy (folds the new contribution into
 *      `strategy.allocated_amount` + `vault.total_deposited`).
 *
 * Run from repo root:
 *   bun scripts/bootstrap-wsol-defi-alpha.ts
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
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// ---- Config ----
const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE"); // DeFi Alpha underlying (USDC, 6 dp)
const VAULT_ID = 4;
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const KEEPER_EXPO = -8;
const PYTH_MAX_STALENESS_SECS = 60;
const UNDERLYING_DECIMALS = 6; // USDC
const WSOL_DECIMALS = 9;

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
  const usd = j.solana?.usd;
  if (typeof usd !== "number") throw new Error("CoinGecko returned no SOL price");
  return BigInt(Math.round(usd * 1e8));
}

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPythIdl = JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8"));
  const mockPyth = new anchor.Program<MockPyth>(mockPythIdl as never, provider);

  console.log("=== Bootstrap wSOL pricing for DeFi Alpha ===");
  console.log(`Payer:        ${payer.publicKey.toBase58()}`);
  console.log(`Underlying:   ${TOKEN_MINT.toBase58()} (USDC, ${UNDERLYING_DECIMALS} dp)`);
  console.log(`wSOL mint:    ${NATIVE_MINT.toBase58()} (${WSOL_DECIMALS} dp)\n`);

  // 1. Initialize / update the wSOL mock-Pyth feed.
  const feedPda = derivePriceFeedPda(MOCK_PYTH, NATIVE_MINT);
  console.log(`wSOL feed PDA: ${feedPda.toBase58()}`);
  const feedInfo = await connection.getAccountInfo(feedPda);
  if (!feedInfo) {
    console.log("  feed missing — calling initialize_feed at $1.00…");
    await mockPyth.methods
      .initializeFeed(new BN(100_000_000), KEEPER_EXPO)
      .accountsStrict({
        payer: payer.publicKey,
        mint: NATIVE_MINT,
        feed: feedPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("  feed already initialised");
  }

  const priceI64 = await fetchSolUsd();
  console.log(`  pushing SOL/USD = $${(Number(priceI64) / 1e8).toFixed(2)}`);
  await mockPyth.methods
    .setPrice(new BN(priceI64.toString()), KEEPER_EXPO)
    .accountsStrict({ payer: payer.publicKey, mint: NATIVE_MINT, feed: feedPda })
    .rpc();
  console.log("  ✓ feed initialised + priced\n");

  // 2. Inspect strategies; build admin-side ixs for missing ValueSource rows.
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log(`Vault PDA:  ${vaultPda.toBase58()}`);
  console.log(`Admin:      ${vault.admin.toBase58()}`);
  console.log(`Authority:  ${vault.authority.toBase58()}\n`);

  const adminIxs: { strategyId: number; ix: TransactionInstruction; description: string }[] = [];

  for (let id = 0; id < vault.strategyCount.toNumber(); id++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const sData = await program.account.strategyAllocation.fetch(sPda);
    if (!sData.isActive) {
      console.log(`Strategy #${id}: inactive — skip`);
      continue;
    }
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, sAuth, true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: sPda.toBase58() } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const used = new Set<number>(vsRows.map((r: any) => r.account.index as number));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const haveBalance = vsRows.find((r: any) =>
      (r.account.targetAccount as PublicKey).equals(wsolAta),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const havePyth = vsRows.find((r: any) =>
      (r.account.targetAccount as PublicKey).equals(feedPda),
    );

    const allocSlot = (): number => {
      for (let i = 0; i < 16; i++) if (!used.has(i)) { used.add(i); return i; }
      throw new Error(`strategy #${id}: all 16 ValueSource slots are used`);
    };

    let balanceSlot: number;
    if (haveBalance) {
      balanceSlot = haveBalance.account.index as number;
      console.log(`Strategy #${id}: balance source already present at slot ${balanceSlot}`);
    } else {
      balanceSlot = allocSlot();
      const [vsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("value_source"), sPda.toBuffer(), Uint8Array.of(balanceSlot)],
        program.programId,
      );
      const ix = await program.methods
        .addValueSource(
          new BN(id), balanceSlot, 0, wsolAta, new BN(0), new BN(0), new BN(1), 0, 0,
        )
        .accountsStrict({
          admin: vault.admin,
          vaultState: vaultPda,
          strategy: sPda,
          valueSource: vsPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      adminIxs.push({
        strategyId: id,
        ix,
        description: `add_value_source kind=0 (wSOL ATA balance) at slot ${balanceSlot}`,
      });
      console.log(`Strategy #${id}: queued kind=0 source at slot ${balanceSlot} (target ${wsolAta.toBase58()})`);
    }

    if (havePyth) {
      console.log(`Strategy #${id}: pyth source already present at slot ${havePyth.account.index}`);
    } else {
      const pythSlot = allocSlot();
      const [vsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("value_source"), sPda.toBuffer(), Uint8Array.of(pythSlot)],
        program.programId,
      );
      // scale: 9-dp wSOL × USD-price → 6-dp USDC ⇒ scale 1 / 10^(9-6) = 1/1000
      const num = new BN(1);
      const den = new BN(10).pow(new BN(WSOL_DECIMALS - UNDERLYING_DECIMALS));
      const ix = await program.methods
        .addValueSource(
          new BN(id), pythSlot, 2, feedPda, new BN(0), num, den, balanceSlot, PYTH_MAX_STALENESS_SECS,
        )
        .accountsStrict({
          admin: vault.admin,
          vaultState: vaultPda,
          strategy: sPda,
          valueSource: vsPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      adminIxs.push({
        strategyId: id,
        ix,
        description: `add_value_source kind=2 (Pyth wSOL/USD) at slot ${pythSlot}, mint_balance_source_index=${balanceSlot}, scale 1/${den.toString()}`,
      });
      console.log(`Strategy #${id}: queued kind=2 pyth source at slot ${pythSlot} (feed ${feedPda.toBase58()})`);
    }
  }

  // 3. Execute admin ixs only if id.json IS the vault admin; otherwise print.
  console.log();
  if (adminIxs.length === 0) {
    console.log("No admin instructions needed — strategies already wired.");
  } else if (vault.admin.equals(payer.publicKey)) {
    console.log(`Executing ${adminIxs.length} admin ix(s) under payer (= vault admin)…`);
    for (const { ix, description } of adminIxs) {
      const tx = new Transaction().add(ix);
      const sig = await provider.sendAndConfirm(tx);
      console.log(`  ✓ ${description}  (${sig.slice(0, 8)}…)`);
    }
  } else {
    console.log(`Payer is not the vault admin (${vault.admin.toBase58()}).`);
    console.log("Hand the following ixs to the admin wallet (one tx each, or batched):\n");
    for (const { strategyId, description, ix } of adminIxs) {
      console.log(`  Strategy #${strategyId}: ${description}`);
      console.log(`    programId: ${ix.programId.toBase58()}`);
      console.log(`    keys:      ${ix.keys.length} accounts`);
      console.log(`    data:      ${ix.data.toString("base64")}\n`);
    }
    console.log("After signing those, the admin should also call settle_strategy_value per strategy");
    console.log("(authority-signed) — that's what books the new contribution into TVL.");
  }
}

main().catch((e) => {
  console.error("\nFailed:", e.message ?? e);
  process.exit(1);
});
