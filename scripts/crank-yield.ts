/**
 * crank-yield.ts — Simulate yield across the vault's strategies.
 *
 * Three independent simulation modes, all optional:
 *
 *   1. (default) per-strategy report_yield. For each active strategy whose ATA
 *      balance stays put (the mock-agent strategies), mint a configurable rate
 *      worth of tokens directly into the strategy ATA, then call
 *      `report_yield` so the vault's `total_deposited` reflects the surplus.
 *
 *   2. --simulate-kamino <micro-usdc>. Calls mock_kamino.simulate_yield on
 *      the reserve for `--mint`, adding the requested amount of underlying to
 *      the reserve's liquidity supply. This raises the cToken redemption
 *      rate without touching the strategy ATA — the right primitive for the
 *      kamino_looper, whose collateral lives in cTokens, not idle USDC.
 *
 *   3. --simulate-lulo <micro-usdc>. Mints the requested amount directly into
 *      the mock_lulo treasury PDA. mock_lulo has no on-chain yield mechanism
 *      so this is the test-harness equivalent. The lulo agent will see the
 *      surplus on its next withdraw — treasury balance > deposited principal.
 *
 * --no-report-yield disables mode 1 if you only want the protocol-side
 * simulations.
 *
 * Usage:
 *   bun scripts/crank-yield.ts --mint <USDC>
 *   bun scripts/crank-yield.ts --mint <USDC> --simulate-kamino 1000000
 *   bun scripts/crank-yield.ts --mint <USDC> --simulate-lulo 500000 --simulate-kamino 1000000
 *   bun scripts/crank-yield.ts --mint <USDC> --loop 30
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { MockKamino } from "../target/types/mock_kamino";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  mintTo,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// =============================================================================
// CONFIG
// =============================================================================

const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_WALLET = "./id.json";
const DEFAULT_YIELD_BPS = 500; // 5% per crank

function loadWallet(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf-8")))
  );
}

// =============================================================================
// CLI
// =============================================================================

interface Args {
  rpcUrl: string;
  walletPath: string;
  tokenMint: PublicKey | null;
  vaultId: number;
  yieldBps: number;
  loopSeconds: number;
  noReportYield: boolean;
  simulateKamino: number;
  simulateLulo: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = {
    rpcUrl: process.env.RPC_URL || DEFAULT_RPC,
    walletPath: DEFAULT_WALLET,
    tokenMint: process.env.TOKEN_MINT ? new PublicKey(process.env.TOKEN_MINT) : null,
    vaultId: 0,
    yieldBps: DEFAULT_YIELD_BPS,
    loopSeconds: 0,
    noReportYield: false,
    simulateKamino: 0,
    simulateLulo: 0,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--rpc":              out.rpcUrl = args[++i]; break;
      case "--wallet":           out.walletPath = args[++i]; break;
      case "--mint":             out.tokenMint = new PublicKey(args[++i]); break;
      case "--vault-id":         out.vaultId = Number(args[++i]); break;
      case "--yield-bps":        out.yieldBps = Number(args[++i]); break;
      case "--loop":             out.loopSeconds = Number(args[++i]) || 30; break;
      case "--no-report-yield":  out.noReportYield = true; break;
      case "--simulate-kamino":  out.simulateKamino = Number(args[++i]); break;
      case "--simulate-lulo":    out.simulateLulo = Number(args[++i]); break;
    }
  }

  if (!out.tokenMint) {
    console.error("--mint <USDC> required (or set TOKEN_MINT env var)");
    process.exit(1);
  }

  return out;
}

// =============================================================================
// PER-STRATEGY report_yield
// =============================================================================

async function crankReportYield(
  program: Program<MyProject>,
  connection: anchor.web3.Connection,
  payer: Keypair,
  vaultPda: PublicKey,
  tokenMint: PublicKey,
  yieldBps: number
): Promise<number> {
  const vault = await program.account.vaultState.fetch(vaultPda);
  const strategyCount = vault.strategyCount.toNumber();
  if (strategyCount === 0) {
    console.log("  No strategies — skipping report_yield");
    return 0;
  }

  let totalYield = 0;
  for (let i = 0; i < strategyCount; i++) {
    const [sPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(i).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const strategy = await program.account.strategyAllocation.fetch(sPda);
    if (!strategy.isActive) continue;

    const allocated = strategy.allocatedAmount.toNumber();
    if (allocated <= 0) continue;

    // Read the strategy ATA balance — only crank yield when funds are
    // actually parked in the ATA. Strategies that have already deployed
    // funds to a protocol (kamino, lulo) hold ≈0 in their ATA, so their
    // yield is simulated via the protocol-side modes below.
    const ataBal = await connection
      .getTokenAccountBalance(strategy.tokenAccount)
      .then((r) => Number(r.value.amount))
      .catch(() => 0);
    if (ataBal < allocated) {
      console.log(`  Strategy #${i}: deployed (ATA<allocated) — skipping report_yield`);
      continue;
    }

    const yieldAmount = Math.floor((allocated * yieldBps) / 10_000);
    if (yieldAmount <= 0) continue;

    await mintTo(connection, payer, tokenMint, strategy.tokenAccount, payer, yieldAmount);

    await program.methods
      .reportYield()
      .accountsStrict({
        authority: payer.publicKey,
        vaultState: vaultPda,
        strategy: sPda,
        strategyTokenAccount: strategy.tokenAccount,
      })
      .rpc();

    totalYield += yieldAmount;
    console.log(
      `  Strategy #${i}: +${(yieldAmount / 1e6).toFixed(4)} USDC (${yieldBps / 100}% of ${(allocated / 1e6).toFixed(2)})`
    );
  }
  return totalYield;
}

// =============================================================================
// PROTOCOL-SIDE SIMULATIONS
// =============================================================================

async function simulateKaminoYield(
  kaminoProgram: Program<MockKamino>,
  payer: Keypair,
  tokenMint: PublicKey,
  amount: number
): Promise<void> {
  const [reservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), tokenMint.toBuffer()],
    kaminoProgram.programId
  );
  const liquiditySupplyAta = getAssociatedTokenAddressSync(tokenMint, reservePda, true);

  await kaminoProgram.methods
    .simulateYield(new BN(amount))
    .accountsStrict({
      admin: payer.publicKey,
      reserve: reservePda,
      liquidityMint: tokenMint,
      liquiditySupply: liquiditySupplyAta,
      liquidityMintAuthority: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(
    `  Kamino reserve: +${(amount / 1e6).toFixed(4)} USDC liquidity (cToken redemption rate up)`
  );
}

async function simulateLuloYield(
  connection: anchor.web3.Connection,
  payer: Keypair,
  tokenMint: PublicKey,
  amount: number
): Promise<void> {
  // mock_lulo.treasury is a token account at PDA seeds ["treasury", mint],
  // owned by itself. We can mint directly into it because the underlying
  // test mint's mint_authority is the payer wallet.
  const luloIdl = JSON.parse(fs.readFileSync("./target/idl/mock_lulo.json", "utf-8"));
  const luloProgramId = new PublicKey(luloIdl.address);
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), tokenMint.toBuffer()],
    luloProgramId
  );
  await mintTo(connection, payer, tokenMint, treasuryPda, payer, amount);
  console.log(
    `  Lulo treasury: +${(amount / 1e6).toFixed(4)} USDC (next agent withdraw will see surplus)`
  );
}

// =============================================================================
// MAIN
// =============================================================================

async function crankOnce(args: Args): Promise<void> {
  const connection = new anchor.web3.Connection(args.rpcUrl, "confirmed");
  const payer = loadWallet(args.walletPath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const tokenMint = args.tokenMint!;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), new BN(args.vaultId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );

  if (!args.noReportYield) {
    console.log("[report_yield] crank...");
    await crankReportYield(vaultProgram, connection, payer, vaultPda, tokenMint, args.yieldBps);
  }

  if (args.simulateKamino > 0) {
    console.log("[mock_kamino.simulate_yield]...");
    const kaminoProgram = anchor.workspace.mockKamino as Program<MockKamino>;
    await simulateKaminoYield(kaminoProgram, payer, tokenMint, args.simulateKamino);
  }

  if (args.simulateLulo > 0) {
    console.log("[mock_lulo treasury mint]...");
    await simulateLuloYield(connection, payer, tokenMint, args.simulateLulo);
  }

  // Print updated TVL + share price.
  const vault = await vaultProgram.account.vaultState.fetch(vaultPda);
  const shareSupply = await connection.getTokenSupply(vault.shareMint);
  const sharePrice = vault.totalDeposited.toNumber() / Math.max(1, Number(shareSupply.value.amount));
  console.log(
    `  TVL: ${(vault.totalDeposited.toNumber() / 1e6).toFixed(2)} USDC | share_price: ${sharePrice.toFixed(6)}`
  );
}

async function main() {
  const args = parseArgs();

  if (args.loopSeconds > 0) {
    console.log(`Cranking every ${args.loopSeconds}s. Ctrl+C to stop.\n`);
    const run = async () => {
      const ts = new Date().toLocaleTimeString();
      console.log(`[${ts}] Cranking…`);
      try {
        await crankOnce(args);
      } catch (err: any) {
        console.error(`  Error:`, err?.message || err);
      }
    };
    await run();
    setInterval(run, args.loopSeconds * 1000);
  } else {
    await crankOnce(args);
  }
}

main().catch((err) => {
  console.error("Crank failed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
