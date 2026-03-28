/**
 * simulate-yield.ts — Mint tokens directly into strategy token accounts
 * to simulate yield earned by AI agents, then report yield on-chain.
 *
 * Usage:
 *   npx ts-mocha scripts/simulate-yield.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mintTo } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// -------------------------------------------------------------------
// Config — edit these
// -------------------------------------------------------------------
const TOKEN_MINT = new PublicKey("6zrRz3TtZqfZuHmpzC5ZCVM99HoZ6wq6ptNN6d5nwTBR");
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json"; // must be the mint authority

// Yield to simulate per strategy (in tokens, 6 decimals)
// e.g. 5_000_000 = 5.0 tokens
const YIELD_PER_STRATEGY = [
  { strategyId: 0, yield: 12_500_000 },  // +12.5 tokens (Kamino 25% agent)
  { strategyId: 1, yield: 8_000_000 },   // +8.0 tokens  (Drift 20% agent)
  { strategyId: 2, yield: 4_500_000 },   // +4.5 tokens  (Raydium 15% agent)
  { strategyId: 3, yield: 2_000_000 },   // +2.0 tokens  (MarginFi 10% agent)
  { strategyId: 4, yield: 500_000 },     // +0.5 tokens  (Jupiter 5% agent)
];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function loadWallet(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function confirmTx(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)], program.programId
  );

  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log("\n=== Simulate Yield ===\n");
  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Total Deposited:  ${vault.totalDeposited.toNumber() / 1e6} tokens (before)\n`);

  let totalYield = 0;

  for (const entry of YIELD_PER_STRATEGY) {
    // Derive strategy token account
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(entry.strategyId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [sToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(entry.strategyId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const strategyData = await program.account.strategyAllocation.fetch(sPda);
    if (!strategyData.isActive) {
      console.log(`   Strategy #${entry.strategyId}: SKIPPED (inactive)`);
      continue;
    }

    const balBefore = await connection.getTokenAccountBalance(sToken);

    // Step 1: Mint tokens into strategy token account (simulates yield)
    const sig = await mintTo(
      connection, payer, TOKEN_MINT, sToken, payer, entry.yield
    );
    await confirmTx(connection, sig);

    const balAfter = await connection.getTokenAccountBalance(sToken);
    totalYield += entry.yield;

    console.log(`   Strategy #${entry.strategyId}: +${entry.yield / 1e6} tokens`);
    console.log(`      Balance: ${Number(balBefore.value.amount) / 1e6} -> ${Number(balAfter.value.amount) / 1e6}`);

    // Step 2: Report yield on-chain (updates vault accounting)
    // NOTE: Only the authority can call reportYield. If payer != authority, skip this.
    if (vault.authority.equals(payer.publicKey)) {
      await program.methods.reportYield().accountsStrict({
        authority: payer.publicKey,
        vaultState: vaultPda,
        strategy: sPda,
        strategyTokenAccount: sToken,
      }).rpc();
      console.log(`      Yield reported on-chain`);
    } else {
      console.log(`      Yield NOT reported (payer is not authority — report from admin panel)`);
    }
  }

  const vaultAfter = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nTotal yield simulated: ${totalYield / 1e6} tokens`);
  console.log(`Total Deposited:      ${vaultAfter.totalDeposited.toNumber() / 1e6} tokens (after)`);
  console.log(`\nYield is now visible in strategy balances.`);
  console.log(`Use "Report Yield" in the admin panel to update vault accounting.`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
