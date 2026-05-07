/**
 * setup-demo-vault.ts — Bring up the "Demo Vault" (vault_id = 5 under
 * test USDC) whose admin + authority are a freshly-generated keypair we
 * intentionally publish in the dApp bundle so any visitor can act as
 * admin. Devnet only.
 *
 *   1. generate a fresh demo keypair
 *   2. init_vault(5) under TEST_USDC_MINT, payer = id.json (initial admin)
 *   3. propose_admin / propose_authority → demo keypair
 *   4. accept_admin / accept_authority signed by demo keypair
 *   5. fund the demo keypair with a small SOL airdrop so it can pay rent
 *      for downstream admin instructions (createATA, addValueSource, …)
 *   6. write the bs58 secret to .env.demo (gitignored) and print the
 *      single line you need to add to app/.env.local
 *
 * Run from repo root:
 *   bun scripts/setup-demo-vault.ts --wallet ./id.json
 *
 * Idempotent: skips init/transfer steps if the vault already exists with
 * the demo keypair as admin.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
} from "@solana/spl-token";
import bs58 from "bs58";
import BN from "bn.js";
import * as fs from "fs";

const VAULT_ID = 0; // fresh demo mint, vault_id=0 is free
const DEMO_KEYPAIR_PATH = "./demo-admin.json";
const DEMO_MINT_PATH = "./demo-mint.json"; // saves the mint pubkey for idempotency
const DEMO_BS58_PATH = "./.env.demo";
const FAUCET_PROGRAM_ID = new PublicKey("C86dEAtswZXMNqVPM6uhftE2yfwwv6qCxo3RpUXa777E");
const FAUCET_AMOUNT_PER_CLAIM = new BN(100_000_000); // 100 dUSDC (6 dp)
const FAUCET_COOLDOWN_SECS = new BN(60);

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function loadWallet(p: string) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}
function loadOrCreateDemo(): Keypair {
  if (fs.existsSync(DEMO_KEYPAIR_PATH)) {
    const kp = loadWallet(DEMO_KEYPAIR_PATH);
    console.log(`reusing existing demo keypair: ${kp.publicKey.toBase58()}`);
    return kp;
  }
  const kp = Keypair.generate();
  fs.writeFileSync(DEMO_KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)));
  fs.chmodSync(DEMO_KEYPAIR_PATH, 0o600);
  console.log(`generated new demo keypair: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function main() {
  const walletPath = getArg("wallet") ?? process.env.WALLET ?? "./id.json";
  const conn = new anchor.web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadWallet(walletPath);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;

  const demo = loadOrCreateDemo();
  console.log(`payer (initial admin): ${payer.publicKey.toBase58()}`);
  console.log(`demo admin/authority:  ${demo.publicKey.toBase58()}`);

  // ── 0a. Demo mint with faucet PDA as mint authority ───────────────────
  // Saved to ./demo-mint.json so re-runs reuse the same mint (& vault PDA).
  let demoMint: PublicKey;
  if (fs.existsSync(DEMO_MINT_PATH)) {
    demoMint = new PublicKey(JSON.parse(fs.readFileSync(DEMO_MINT_PATH, "utf-8")).mint);
    console.log(`reusing demo mint: ${demoMint.toBase58()}`);
  } else {
    const [faucetAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("faucet_authority"), Buffer.alloc(32)], // placeholder
      FAUCET_PROGRAM_ID,
    );
    void faucetAuth; // we re-derive below using the actual mint
    // Need the mint pubkey to derive faucet_authority, but we also need the
    // faucet_authority to set as the mint's authority. createMint takes the
    // authority *after* the mint keypair is generated, so we can derive in
    // sequence: mint = Keypair.generate() → derive faucet_auth(mint) → createMint.
    const mintKp = Keypair.generate();
    const [faucetAuthorityForMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("faucet_authority"), mintKp.publicKey.toBuffer()],
      FAUCET_PROGRAM_ID,
    );
    console.log("\ncreating demo mint with faucet PDA as mint authority…");
    demoMint = await createMint(
      conn,
      payer,
      faucetAuthorityForMint, // mint authority = faucet PDA from the start
      null,                   // no freeze authority
      6,                      // decimals
      mintKp,
    );
    fs.writeFileSync(DEMO_MINT_PATH, JSON.stringify({ mint: demoMint.toBase58() }, null, 2));
    fs.chmodSync(DEMO_MINT_PATH, 0o644);
    console.log(`  mint: ${demoMint.toBase58()}`);
    console.log(`  faucet authority: ${faucetAuthorityForMint.toBase58()}`);
  }

  // ── 0b. Register the mint with the faucet (idempotent) ────────────────
  const [faucetAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_authority"), demoMint.toBuffer()],
    FAUCET_PROGRAM_ID,
  );
  const [faucetConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_config"), demoMint.toBuffer()],
    FAUCET_PROGRAM_ID,
  );
  if (!(await conn.getAccountInfo(faucetConfig))) {
    console.log("\nregistering mint with demo faucet…");
    const faucetIdl = JSON.parse(fs.readFileSync("./target/idl/demo_faucet.json", "utf-8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faucetProgram = new anchor.Program(faucetIdl as any, provider) as anchor.Program<any>;
    await faucetProgram.methods
      .registerMint(FAUCET_AMOUNT_PER_CLAIM, FAUCET_COOLDOWN_SECS)
      .accountsStrict({
        admin: payer.publicKey,
        mint: demoMint,
        faucetAuthority,
        faucetConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  registered: ${(FAUCET_AMOUNT_PER_CLAIM.toNumber() / 1e6).toFixed(0)} dUSDC / claim, cooldown ${FAUCET_COOLDOWN_SECS}s`);
  } else {
    console.log("faucet config already exists for demo mint — skip register");
  }

  // ── 1. Init vault if missing ──────────────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), demoMint.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()],
    program.programId,
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    program.programId,
  );
  const reserveAta = anchor.utils.token.associatedAddress({
    mint: demoMint,
    owner: vaultAuthority,
  });

  const existing = await conn.getAccountInfo(vaultPda);
  if (!existing) {
    console.log(`\ninitializing vault_id=${VAULT_ID}…`);
    await program.methods
      .initializeVault(new BN(VAULT_ID))
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        vaultAuthority,
        tokenMint: demoMint,
        shareMint: shareMintPda,
        reserveAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`  vault PDA: ${vaultPda.toBase58()}`);
  } else {
    console.log(`\nvault already exists: ${vaultPda.toBase58()}`);
  }

  // ── 2. Two-step admin/authority transfer to demo keypair ──────────────
  const v = await program.account.vaultState.fetch(vaultPda);
  if (!v.admin.equals(demo.publicKey)) {
    if (!v.admin.equals(payer.publicKey)) {
      throw new Error(`vault admin is ${v.admin.toBase58()} (not payer or demo); aborting`);
    }
    console.log("\nproposing admin/authority transfer to demo keypair…");
    await program.methods
      .proposeAdmin(demo.publicKey)
      .accountsStrict({ admin: payer.publicKey, vaultState: vaultPda })
      .rpc();
    await program.methods
      .proposeAuthority(demo.publicKey)
      .accountsStrict({ admin: payer.publicKey, vaultState: vaultPda })
      .rpc();
    console.log("  proposals submitted");

    // Demo keypair must accept. Fund it first — it has zero SOL.
    const demoBalance = await conn.getBalance(demo.publicKey);
    if (demoBalance < 0.05 * LAMPORTS_PER_SOL) {
      console.log("  funding demo keypair with 0.5 SOL for rent + signature fees…");
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: demo.publicKey,
          lamports: 0.5 * LAMPORTS_PER_SOL,
        }),
      );
      await provider.sendAndConfirm(fundTx);
    }

    const demoProvider = new anchor.AnchorProvider(
      conn,
      new anchor.Wallet(demo),
      { commitment: "confirmed" },
    );
    const demoProgram = new anchor.Program<MyProject>(program.idl, demoProvider);

    await demoProgram.methods
      .acceptAdmin()
      .accountsStrict({ newAdmin: demo.publicKey, vaultState: vaultPda })
      .rpc();
    await demoProgram.methods
      .acceptAuthority()
      .accountsStrict({ newAuthority: demo.publicKey, vaultState: vaultPda })
      .rpc();
    console.log("  demo keypair accepted admin + authority");
  } else {
    console.log("demo keypair is already admin + authority — skipping transfer");
  }

  // Top-up the demo keypair if it's running low (each admin tx pays rent
  // for the new PDA — value-source rows, allowed-token rows, etc.).
  const minBalance = 0.1 * LAMPORTS_PER_SOL;
  const bal = await conn.getBalance(demo.publicKey);
  if (bal < minBalance) {
    console.log(`\ntopping demo keypair from ${(bal / LAMPORTS_PER_SOL).toFixed(3)} → 0.5 SOL…`);
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: demo.publicKey,
        lamports: 0.5 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(tx);
  }

  // ── 3. Write bs58 secret + print env line ─────────────────────────────
  const bs58Secret = bs58.encode(demo.secretKey);
  fs.writeFileSync(
    DEMO_BS58_PATH,
    `NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58=${bs58Secret}\nNEXT_PUBLIC_DEMO_MINT=${demoMint.toBase58()}\n`,
  );
  fs.chmodSync(DEMO_BS58_PATH, 0o600);

  console.log("\n=== Done ===");
  console.log(`Demo mint:        ${demoMint.toBase58()}  (faucet-owned)`);
  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Demo admin:       ${demo.publicKey.toBase58()}`);
  console.log(`Demo balance:     ${((await conn.getBalance(demo.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`Keypair file:     ${DEMO_KEYPAIR_PATH}  (mode 0600)`);
  console.log(`Env file written: ${DEMO_BS58_PATH}`);
  console.log("");
  console.log("Add these two lines to app/.env.local and restart `bun dev`:");
  console.log(`  NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58=${bs58Secret}`);
  console.log(`  NEXT_PUBLIC_DEMO_MINT=${demoMint.toBase58()}`);
  console.log("");
  console.log("After that, the Demo Vault card will appear in the dashboard");
  console.log('with the "Demo vault — anyone can act as admin" banner, and');
  console.log("the 100 dUSDC faucet will mint via the registered faucet PDA.");
}

main().catch((e) => { console.error(e); process.exit(1); });
