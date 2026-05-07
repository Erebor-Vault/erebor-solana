/**
 * mint-defi-alpha.ts — One-off helper for the demo:
 *   1. Mint test USDC (the underlying accepted by DeFi Alpha vault) to a
 *      target user wallet's ATA.
 *   2. Mint test USDC to every active strategy ATA inside DeFi Alpha.
 *   3. If the loaded keypair is the vault authority, call `report_yield`
 *      on each strategy so `vault_state.total_deposited` actually reflects
 *      the new balances.
 *   4. Print before/after TVL so you can verify the increase matches the
 *      sum of strategy mints.
 *
 * Run from repo root:
 *   bun scripts/mint-defi-alpha.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// ----- Config -----
const TOKEN_MINT = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE"); // TEST_USDC
const VAULT_ID = 4; // DeFi Alpha
const TARGET_WALLET = new PublicKey("DhCAaTtz8A23d41NnUzaYgY79fxmRbzXnYAHiieYHike");
const TARGET_USER_AMOUNT = 1_000_000_000; // 1000 USDC
const PER_STRATEGY_AMOUNT = 100_000_000;  //  100 USDC each
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

function loadWallet(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function confirm(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
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

  console.log("=== Mint to DeFi Alpha (vault_id=4) ===");
  console.log(`Payer:     ${payer.publicKey.toBase58()}`);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);

  const vaultBefore = await program.account.vaultState.fetch(vaultPda);
  console.log(`Authority: ${vaultBefore.authority.toBase58()}`);
  console.log(`Strategies: ${vaultBefore.strategyCount.toString()}`);
  console.log(`TVL before: ${vaultBefore.totalDeposited.toNumber() / 1e6} USDC`);

  const isAuthority = vaultBefore.authority.equals(payer.publicKey);
  if (!isAuthority) {
    console.log("(payer is NOT the vault authority — strategy mints will be sent but report_yield will be skipped)");
  }

  // --- 1. Mint to user wallet ---
  console.log(`\n1. Minting ${TARGET_USER_AMOUNT / 1e6} USDC to ${TARGET_WALLET.toBase58()}`);
  const userAta = await getOrCreateAssociatedTokenAccount(connection, payer, TOKEN_MINT, TARGET_WALLET);
  const userBefore = Number((await getAccount(connection, userAta.address)).amount);
  const sigU = await mintTo(connection, payer, TOKEN_MINT, userAta.address, payer, TARGET_USER_AMOUNT);
  await confirm(connection, sigU);
  const userAfter = Number((await getAccount(connection, userAta.address)).amount);
  console.log(`   ATA: ${userAta.address.toBase58()}`);
  console.log(`   Balance: ${userBefore / 1e6} -> ${userAfter / 1e6} USDC (+${(userAfter - userBefore) / 1e6})`);

  // --- 2. Mint to each strategy ATA + report_yield ---
  let mintedToStrategies = 0;
  let reportedYield = 0;

  for (let id = 0; id < vaultBefore.strategyCount.toNumber(); id++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [sToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const sData = await program.account.strategyAllocation.fetch(sPda);
    if (!sData.isActive) {
      console.log(`\nStrategy #${id}: inactive — skip`);
      continue;
    }

    const balBefore = Number((await getAccount(connection, sToken)).amount);
    const sig = await mintTo(connection, payer, TOKEN_MINT, sToken, payer, PER_STRATEGY_AMOUNT);
    await confirm(connection, sig);
    const balAfter = Number((await getAccount(connection, sToken)).amount);
    mintedToStrategies += PER_STRATEGY_AMOUNT;
    console.log(`\nStrategy #${id}`);
    console.log(`   ATA: ${sToken.toBase58()}`);
    console.log(`   Balance: ${balBefore / 1e6} -> ${balAfter / 1e6} USDC`);

    if (isAuthority) {
      const sigY = await program.methods
        .reportYield()
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: vaultPda,
          strategy: sPda,
          strategyTokenAccount: sToken,
        })
        .rpc();
      await confirm(connection, sigY);
      reportedYield += PER_STRATEGY_AMOUNT;
      console.log(`   report_yield ✓`);
    }
  }

  // --- 3. Verify ---
  const vaultAfter = await program.account.vaultState.fetch(vaultPda);
  const tvlBefore = vaultBefore.totalDeposited.toNumber();
  const tvlAfter = vaultAfter.totalDeposited.toNumber();
  const tvlDelta = tvlAfter - tvlBefore;

  console.log("\n=== Result ===");
  console.log(`User mint:           +${TARGET_USER_AMOUNT / 1e6} USDC`);
  console.log(`Strategy mints:      +${mintedToStrategies / 1e6} USDC across active strategies`);
  console.log(`TVL before:           ${tvlBefore / 1e6} USDC`);
  console.log(`TVL after:            ${tvlAfter / 1e6} USDC`);
  console.log(`TVL delta:            ${tvlDelta / 1e6} USDC`);

  if (isAuthority) {
    const ok = tvlDelta === reportedYield;
    console.log(`Expected delta:       ${reportedYield / 1e6} USDC`);
    console.log(ok ? "✓ TVL increased exactly as expected" : "✗ TVL delta does NOT match reported yield");
    if (!ok) process.exit(1);
  } else {
    console.log("(no report_yield calls — TVL won't move until the vault authority reports)");
  }
}

main().catch((e) => {
  console.error("\nFailed:", e.message ?? e);
  process.exit(1);
});
