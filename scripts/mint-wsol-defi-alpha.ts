/**
 * mint-wsol-defi-alpha.ts — Wrap a small amount of native SOL into the
 * `strategy_authority[i]` wSOL ATA for every active strategy in the
 * DeFi Alpha vault, then report:
 *   - new wSOL balance per strategy ATA
 *   - whether a ValueSource entry already points at that wSOL ATA
 *     (so a subsequent `settle_strategy_value` call from the vault
 *     authority would pick the new balance up)
 *
 * Yield-sized: 0.02 wSOL per strategy (≈ a realistic farm tick), not the
 * 100-USDC chunks I used last time.
 *
 * Run from repo root:
 *   bun scripts/mint-wsol-defi-alpha.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// ----- Config -----
const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE"); // DeFi Alpha underlying (USDC)
const VAULT_ID = 4;
const PER_STRATEGY_LAMPORTS = 20_000_000; // 0.02 SOL
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );

  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log("=== Wrap-SOL into DeFi Alpha strategies ===");
  console.log(`Vault PDA:  ${vaultPda.toBase58()}`);
  console.log(`Authority:  ${vault.authority.toBase58()}`);
  console.log(`Strategies: ${vault.strategyCount.toString()}`);
  console.log(`Per-strat:  ${PER_STRATEGY_LAMPORTS / 1e9} wSOL\n`);

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

    const [strategyAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, strategyAuthority, true);

    console.log(`Strategy #${id}`);
    console.log(`  authority: ${strategyAuthority.toBase58()}`);
    console.log(`  wSOL ATA:  ${wsolAta.toBase58()}`);

    const tx = new Transaction();
    const ataInfo = await connection.getAccountInfo(wsolAta);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          wsolAta,
          strategyAuthority,
          NATIVE_MINT,
        ),
      );
      console.log("  creating wSOL ATA…");
    }
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: wsolAta,
        lamports: PER_STRATEGY_LAMPORTS,
      }),
      createSyncNativeInstruction(wsolAta),
    );

    const sig = await provider.sendAndConfirm(tx);
    const acct = await getAccount(connection, wsolAta);
    console.log(`  balance:   ${Number(acct.amount) / 1e9} wSOL  (sig ${sig.slice(0, 8)}…)`);

    // Look for any ValueSource pointing at this wSOL ATA.
    let foundVs: number | null = null;
    for (let i = 0; i < 8; i++) {
      const [vsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("value_source"), sPda.toBuffer(), Uint8Array.of(i)],
        program.programId,
      );
      const info = await connection.getAccountInfo(vsPda);
      if (!info) continue;
      const vs = (await program.account.valueSource.fetch(vsPda)) as any;
      if ((vs.targetAccount as PublicKey).equals(wsolAta)) {
        foundVs = i;
        break;
      }
    }
    if (foundVs !== null) {
      console.log(`  ValueSource[${foundVs}] points at this wSOL ATA — settle_strategy_value will pick it up ✓`);
    } else {
      console.log(`  ⚠ no ValueSource references this wSOL ATA — settle_strategy_value won't see it. Add one via the admin panel.`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
