/**
 * test-toggle-allowed-tokens.ts — Reproduce the exact instruction sequence
 * the frontend's `useVaultAllowedTokens.applyDiff` builds when an admin
 * toggles a mint, and submit it under id.json (the admin of vaults 0..3).
 *
 * Goal: surface the *full* on-chain error for the "custom program error"
 * the user is hitting in the dApp, where the wallet toast truncates it.
 *
 * Run from repo root:
 *   bun scripts/test-toggle-allowed-tokens.ts <vault_id>
 * defaults to vault_id 0 (AT trader agent).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
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
const MOCK_PYTH = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const PYTH_MAX_STALENESS_SECS = 60;

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

function derivePriceFeedPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("price"), mint.toBuffer()], programId)[0];
}

async function getMintDecimals(connection: anchor.web3.Connection, mint: PublicKey): Promise<number> {
  const info = await connection.getAccountInfo(mint);
  if (!info?.data || info.data.length < 45) throw new Error(`mint ${mint.toBase58()} not readable`);
  return info.data[44];
}

function scaleForUsdcDenom(mintDec: number, underlyingDec: number): { num: BN; den: BN } {
  const diff = underlyingDec - mintDec;
  if (diff === 0) return { num: new BN(1), den: new BN(1) };
  if (diff > 0) return { num: new BN(10).pow(new BN(diff)), den: new BN(1) };
  return { num: new BN(1), den: new BN(10).pow(new BN(-diff)) };
}

async function main() {
  const vaultId = Number(process.argv[2] ?? "0");
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(vaultId).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`Admin:     ${vault.admin.toBase58()}`);
  if (!vault.admin.equals(payer.publicKey)) {
    throw new Error(`payer is not the admin (admin=${vault.admin.toBase58()})`);
  }

  // ---- Pick a candidate mint to enable ----------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const protocolAll = await (program.account as any).allowedToken.all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vaultAll = await (program.account as any).vaultAllowedToken.all([
    { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enabledSet = new Set(vaultAll.map((r: any) => (r.account.mint as PublicKey).toBase58()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = protocolAll
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.account.mint as PublicKey)
    .filter((m: PublicKey) => !enabledSet.has(m.toBase58()) && !m.equals(vault.tokenMint as PublicKey));
  if (candidates.length === 0) {
    console.log("No non-enabled candidate mints on the protocol allow-list. Nothing to test.");
    return;
  }
  const wantMint = process.argv[3];
  const mint: PublicKey = wantMint
    ? candidates.find((c: PublicKey) => c.toBase58() === wantMint) ?? candidates[0]
    : candidates[0];
  console.log(`\nPicked candidate mint: ${mint.toBase58()}`);

  // ---- Active strategies -------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allStrategies = await (program.account as any).strategyAllocation.all([
    { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
  ]);
  const activeStrategies = allStrategies
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s.account.isActive)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({ pubkey: s.publicKey as PublicKey, id: s.account.strategyId as BN }));
  console.log(`Active strategies: ${activeStrategies.length}`);

  // ---- Per-strategy used slots ------------------------------------------
  const usedSlots = new Map<string, Set<number>>();
  for (const s of activeStrategies) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsRows = await (program.account as any).valueSource.all([
      { memcmp: { offset: 8 + 32, bytes: s.pubkey.toBase58() } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usedSlots.set(s.pubkey.toBase58(), new Set(vsRows.map((r: any) => r.account.index as number)));
  }
  const allocateSlot = (key: string): number => {
    const used = usedSlots.get(key) ?? new Set<number>();
    for (let i = 0; i < 16; i++) if (!used.has(i)) { used.add(i); usedSlots.set(key, used); return i; }
    throw new Error("all 16 slots used on " + key);
  };

  // ---- Build instructions -----------------------------------------------
  const underlyingDecimals = await getMintDecimals(connection, vault.tokenMint as PublicKey);
  const mintDecimals = await getMintDecimals(connection, mint);
  const pythScale = scaleForUsdcDenom(mintDecimals, underlyingDecimals);
  console.log(`underlying dp=${underlyingDecimals}, mint dp=${mintDecimals}, pyth scale=${pythScale.num.toString()}/${pythScale.den.toString()}`);

  const ixs: TransactionInstruction[] = [];

  // 1. addVaultAllowedToken
  const [allowedTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_token"), mint.toBuffer()],
    program.programId,
  );
  const [vaultAllowedTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_allowed_token"), vaultPda.toBuffer(), mint.toBuffer()],
    program.programId,
  );
  ixs.push(
    await program.methods
      .addVaultAllowedToken(mint)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        allowedToken: allowedTokenPda,
        vaultAllowedToken: vaultAllowedTokenPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  );

  // 2. for each strategy: createATA, addValueSource kind=0, addValueSource kind=2
  const feedPda = derivePriceFeedPda(MOCK_PYTH, mint);
  for (const s of activeStrategies) {
    const balanceSlot = allocateSlot(s.pubkey.toBase58());
    const [sAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), s.id.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const ata = getAssociatedTokenAddressSync(mint, sAuth, true);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, ata, sAuth, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    const [balanceVsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), s.pubkey.toBuffer(), Uint8Array.of(balanceSlot)],
      program.programId,
    );
    ixs.push(
      await program.methods
        .addValueSource(s.id, balanceSlot, 0, ata, new BN(0), new BN(0), new BN(1), 0, 0)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: vaultPda,
          strategy: s.pubkey,
          valueSource: balanceVsPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );

    const pythSlot = allocateSlot(s.pubkey.toBase58());
    const [pythVsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), s.pubkey.toBuffer(), Uint8Array.of(pythSlot)],
      program.programId,
    );
    ixs.push(
      await program.methods
        .addValueSource(
          s.id, pythSlot, 2, feedPda, new BN(0), pythScale.num, pythScale.den, balanceSlot, PYTH_MAX_STALENESS_SECS,
        )
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: vaultPda,
          strategy: s.pubkey,
          valueSource: pythVsPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }

  console.log(`\nBuilt ${ixs.length} instructions, chunking at 4 per tx`);

  // ---- Submit ------------------------------------------------------------
  const CHUNK = 4;
  for (let i = 0; i < ixs.length; i += CHUNK) {
    const slice = ixs.slice(i, i + CHUNK);
    const tx = new Transaction();
    for (const ix of slice) tx.add(ix);
    console.log(`\nSubmitting tx with ${slice.length} ix(s) (range ${i}..${i + slice.length - 1})…`);
    try {
      const sig = await provider.sendAndConfirm(tx);
      console.log(`  ✓ ${sig}`);
    } catch (err) {
      console.error("\n--- TX FAILED ---");
      console.error(err);
      // Anchor errors usually have logs in err.logs or err.transactionLogs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logs = (err as any).logs ?? (err as any).transactionLogs;
      if (logs) {
        console.error("\nLogs:");
        for (const l of logs) console.error("  " + l);
      }
      // Decode custom program error → VaultError variant
      const msg = String((err as Error).message ?? err);
      const m = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
      if (m) {
        const code = parseInt(m[1], 16);
        console.error(`\nDecoded code: 0x${m[1]}  (${code} = ${code - 6000} in VaultError enum order)`);
      }
      process.exit(1);
    }
  }
  console.log("\nAll txs succeeded.");
}

main().catch((e) => {
  console.error("\nFailed:", e.message ?? e);
  process.exit(1);
});
