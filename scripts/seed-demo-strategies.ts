/**
 * One-shot: seed two demo-vault strategy ATAs with small amounts of
 *   - dUSDC (vault underlying, faucet-managed mint EPYZaXTW…) via
 *     demo_faucet.claim → SPL transfer
 *   - test-wSOL (BApn…YtoP) via direct mintTo (id.json is mint authority)
 *
 * Targets the new Demo Vault. No crank, no settle. Ad-hoc seeding only.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  mintTo,
  transfer as splTransfer,
  getOrCreateAssociatedTokenAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const FAUCET_PROGRAM_ID = new PublicKey("C86dEAtswZXMNqVPM6uhftE2yfwwv6qCxo3RpUXa777E");

const DEMO_MINT = new PublicKey("EPYZaXTW193ZC2uiJxC8sTavA2QFRugEPSDDuFka3AXT");   // dUSDC
const TEST_WSOL = new PublicKey("BApn44vuNabDPPmcoZ9SSEVu7kBAHsLGhAaDk6EQYtoP");   // test-wSOL

const USDC_TARGETS: Array<{ ata: PublicKey; amount: number }> = [
  { ata: new PublicKey("Do9Xzu2UHCsEVpHFeyumfKDqLzt2UQBk8s1csnup13ig"), amount: 500_000 },   // 0.5 dUSDC
  { ata: new PublicKey("AfpJCgPFkpRTarZvPMLyh5fjY79HoUALkTU6ZjHtcLyH"), amount: 300_000 },   // 0.3 dUSDC
];

// We need the strategy_authority owners for each USDC ATA so we can derive
// the matching wSOL ATA (same authority, different mint).
async function readAtaOwner(conn: anchor.web3.Connection, ata: PublicKey): Promise<PublicKey> {
  const ai = await conn.getAccountInfo(ata);
  if (!ai) throw new Error(`ATA ${ata.toBase58()} missing`);
  return new PublicKey(ai.data.slice(32, 64));
}

function loadKp(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const conn = new anchor.web3.Connection(RPC, "confirmed");
  const operator = loadKp("./id.json");
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(operator), { commitment: "confirmed" });
  anchor.setProvider(provider);

  // ── Pre-flight ─────────────────────────────────────────────────────
  console.log(`operator: ${operator.publicKey.toBase58()}`);
  console.log(`dUSDC mint (faucet-owned): ${DEMO_MINT.toBase58()}`);
  console.log(`test-wSOL mint:            ${TEST_WSOL.toBase58()}\n`);

  // ── 1. Faucet-claim 100 dUSDC into operator ATA, then SPL-transfer ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faucetIdl = JSON.parse(fs.readFileSync("./target/idl/demo_faucet.json", "utf-8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faucet = new anchor.Program(faucetIdl as any, provider);

  const [faucetAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_authority"), DEMO_MINT.toBuffer()], FAUCET_PROGRAM_ID,
  );
  const [faucetConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_config"), DEMO_MINT.toBuffer()], FAUCET_PROGRAM_ID,
  );
  const [claimRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), DEMO_MINT.toBuffer(), operator.publicKey.toBuffer()], FAUCET_PROGRAM_ID,
  );

  const operatorUsdcAta = (await getOrCreateAssociatedTokenAccount(
    conn, operator, DEMO_MINT, operator.publicKey,
  )).address;

  const balBefore = await conn.getTokenAccountBalance(operatorUsdcAta).then(r => Number(r.value.amount)).catch(() => 0);
  const need = USDC_TARGETS.reduce((s, t) => s + t.amount, 0);
  if (balBefore < need) {
    console.log(`[claim] operator dUSDC: ${(balBefore / 1e6).toFixed(2)} → claiming…`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (faucet.methods as any).claim().accountsStrict({
        recipient: operator.publicKey,
        mint: DEMO_MINT,
        faucetConfig,
        faucetAuthority,
        recipientAta: operatorUsdcAta,
        claimRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).rpc();
      const balAfter = await conn.getTokenAccountBalance(operatorUsdcAta).then(r => Number(r.value.amount));
      console.log(`  claimed → operator dUSDC = ${(balAfter / 1e6).toFixed(2)}`);
    } catch (e) {
      console.warn(`  claim failed: ${(e as { message?: string })?.message ?? e}`);
    }
  } else {
    console.log(`[claim] operator already has enough dUSDC (${(balBefore / 1e6).toFixed(2)}) — skipping`);
  }

  console.log("\n[transfer] dUSDC into strategy ATAs");
  for (const t of USDC_TARGETS) {
    await splTransfer(conn, operator, operatorUsdcAta, t.ata, operator, t.amount);
    console.log(`  → ${t.ata.toBase58()}: +${(t.amount / 1e6).toFixed(2)} dUSDC`);
  }

  // ── 2. Create wSOL ATAs at each strategy_authority owner, mint into them
  console.log("\n[mintTo] test-wSOL into strategy_authority wSOL ATAs");
  for (const t of USDC_TARGETS) {
    const owner = await readAtaOwner(conn, t.ata);
    const wsolAta = (await getOrCreateAssociatedTokenAccount(
      conn, operator, TEST_WSOL, owner, true,   // allowOwnerOffCurve = true (PDA)
    )).address;
    const amount = 5_000_000; // 0.005 wSOL (9 dp)
    await mintTo(conn, operator, TEST_WSOL, wsolAta, operator, amount);
    console.log(`  ${wsolAta.toBase58()} (owner ${owner.toBase58()}): +${(amount / 1e9).toFixed(6)} wSOL`);
  }

  console.log("\nDone.");
}

main().catch(err => { console.error(err); process.exit(1); });
