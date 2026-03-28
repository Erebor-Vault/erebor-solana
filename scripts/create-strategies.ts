/**
 * create-strategies.ts — Create 5 mock strategies with AI agent delegate wallets,
 * set target weights, and rebalance.
 *
 * Uses the target wallet (8qKt...) as admin via the vault where admin was transferred.
 * Since we don't have the target wallet's private key here, this script uses
 * the payer wallet (id.json). If admin was transferred, you need to run this
 * from the admin wallet.
 *
 * Usage:
 *   npx ts-mocha scripts/create-strategies.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// -------------------------------------------------------------------
// Config
// -------------------------------------------------------------------
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const TOKEN_MINT = new PublicKey("2RS6ChP1ALZK3hKyr549dFJj8jNDK7SUP2eL2YTTAMRF");

// 5 mock AI agent strategies
const STRATEGIES = [
  { name: "AI Lending Agent (Kamino)",   weightBps: 2500 }, // 25%
  { name: "AI Yield Agent (Drift)",      weightBps: 2000 }, // 20%
  { name: "AI LP Agent (Raydium)",       weightBps: 1500 }, // 15%
  { name: "AI Staking Agent (MarginFi)", weightBps: 1000 }, // 10%
  { name: "AI Arbitrage Agent (Jupiter)", weightBps: 500 },  // 5%
];
// Total: 75%, 25% stays in reserve

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function loadWallet(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const payer = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;

  // Derive vault PDA
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  const vault = await program.account.vaultState.fetch(vaultPda);
  console.log("\n=== Create Mock AI Agent Strategies ===\n");
  console.log(`Vault PDA:       ${vaultPda.toBase58()}`);
  console.log(`Vault Admin:     ${vault.admin.toBase58()}`);
  console.log(`Vault Authority: ${vault.authority.toBase58()}`);
  console.log(`Signer:          ${payer.publicKey.toBase58()}`);

  // Check signer is admin
  if (!vault.admin.equals(payer.publicKey)) {
    console.error(`\nError: Signer is not the vault admin.`);
    console.error(`Admin is ${vault.admin.toBase58()}, but signer is ${payer.publicKey.toBase58()}`);
    console.error(`\nTransferring admin back to payer for strategy creation...`);

    // This won't work if we don't have the admin key. Let's check if we need to.
    console.error(`You need to run this from the admin wallet or transfer admin first.`);
    process.exit(1);
  }

  const currentCount = vault.strategyCount.toNumber();
  console.log(`Current strategies: ${currentCount}\n`);

  // Generate AI agent keypairs (these simulate external agent wallets)
  const agentKeypairs: Keypair[] = [];
  const strategyResults: {
    id: number;
    name: string;
    pda: string;
    tokenAccount: string;
    delegate: string;
    weightBps: number;
  }[] = [];

  for (let i = 0; i < STRATEGIES.length; i++) {
    const strategyIndex = currentCount + i;
    const agentKeypair = Keypair.generate();
    agentKeypairs.push(agentKeypair);

    const [sPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy"),
        vaultPda.toBuffer(),
        new BN(strategyIndex).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [sToken] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy_token"),
        vaultPda.toBuffer(),
        new BN(strategyIndex).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Create strategy
    console.log(`Creating Strategy #${strategyIndex}: ${STRATEGIES[i].name}`);
    await program.methods
      .createStrategy()
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: sPda,
        tokenMint: TOKEN_MINT,
        strategyTokenAccount: sToken,
        delegate: agentKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Set weight
    await program.methods
      .setStrategyWeight(STRATEGIES[i].weightBps)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: sPda,
      })
      .rpc();

    console.log(`   PDA:      ${sPda.toBase58()}`);
    console.log(`   Token:    ${sToken.toBase58()}`);
    console.log(`   Delegate: ${agentKeypair.publicKey.toBase58()}`);
    console.log(`   Weight:   ${STRATEGIES[i].weightBps / 100}%\n`);

    strategyResults.push({
      id: strategyIndex,
      name: STRATEGIES[i].name,
      pda: sPda.toBase58(),
      tokenAccount: sToken.toBase58(),
      delegate: agentKeypair.publicKey.toBase58(),
      weightBps: STRATEGIES[i].weightBps,
    });
  }

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log("=== Strategies Created ===\n");
  console.log("| # | Name | Delegate | Weight |");
  console.log("|---|------|----------|--------|");
  for (const s of strategyResults) {
    console.log(
      `| ${s.id} | ${s.name} | \`${s.delegate}\` | ${s.weightBps / 100}% |`
    );
  }

  console.log("\n--- Markdown for DEPLOYMENT.md ---\n");
  console.log("## Devnet Strategies\n");
  console.log("| # | Name | Delegate (AI Agent Wallet) | Weight | Strategy PDA | Token Account |");
  console.log("|---|------|---------------------------|--------|--------------|---------------|");
  for (const s of strategyResults) {
    console.log(
      `| ${s.id} | ${s.name} | \`${s.delegate}\` | ${s.weightBps / 100}% | \`${s.pda}\` | \`${s.tokenAccount}\` |`
    );
  }
  console.log(`\nTotal allocated weight: ${STRATEGIES.reduce((sum, s) => sum + s.weightBps, 0) / 100}% (${100 - STRATEGIES.reduce((sum, s) => sum + s.weightBps, 0) / 100}% reserve)`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
