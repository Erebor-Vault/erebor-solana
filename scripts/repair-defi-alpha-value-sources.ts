/**
 * repair-defi-alpha-value-sources.ts — Tear down every ValueSource on each
 * active DeFi Alpha strategy and re-create a clean pair for test-wSOL:
 *   slot A: kind=0 SplAtaBalance, target = strategy_authority's wSOL ATA,
 *           scale 0/1   (companion / balance carrier only)
 *   slot B: kind=2 PythPriceFeed, target = mock-Pyth wSOL feed PDA,
 *           scale 1/1000, mint_balance_source_index = A
 *
 * Then call `settle_strategy_value` per strategy with remaining_accounts
 * pointing at exactly that pair.
 *
 * Why a tear-down: the strategies inherited (a) a stale kind=1 AccountU64
 * row from a never-finished Kamino preset whose target_account doesn't
 * exist, and (b) several duplicate kind=0 / kind=2 rows from the pre-fix
 * toggle bug. Both cause `settle_strategy_value` to revert with
 * `ValueSourceTargetTooSmall` or to over-count.
 *
 * Authority signing: id.json runs the keeper portion (init+crank pyth feed
 * already done). The remove/add/settle ixs need the vault admin OR
 * authority signature. If id.json holds neither, the script prints the ix
 * blobs ready to send.
 *
 * Run from repo root:
 *   bun scripts/repair-defi-alpha-value-sources.ts
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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
const VAULT_ID = 4;
const TEST_WSOL = new PublicKey("BApn44vuNabDPPmcoZ9SSEVu7kBAHsLGhAaDk6EQYtoP");
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
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
  const conn = new anchor.web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  // --wallet path/to/keypair.json    or    WALLET=path/to/keypair.json
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf("--wallet");
  const walletPath =
    (flagIdx !== -1 ? argv[flagIdx + 1] : undefined) ?? process.env.WALLET ?? "./id.json";
  console.log(`Using keypair: ${walletPath}`);
  const payer = loadWallet(walletPath);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPyth = new anchor.Program<MockPyth>(
    JSON.parse(fs.readFileSync("./target/idl/mock_pyth.json", "utf-8")) as never,
    provider,
  );

  // Re-prime the mock-pyth feed so settle's staleness check (max 60s) passes
  // when our admin signature lands. set_price is permissionless on mock_pyth.
  const feedPda = derivePriceFeedPda(MOCK_PYTH, TEST_WSOL);
  const priceI64 = await fetchSolUsd();
  console.log(`Cranking test-wSOL feed → $${(Number(priceI64) / 1e8).toFixed(2)}`);
  await mockPyth.methods
    .setPrice(new BN(priceI64.toString()), -8)
    .accountsStrict({ payer: payer.publicKey, mint: TEST_WSOL, feed: feedPda })
    .rpc();

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const v = await program.account.vaultState.fetch(vaultPda);
  console.log(`Vault: ${vaultPda.toBase58()}`);
  console.log(`Admin/Authority: ${v.admin.toBase58()} / ${v.authority.toBase58()}`);
  const isSigner = v.admin.equals(payer.publicKey) || v.authority.equals(payer.publicKey);
  console.log(`TVL before: ${Number(v.totalDeposited) / 1e6} USDC`);

  const removeIxs: { strategyId: number; ix: TransactionInstruction; description: string }[] = [];
  const addIxs: { strategyId: number; ix: TransactionInstruction; description: string }[] = [];
  const settleIxs: { strategyId: number; ix: TransactionInstruction }[] = [];

  for (let id = 0; id < v.strategyCount.toNumber(); id++) {
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
    const ata = getAssociatedTokenAddressSync(TEST_WSOL, sAuth, true);

    // 1. Tear down every existing ValueSource for this strategy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: sPda.toBase58() } },
    ]);
    console.log(`\n#${id}: tearing down ${vsRows.length} existing ValueSource(s)`);
    for (const r of vsRows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (r as any).account;
      removeIxs.push({
        strategyId: id,
        description: `remove slot ${a.index} (kind=${a.kind})`,
        ix: await program.methods
          .removeValueSource(sData.strategyId, a.index)
          .accountsStrict({
            admin: v.admin,
            vaultState: vaultPda,
            strategy: sPda,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            valueSource: (r as any).publicKey as PublicKey,
          })
          .instruction(),
      });
    }

    // 2. Re-add the canonical pair at slots 0 and 1 (now free).
    const [bal0Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), sPda.toBuffer(), Uint8Array.of(0)],
      program.programId,
    );
    const [pyth1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), sPda.toBuffer(), Uint8Array.of(1)],
      program.programId,
    );
    addIxs.push({
      strategyId: id,
      description: `addValueSource slot 0 kind=0 (test-wSOL ATA, scale 0/1 — balance carrier)`,
      ix: createAssociatedTokenAccountIdempotentInstruction(
        v.admin, ata, sAuth, TEST_WSOL, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    });
    addIxs.push({
      strategyId: id,
      description: `addValueSource slot 0 kind=0`,
      ix: await program.methods
        .addValueSource(sData.strategyId, 0, 0, ata, new BN(0), new BN(0), new BN(1), 0, 0)
        .accountsStrict({
          admin: v.admin,
          vaultState: vaultPda,
          strategy: sPda,
          valueSource: bal0Pda,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    });
    addIxs.push({
      strategyId: id,
      description: `addValueSource slot 1 kind=2 (Pyth wSOL/USD, scale 1/1000, mint_balance_source_index=0)`,
      ix: await program.methods
        .addValueSource(sData.strategyId, 1, 2, feedPda, new BN(0), new BN(1), new BN(1000), 0, PYTH_MAX_STALENESS_SECS)
        .accountsStrict({
          admin: v.admin,
          vaultState: vaultPda,
          strategy: sPda,
          valueSource: pyth1Pda,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    });

    // 3. Settle.
    const [strategyTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    settleIxs.push({
      strategyId: id,
      ix: await program.methods
        .settleStrategyValue(sData.strategyId)
        .accountsStrict({
          authority: v.authority,
          vaultState: vaultPda,
          strategy: sPda,
          strategyTokenAccount: strategyTokenPda,
        })
        .remainingAccounts([
          { pubkey: bal0Pda, isSigner: false, isWritable: true },
          { pubkey: ata, isSigner: false, isWritable: false },
          { pubkey: pyth1Pda, isSigner: false, isWritable: true },
          { pubkey: feedPda, isSigner: false, isWritable: false },
        ])
        .instruction(),
    });
  }

  const allIxs = [
    ...removeIxs.map((x) => ({ ...x, phase: "REMOVE" as const })),
    ...addIxs.map((x) => ({ ...x, phase: "ADD" as const })),
    ...settleIxs.map((x) => ({ ...x, phase: "SETTLE" as const, description: `settle_strategy_value strategy #${x.strategyId}` })),
  ];

  if (isSigner) {
    console.log(`\nExecuting ${allIxs.length} ixs (chunks of 4)…`);
    let cranked = true; // we just cranked above
    for (let i = 0; i < allIxs.length; i += 4) {
      const slice = allIxs.slice(i, i + 4);
      // Re-crank the mock-pyth feed right before any chunk that contains a
      // SETTLE so the publish_time stays within max_staleness_secs (60s).
      const containsSettle = slice.some((x) => x.phase === "SETTLE");
      if (containsSettle && !cranked) {
        const fresh = await fetchSolUsd();
        await mockPyth.methods
          .setPrice(new BN(fresh.toString()), -8)
          .accountsStrict({ payer: payer.publicKey, mint: TEST_WSOL, feed: feedPda })
          .rpc();
        console.log(`  (re-cranked feed → $${(Number(fresh) / 1e8).toFixed(2)})`);
      }
      cranked = false;
      const tx = new Transaction();
      for (const x of slice) tx.add(x.ix);
      try {
        const sig = await provider.sendAndConfirm(tx);
        console.log(`  ✓ tx ${Math.floor(i / 4)} (${slice.map((x) => x.phase).join(",")}): ${sig.slice(0, 8)}…`);
      } catch (err) {
        console.error(`  ✗ tx ${Math.floor(i / 4)}:`, (err as Error).message ?? err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const logs = (err as any).logs ?? (err as any).transactionLogs;
        if (logs) for (const l of logs) console.error("    " + l);
        throw err;
      }
    }
    const v2 = await program.account.vaultState.fetch(vaultPda);
    console.log(`\nTVL after: ${Number(v2.totalDeposited) / 1e6} USDC`);
  } else {
    console.log(`\nNot the admin/authority. ${allIxs.length} ixs to sign:`);
    for (const x of allIxs) {
      console.log(`  [${x.phase}] s#${x.strategyId}: ${x.description}`);
      console.log(`    programId: ${x.ix.programId.toBase58()}, ${x.ix.keys.length} accounts`);
      console.log(`    data:      ${x.ix.data.toString("base64")}\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
