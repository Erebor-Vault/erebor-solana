/**
 * crank-yield.ts — Simulate lending yield by minting tokens into the mock_lulo treasury.
 *
 * This script imitates what a real lending protocol does: the treasury grows
 * over time as borrowers pay interest. The AI agent sees the surplus in the
 * treasury, withdraws it to the strategy token account, and then the authority
 * calls report_yield to update vault accounting.
 *
 * Flow:
 *   1. Read how much each strategy has deposited into mock_lulo (treasury balance)
 *   2. Calculate yield: treasury_balance * annual_rate / periods_per_year
 *   3. Mint yield tokens into the mock_lulo treasury
 *   4. Agent detects surplus → withdraws via execute_strategy_action
 *   5. Authority calls report_yield → share price increases
 *
 * Usage:
 *   bunx ts-node scripts/crank-yield.ts                  # run once
 *   bunx ts-node scripts/crank-yield.ts --loop 60        # run every 60 seconds
 *
 * Environment:
 *   TOKEN_MINT=<address>   Override the token mint (default: hardcoded below)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MockLulo } from "../target/types/mock_lulo";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mintTo } from "@solana/spl-token";
import * as fs from "fs";

// -------------------------------------------------------------------
// Config
// -------------------------------------------------------------------
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json"; // must be the token mint authority
const TOKEN_MINT = new PublicKey(
  process.env.TOKEN_MINT || "3M2nY5QJdEpBCZ19QK4edNKSV1L8dNSEP3AMj64MqfUP"
);

// Annual yield rate as a decimal. 0.05 = 5% APY.
// Each crank applies: treasury_balance * ANNUAL_RATE / PERIODS_PER_YEAR
const ANNUAL_RATE = 0.05;

// How many times per year the crank runs.
// If --loop 60 (every 60s): 365 * 24 * 60 = 525600 periods/year
// If --loop 30 (every 30s): 1051200 periods/year
// Default assumes ~every 60 seconds.
const DEFAULT_INTERVAL_SEC = 60;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
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

// -------------------------------------------------------------------
// Core: mint yield into mock_lulo treasury
// -------------------------------------------------------------------
// Fractional yield accumulator — carries over sub-micro-USDC amounts between cranks.
// Without this, small balances (< ~200 USDC at 60s intervals) never generate any yield
// because Math.floor rounds the per-period amount to 0.
let accumulatedYield = 0;

async function crankOnce(
  connection: anchor.web3.Connection,
  walletKeypair: Keypair,
  mockLuloProgram: Program<MockLulo>,
  treasuryPda: PublicKey,
  intervalSec: number
) {
  // Read current treasury balance
  const treasuryInfo = await connection.getTokenAccountBalance(treasuryPda);
  const treasuryBalance = Number(treasuryInfo.value.amount);

  if (treasuryBalance === 0) {
    console.log("  Treasury empty — nothing to accrue yield on.");
    return 0;
  }

  // Calculate yield for this period (as a float, not floored yet):
  //   yield = balance * annual_rate / (seconds_per_year / interval_seconds)
  const secondsPerYear = 365.25 * 24 * 60 * 60;
  const periodsPerYear = secondsPerYear / intervalSec;
  const rawYield = treasuryBalance * ANNUAL_RATE / periodsPerYear;

  // Add to accumulator. Only mint when we have at least 1 micro-USDC.
  accumulatedYield += rawYield;
  const yieldAmount = Math.floor(accumulatedYield);

  if (yieldAmount <= 0) {
    console.log(
      `  Treasury: ${(treasuryBalance / 1e6).toFixed(2)} USDC — accumulating yield (${accumulatedYield.toFixed(4)} micro-USDC buffered)`
    );
    return 0;
  }

  // Subtract minted amount from accumulator, keep the fractional remainder
  accumulatedYield -= yieldAmount;

  // Mint yield tokens directly into the treasury.
  // This simulates borrowers paying interest — the treasury grows.
  const sig = await mintTo(
    connection,
    walletKeypair,
    TOKEN_MINT,
    treasuryPda,
    walletKeypair, // must be mint authority
    yieldAmount
  );
  await confirmTx(connection, sig);

  const newBalance = treasuryBalance + yieldAmount;
  console.log(
    `  Treasury: ${(treasuryBalance / 1e6).toFixed(4)} → ${(newBalance / 1e6).toFixed(4)} USDC (+${(yieldAmount / 1e6).toFixed(4)} yield)`
  );

  return yieldAmount;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const walletKeypair = loadWallet(WALLET_PATH);
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const mockLuloProgram = anchor.workspace.mockLulo as Program<MockLulo>;

  // Derive the mock_lulo treasury PDA for this token mint.
  // Seeds: ["treasury", token_mint] — matches mock_lulo program.
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), TOKEN_MINT.toBuffer()],
    mockLuloProgram.programId
  );

  // Check treasury exists
  const treasuryInfo = await connection.getAccountInfo(treasuryPda);
  if (!treasuryInfo) {
    console.error(
      `Treasury not found at ${treasuryPda.toBase58()}.\n` +
      `Run create-strategies.ts first to initialize the mock_lulo treasury.`
    );
    process.exit(1);
  }

  // Parse --loop flag
  const loopArg = process.argv.indexOf("--loop");
  const intervalSec =
    loopArg !== -1 ? parseInt(process.argv[loopArg + 1]) || DEFAULT_INTERVAL_SEC : DEFAULT_INTERVAL_SEC;

  const periodsPerYear = (365.25 * 24 * 60 * 60) / intervalSec;
  const perPeriodRate = ANNUAL_RATE / periodsPerYear;

  console.log(`\n=== Mock Lulo Yield Crank ===\n`);
  console.log(`Treasury:     ${treasuryPda.toBase58()}`);
  console.log(`Token Mint:   ${TOKEN_MINT.toBase58()}`);
  console.log(`Annual Rate:  ${(ANNUAL_RATE * 100).toFixed(1)}%`);
  console.log(`Interval:     ${intervalSec}s`);
  console.log(`Per-period:   ${(perPeriodRate * 100).toFixed(6)}%\n`);

  if (loopArg !== -1) {
    console.log(`Cranking every ${intervalSec}s. Press Ctrl+C to stop.\n`);

    const run = async () => {
      const now = new Date().toLocaleTimeString();
      console.log(`[${now}]`);
      try {
        await crankOnce(connection, walletKeypair, mockLuloProgram, treasuryPda, intervalSec);
      } catch (err: any) {
        console.error(`  Error: ${err.message}`);
      }
    };

    await run();
    setInterval(run, intervalSec * 1000);
  } else {
    console.log(`Running single crank...\n`);
    await crankOnce(connection, walletKeypair, mockLuloProgram, treasuryPda, intervalSec);
    console.log(`\nDone. Run with --loop ${intervalSec} for continuous yield simulation.`);
  }
}

main().catch((err) => {
  console.error("Crank failed:", err.message || err);
  process.exit(1);
});
