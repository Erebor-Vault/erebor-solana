/**
 * crank-yield.ts — Simulate yield on all active strategies.
 *
 * Each run mints tokens into strategy accounts (based on their yield rate)
 * and calls report_yield to update vault accounting.
 *
 * Usage:
 *   bunx ts-node scripts/crank-yield.ts                  # run once
 *   bunx ts-node scripts/crank-yield.ts --loop 30        # run every 30 seconds
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// -------------------------------------------------------------------
// Config — update TOKEN_MINT to match your setup
// -------------------------------------------------------------------
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const TOKEN_MINT = new PublicKey(
  process.env.TOKEN_MINT || "3M2nY5QJdEpBCZ19QK4edNKSV1L8dNSEP3AMj64MqfUP"
);

// Yield rates per strategy (basis points per crank)
// Match these to what you used in setup-devnet.ts
const YIELD_BPS: Record<number, number> = {
  0: 500,  // 5%
  1: 1000, // 10%
  2: 2000, // 20%
};

function loadWallet(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf-8")))
  );
}

async function confirmTx(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature: sig,
  });
}

async function crankOnce(
  program: Program<MyProject>,
  connection: anchor.web3.Connection,
  walletKeypair: Keypair,
  vaultPda: PublicKey
) {
  const vault = await program.account.vaultState.fetch(vaultPda);
  const strategyCount = vault.strategyCount.toNumber();

  if (strategyCount === 0) {
    console.log("  No strategies found.");
    return;
  }

  let totalYield = 0;

  for (let i = 0; i < strategyCount; i++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy"),
        vaultPda.toBuffer(),
        new BN(i).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const strategy = await program.account.strategyAllocation.fetch(sPda);
    if (!strategy.isActive) {
      console.log(`  Strategy #${i}: inactive, skipping`);
      continue;
    }

    const currentBalance = strategy.allocatedAmount.toNumber();
    const yieldBps = YIELD_BPS[i] ?? 500;
    const yieldAmount = Math.floor((currentBalance * yieldBps) / 10_000);

    if (yieldAmount <= 0) {
      console.log(`  Strategy #${i}: no funds allocated, skipping`);
      continue;
    }

    // Mint yield tokens into strategy token account
    const sig = await mintTo(
      connection,
      walletKeypair,
      TOKEN_MINT,
      strategy.tokenAccount,
      walletKeypair,
      yieldAmount
    );
    await confirmTx(connection, sig);

    // Report yield to vault
    await program.methods
      .reportYield()
      .accountsStrict({
        authority: walletKeypair.publicKey,
        vaultState: vaultPda,
        strategy: sPda,
        strategyTokenAccount: strategy.tokenAccount,
      })
      .rpc();

    totalYield += yieldAmount;
    console.log(
      `  Strategy #${i}: +${(yieldAmount / 1e6).toFixed(4)} tokens (${yieldBps / 100}% of ${(currentBalance / 1e6).toFixed(2)})`
    );
  }

  // Print updated share price
  const updatedVault = await program.account.vaultState.fetch(vaultPda);
  const shareSupply = await connection.getTokenSupply(vault.shareMint);
  const sharePrice =
    updatedVault.totalDeposited.toNumber() /
    Number(shareSupply.value.amount);

  console.log(
    `  Total yield: +${(totalYield / 1e6).toFixed(4)} | TVL: ${(updatedVault.totalDeposited.toNumber() / 1e6).toFixed(2)} | Share price: ${sharePrice.toFixed(6)}`
  );
}

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const walletKeypair = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.myProject as Program<MyProject>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  // Parse --loop flag
  const loopArg = process.argv.indexOf("--loop");
  const intervalSec =
    loopArg !== -1 ? parseInt(process.argv[loopArg + 1]) || 30 : 0;

  if (intervalSec > 0) {
    console.log(
      `Cranking yield every ${intervalSec}s for vault ${vaultPda.toBase58()}\n`
    );
    const run = async () => {
      const now = new Date().toLocaleTimeString();
      console.log(`[${now}] Cranking...`);
      try {
        await crankOnce(program, connection, walletKeypair, vaultPda);
      } catch (err: any) {
        console.error(`  Error: ${err.message}`);
      }
    };
    await run();
    setInterval(run, intervalSec * 1000);
  } else {
    console.log(`Cranking yield once for vault ${vaultPda.toBase58()}\n`);
    await crankOnce(program, connection, walletKeypair, vaultPda);
  }
}

main().catch((err) => {
  console.error("Crank failed:", err.message || err);
  process.exit(1);
});
