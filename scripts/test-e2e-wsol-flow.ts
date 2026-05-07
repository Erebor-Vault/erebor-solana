/**
 * test-e2e-wsol-flow.ts — End-to-end test of the wSOL allow-list →
 * value-source → settle flow on a vault we control fully (admin AND
 * authority = id.json on vaults 0..3).
 *
 * Steps:
 *   1. Pick a vault (default v3 Stablecoin Yield) and the test-wSOL
 *      mint (BApn…YtoP, the dApp-labeled "wSOL").
 *   2. Mirror the frontend `applyDiff` add path: addVaultAllowedToken
 *      + per-strategy createATA + addValueSource (kind=0 + kind=2).
 *   3. Mint a small amount of test-wSOL into each strategy authority's ATA.
 *   4. Call settle_strategy_value with remaining_accounts = the new
 *      (vs_pda, target) pairs.
 *   5. Print TVL before/after — should increase by
 *      `n_strategies × 0.05 SOL × $price / 1000` USDC raw.
 *
 * Run from repo root:
 *   bun scripts/test-e2e-wsol-flow.ts [vault_id]
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
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
const TEST_WSOL = new PublicKey("BApn44vuNabDPPmcoZ9SSEVu7kBAHsLGhAaDk6EQYtoP");
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const PER_STRATEGY = 50_000_000; // 0.05 test-wSOL
const KEEPER_EXPO = -8;
const PYTH_MAX_STALENESS_SECS = 60;

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

async function main() {
  const vaultId = Number(process.argv[2] ?? "3");
  const conn = new anchor.web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadWallet("./id.json");
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPyth = new anchor.Program<MockPyth>(
    JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8")) as never,
    provider,
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(vaultId).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const v0 = await program.account.vaultState.fetch(vaultPda);
  console.log(`Vault v${vaultId}: ${vaultPda.toBase58()}`);
  console.log(`Admin/Authority: ${v0.admin.toBase58()} / ${v0.authority.toBase58()}`);
  if (!v0.admin.equals(payer.publicKey) || !v0.authority.equals(payer.publicKey)) {
    throw new Error("payer must be admin AND authority for this script");
  }
  console.log(`TVL before: ${Number(v0.totalDeposited) / 1e6} USDC`);

  // ── 0. Make sure mock-pyth feed for test-wSOL is initialised + fresh ──
  const feedPda = derivePriceFeedPda(MOCK_PYTH, TEST_WSOL);
  if (!(await conn.getAccountInfo(feedPda))) {
    console.log("\n[init] mock_pyth feed for test-wSOL");
    await mockPyth.methods
      .initializeFeed(new BN(100_000_000), KEEPER_EXPO)
      .accountsStrict({ payer: payer.publicKey, mint: TEST_WSOL, feed: feedPda, systemProgram: SystemProgram.programId })
      .rpc();
  }
  const priceI64 = await fetchSolUsd();
  await mockPyth.methods
    .setPrice(new BN(priceI64.toString()), KEEPER_EXPO)
    .accountsStrict({ payer: payer.publicKey, mint: TEST_WSOL, feed: feedPda })
    .rpc();
  console.log(`Feed primed at $${(Number(priceI64) / 1e8).toFixed(2)}`);

  // ── 1. Toggle path: addVaultAllowedToken + per-strategy ATA + sources ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enabledRows = await (program.account as any).vaultAllowedToken.all([
    { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alreadyEnabled = (enabledRows as any[]).some((r) => (r.account.mint as PublicKey).equals(TEST_WSOL));
  if (alreadyEnabled) {
    console.log("\nTest-wSOL already enabled on this vault — skipping addVaultAllowedToken.");
  }

  // Active strategies + slot bitmap
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strats = await (program.account as any).strategyAllocation.all([
    { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
  ]);
  const active = strats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s.account.isActive)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({ pubkey: s.publicKey as PublicKey, id: s.account.strategyId as BN }));
  console.log(`\nActive strategies: ${active.length}`);

  type RowsByStrat = Map<string, { used: Set<number>; balance?: { pda: PublicKey; index: number }; pyth?: { pda: PublicKey; index: number; balanceIdx: number } }>;
  const state: RowsByStrat = new Map();
  for (const s of active) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: s.pubkey.toBase58() } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const used = new Set<number>(vsRows.map((r: any) => r.account.index as number));
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), s.id.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ata = getAssociatedTokenAddressSync(TEST_WSOL, sAuth, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balRow = vsRows.find((r: any) => r.account.kind === 0 && (r.account.targetAccount as PublicKey).equals(ata));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pythRow = vsRows.find((r: any) => r.account.kind === 2 && (r.account.targetAccount as PublicKey).equals(feedPda));
    state.set(s.pubkey.toBase58(), {
      used,
      balance: balRow ? { pda: balRow.publicKey as PublicKey, index: balRow.account.index } : undefined,
      pyth: pythRow ? { pda: pythRow.publicKey as PublicKey, index: pythRow.account.index, balanceIdx: pythRow.account.mintBalanceSourceIndex } : undefined,
    });
  }
  const allocSlot = (key: string): number => {
    const used = state.get(key)!.used;
    for (let i = 0; i < 16; i++) if (!used.has(i)) { used.add(i); return i; }
    throw new Error(`strategy ${key}: no free slot`);
  };

  const ixs: TransactionInstruction[] = [];
  if (!alreadyEnabled) {
    const [allowedTokenPda] = PublicKey.findProgramAddressSync([Buffer.from("allowed_token"), TEST_WSOL.toBuffer()], program.programId);
    const [vaultAllowedPda] = PublicKey.findProgramAddressSync([Buffer.from("vault_allowed_token"), vaultPda.toBuffer(), TEST_WSOL.toBuffer()], program.programId);
    ixs.push(
      await program.methods
        .addVaultAllowedToken(TEST_WSOL)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: vaultPda,
          allowedToken: allowedTokenPda,
          vaultAllowedToken: vaultAllowedPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  for (const s of active) {
    const stKey = s.pubkey.toBase58();
    const stState = state.get(stKey)!;
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), s.id.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ata = getAssociatedTokenAddressSync(TEST_WSOL, sAuth, true);

    if (!stState.balance) {
      const slot = allocSlot(stKey);
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("value_source"), s.pubkey.toBuffer(), Uint8Array.of(slot)], program.programId);
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey, ata, sAuth, TEST_WSOL, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      ixs.push(
        await program.methods
          .addValueSource(s.id, slot, 0, ata, new BN(0), new BN(0), new BN(1), 0, 0)
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: vaultPda,
            strategy: s.pubkey,
            valueSource: pda,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
      stState.balance = { pda, index: slot };
    }
    if (!stState.pyth) {
      const slot = allocSlot(stKey);
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("value_source"), s.pubkey.toBuffer(), Uint8Array.of(slot)], program.programId);
      ixs.push(
        await program.methods
          .addValueSource(s.id, slot, 2, feedPda, new BN(0), new BN(1), new BN(1000), stState.balance!.index, PYTH_MAX_STALENESS_SECS)
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: vaultPda,
            strategy: s.pubkey,
            valueSource: pda,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
      stState.pyth = { pda, index: slot, balanceIdx: stState.balance!.index };
    }
  }

  console.log(`\nBuilt ${ixs.length} setup ix(s); chunking @ 4`);
  for (let i = 0; i < ixs.length; i += 4) {
    const tx = new Transaction();
    for (const ix of ixs.slice(i, i + 4)) tx.add(ix);
    const sig = await provider.sendAndConfirm(tx);
    console.log(`  ✓ tx ${Math.floor(i / 4)}: ${sig.slice(0, 8)}…`);
  }

  // ── 2. Mint test-wSOL into each strategy authority's ATA ──────────────
  console.log("\nMinting test-wSOL into strategy authorities…");
  for (const s of active) {
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), s.id.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ataAcct = await getOrCreateAssociatedTokenAccount(conn, payer, TEST_WSOL, sAuth, true);
    const before = Number((await getAccount(conn, ataAcct.address)).amount);
    await mintTo(conn, payer, TEST_WSOL, ataAcct.address, payer, PER_STRATEGY);
    const after = Number((await getAccount(conn, ataAcct.address)).amount);
    console.log(`  s#${s.id.toNumber()}: ${(before / 1e9).toFixed(3)} → ${(after / 1e9).toFixed(3)} test-wSOL`);
  }

  // ── 3. settle_strategy_value per strategy ─────────────────────────────
  console.log("\nCalling settle_strategy_value…");
  for (const s of active) {
    const stState = state.get(s.pubkey.toBase58())!;
    const [strategyTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), s.id.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const remaining = [
      { pubkey: stState.balance!.pda, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(
          TEST_WSOL,
          PublicKey.findProgramAddressSync(
            [Buffer.from("strategy_authority"), vaultPda.toBuffer(), s.id.toArrayLike(Buffer, "le", 8)],
            program.programId,
          )[0],
          true,
        ), isSigner: false, isWritable: false },
      { pubkey: stState.pyth!.pda, isSigner: false, isWritable: true },
      { pubkey: feedPda, isSigner: false, isWritable: false },
    ];
    try {
      const sig = await program.methods
        .settleStrategyValue(s.id)
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: vaultPda,
          strategy: s.pubkey,
          strategyTokenAccount: strategyTokenPda,
        })
        .remainingAccounts(remaining)
        .rpc();
      console.log(`  ✓ s#${s.id.toNumber()}: ${sig.slice(0, 8)}…`);
    } catch (err) {
      console.error(`  ✗ s#${s.id.toNumber()} FAILED:`, (err as Error).message ?? err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logs = (err as any).logs ?? (err as any).transactionLogs;
      if (logs) for (const l of logs) console.error("    " + l);
      throw err;
    }
  }

  const v1 = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nTVL after:  ${Number(v1.totalDeposited) / 1e6} USDC`);
  console.log(`Δ TVL:      ${(Number(v1.totalDeposited) - Number(v0.totalDeposited)) / 1e6} USDC`);
  const expected = (active.length * 0.05 * Number(priceI64)) / 1e8 / 1; // raw USDC = balance(raw) * price / 10^8 / 1000 then /1e6 to USDC
  console.log(`Expected:   ~${expected.toFixed(2)} USDC (n=${active.length} × 0.05 × $${(Number(priceI64) / 1e8).toFixed(2)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
