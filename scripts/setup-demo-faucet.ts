/**
 * setup-demo-faucet.ts — register a vault's underlying mint with the
 * demo_faucet program.
 *
 * Steps (idempotent):
 *   1. Load mint authority (the script's payer or --authority keypair).
 *   2. Transfer the SPL mint authority to the `["faucet_authority", mint]` PDA.
 *   3. Call `demo_faucet.register_mint(amount_per_claim, cooldown_secs)`.
 *
 * After this runs, anyone can call `demo_faucet.claim` to receive
 * `amount_per_claim` tokens of `mint`, subject to `cooldown_secs` per
 * recipient.
 *
 * Usage:
 *   bun scripts/setup-demo-faucet.ts \
 *     --rpc http://localhost:8899 \
 *     --mint <MINT_PUBKEY> \
 *     --amount 100000000 \    # 100 tokens (6 decimals)
 *     --cooldown 60          # seconds
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
  Transaction,
} from "@solana/web3.js";
import {
  createSetAuthorityInstruction,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

const FAUCET_PROGRAM_ID = new PublicKey("C86dEAtswZXMNqVPM6uhftE2yfwwv6qCxo3RpUXa777E");

interface Opts {
  rpc: string;
  mint: PublicKey;
  amountPerClaim: BN;
  cooldownSecs: number;
  walletPath: string;
}

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const i = args.indexOf(flag);
    if (i === -1) return def;
    return args[i + 1];
  };
  const rpc = get("--rpc", "http://localhost:8899")!;
  const mint = new PublicKey(get("--mint")!);
  const amountPerClaim = new BN(get("--amount", "100000000")!);
  const cooldownSecs = Number(get("--cooldown", "60"));
  const walletPath = get("--wallet", "./id.json")!;
  return { rpc, mint, amountPerClaim, cooldownSecs, walletPath };
}

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const opts = parseArgs();
  const conn = new Connection(opts.rpc, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load the IDL ourselves (anchor.workspace doesn't know about post-build programs from outside)
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/demo_faucet.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<any>;

  console.log("=== Demo Faucet Setup ===");
  console.log("Mint:        ", opts.mint.toBase58());
  console.log("Amount/claim:", opts.amountPerClaim.toString());
  console.log("Cooldown:    ", opts.cooldownSecs, "secs");

  const [faucetAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_authority"), opts.mint.toBuffer()],
    FAUCET_PROGRAM_ID
  );
  const [faucetConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_config"), opts.mint.toBuffer()],
    FAUCET_PROGRAM_ID
  );

  // ── Step 1: transfer mint authority if not already on PDA ─────────────
  const mintInfo = await getMint(conn, opts.mint);
  if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(faucetAuthority)) {
    if (!mintInfo.mintAuthority) {
      throw new Error("Mint has no current authority — cannot transfer.");
    }
    if (!mintInfo.mintAuthority.equals(payer.publicKey)) {
      throw new Error(
        `Mint authority is ${mintInfo.mintAuthority.toBase58()}, expected payer ${payer.publicKey.toBase58()}.`
      );
    }
    console.log("\n1. Transferring mint authority →", faucetAuthority.toBase58(), "...");
    const ix = createSetAuthorityInstruction(
      opts.mint,
      payer.publicKey,
      AuthorityType.MintTokens,
      faucetAuthority
    );
    const tx = new Transaction().add(ix);
    const sig = await provider.sendAndConfirm(tx, [payer]);
    console.log("   sig:", sig);
  } else {
    console.log("\n1. Mint authority already on faucet PDA — skip.");
  }

  // ── Step 2: register_mint (idempotent — skip if config exists) ────────
  if (await conn.getAccountInfo(faucetConfig)) {
    console.log("\n2. FaucetConfig already exists — skip register_mint.");
  } else {
    console.log("\n2. Calling register_mint...");
    const sig = await program.methods
      .registerMint(opts.amountPerClaim, new BN(opts.cooldownSecs))
      .accountsStrict({
        admin: payer.publicKey,
        mint: opts.mint,
        faucetAuthority,
        faucetConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   sig:", sig);
  }

  console.log("\n=== Done ===");
  console.log("FaucetConfig:  ", faucetConfig.toBase58());
  console.log("FaucetAuthority:", faucetAuthority.toBase58());
}

main().catch((e) => { console.error(e); process.exit(1); });
