/**
 * setup-kamino-strategy.ts — Full setup for the kamino_looper agent.
 *
 * Steps:
 *   1. Create test mints (USDC, BTC, SOL) — or use existing ones
 *   2. Initialize mock_kamino oracle, reserves, treasury for each asset
 *   3. Initialize mock_jupiter oracle, pools, fund liquidity
 *   4. Create or reuse the Erebor vault for USDC
 *   5. Create a strategy with the kamino_looper agent keypair as delegate
 *   6. Initialize obligation for the strategy in mock_kamino
 *   7. Whitelist mock_kamino deposit/withdraw/borrow/repay actions
 *   8. Mint test USDC, deposit into vault, allocate to strategy
 *   9. Print agent .env values
 *
 * Usage:
 *   bunx ts-node scripts/setup-kamino-strategy.ts --delegate ./agent_keypair.json
 *
 * Default amounts (override via flags):
 *   --weight 5000   (50% of vault → strategy)
 *   --deposit 100000000   (100 USDC)
 *   --allocate 50000000   (50 USDC)
 *
 * Optional mint flags (reuse existing mints instead of creating new ones):
 *   --mint <USDC>       Reuse an existing USDC mint (e.g. one created by create-strategies.ts)
 *   --btc-mint <BTC>    Reuse an existing BTC mint
 *   --sol-mint <SOL>    Reuse an existing SOL mint
 *   --vault-id <N>      Vault ID (default 0). Use 0 to share a vault with the Lulo strategy.
 *
 * The script is idempotent: if the oracle/reserve/pool/vault/strategy/obligation
 * already exist on-chain, it skips initialization and reuses them.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { MockKamino } from "../target/types/mock_kamino";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import bs58 from "bs58";
import { createHash } from "crypto";

// -------------------------------------------------------------------
// Asset codes (must match mock_kamino enum order)
// -------------------------------------------------------------------
const ASSET_USDC = 0;
const ASSET_BTC = 1;
const ASSET_SOL = 2;

// Default initial prices (micro-USD per smallest unit)
// USDC: 1 USDC = 1_000_000 micro-USD
// BTC:  1 micro-BTC = 60_000 micro-USD (1 BTC = 60_000 USD with 6 decimals)
// SOL:  1 micro-SOL = 150 micro-USD (1 SOL = 150 USD with 6 decimals)
const DEFAULT_USDC_PRICE = 1_000_000;
const DEFAULT_BTC_PRICE = 60_000_000_000;
const DEFAULT_SOL_PRICE = 150_000_000;

// -------------------------------------------------------------------
// CLI parsing
// -------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let delegatePath = "";
  let weightBps = 5000;
  let depositAmount = 100_000_000;
  let allocateAmount = 50_000_000;
  let rpcUrl = "https://api.devnet.solana.com";
  let walletPath = "./id.json";
  let usdcMintArg = "";
  let btcMintArg = "";
  let solMintArg = "";
  let vaultId = 0;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--delegate":  delegatePath = args[++i]; break;
      case "--weight":    weightBps = Number(args[++i]); break;
      case "--deposit":   depositAmount = Number(args[++i]); break;
      case "--allocate":  allocateAmount = Number(args[++i]); break;
      case "--rpc":       rpcUrl = args[++i]; break;
      case "--wallet":    walletPath = args[++i]; break;
      case "--mint":      usdcMintArg = args[++i]; break;
      case "--btc-mint":  btcMintArg = args[++i]; break;
      case "--sol-mint":  solMintArg = args[++i]; break;
      case "--vault-id":  vaultId = Number(args[++i]); break;
    }
  }

  if (!delegatePath) {
    console.error("Error: --delegate is required");
    process.exit(1);
  }

  return { delegatePath, weightBps, depositAmount, allocateAmount, rpcUrl, walletPath, usdcMintArg, btcMintArg, solMintArg, vaultId };
}

async function accountExists(connection: anchor.web3.Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(name: string): number[] {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Array.from(hash.subarray(0, 8));
}

async function confirmTx(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const delegateKeypair = loadKeypair(opts.delegatePath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const kaminoProgram = anchor.workspace.mockKamino as Program<MockKamino>;

  console.log("\n=== Erebor Kamino Looper Setup ===\n");
  console.log(`Deployer:      ${payer.publicKey.toBase58()}`);
  console.log(`Agent:         ${delegateKeypair.publicKey.toBase58()}`);
  console.log(`Vault Program: ${vaultProgram.programId.toBase58()}`);
  console.log(`Kamino:        ${kaminoProgram.programId.toBase58()}`);
  console.log(`Jupiter:       (closed — deferred, see TODO.md)\n`);

  // ── Step 1: Resolve mints (reuse if provided, else create) ─────────────
  console.log("1. Resolving token mints (USDC, BTC, SOL)...");
  const usdcMint = opts.usdcMintArg
    ? new PublicKey(opts.usdcMintArg)
    : await createMint(connection, payer, payer.publicKey, null, 6);
  const btcMint = opts.btcMintArg
    ? new PublicKey(opts.btcMintArg)
    : await createMint(connection, payer, payer.publicKey, null, 6);
  const solMint = opts.solMintArg
    ? new PublicKey(opts.solMintArg)
    : await createMint(connection, payer, payer.publicKey, null, 6);
  console.log(`   USDC: ${usdcMint.toBase58()}${opts.usdcMintArg ? " (reused)" : " (new)"}`);
  console.log(`   BTC:  ${btcMint.toBase58()}${opts.btcMintArg ? " (reused)" : " (new)"}`);
  console.log(`   SOL:  ${solMint.toBase58()}${opts.solMintArg ? " (reused)" : " (new)"}`);

  // ── Step 2: Initialize mock_kamino oracle + reserves ───────────────────
  console.log("\n2. Initializing mock_kamino oracle and reserves...");
  const [kaminoOraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("prices")],
    kaminoProgram.programId
  );

  if (await accountExists(connection, kaminoOraclePda)) {
    console.log(`   Kamino oracle already exists at ${kaminoOraclePda.toBase58()} (reusing)`);
  } else {
    await kaminoProgram.methods
      .initializeOracle(
        new BN(DEFAULT_USDC_PRICE),
        new BN(DEFAULT_BTC_PRICE),
        new BN(DEFAULT_SOL_PRICE)
      )
      .accountsStrict({
        admin: payer.publicKey,
        oracle: kaminoOraclePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   Kamino oracle: ${kaminoOraclePda.toBase58()}`);
  }

  // Initialize reserves for each asset (supply 6%, borrow 4%)
  for (const [name, mint] of [["USDC", usdcMint], ["BTC", btcMint], ["SOL", solMint]] as const) {
    const [reservePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), mint.toBuffer()],
      kaminoProgram.programId
    );
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), mint.toBuffer()],
      kaminoProgram.programId
    );

    if (await accountExists(connection, reservePda)) {
      console.log(`   ${name} reserve already exists at ${reservePda.toBase58()} (reusing)`);
    } else {
      await kaminoProgram.methods
        .initializeReserve(600, 400) // 6% supply, 4% borrow
        .accountsStrict({
          payer: payer.publicKey,
          mint,
          reserve: reservePda,
          treasury: treasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`   ${name} reserve: ${reservePda.toBase58()}`);

      // Fund the reserve treasury so borrowing has liquidity
      await mintTo(connection, payer, mint, treasuryPda, payer, 1_000_000_000);
      console.log(`   ${name} treasury seeded with 1000 tokens`);
    }
  }

  // ── Step 3: (removed) mock_jupiter init ────────────────────────────────
  // mock_jupiter was closed on devnet to reclaim rent since no agent uses
  // swaps yet. Jupiter swaps are deferred — see agent/kamino_looper/TODO.md
  // items #13 (slippage retry) and #19 (Jupiter quote API). Restore this
  // block when hedges/rewards land and the program is redeployed.
  console.log("\n3. Skipping mock_jupiter init (program closed — see TODO.md)");

  // ── Step 4: Initialize Erebor vault (or reuse existing) ────────────────
  console.log(`\n4. Initializing Erebor vault for USDC (vault_id=${opts.vaultId})...`);
  const vaultId = new BN(opts.vaultId);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), usdcMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    vaultProgram.programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({ mint: usdcMint, owner: vaultPda });

  if (await accountExists(connection, vaultPda)) {
    console.log(`   Vault already exists at ${vaultPda.toBase58()} (reusing)`);
  } else {
    await vaultProgram.methods
      .initializeVault(vaultId)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        tokenMint: usdcMint,
        shareMint: shareMintPda,
        reserveAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`   Vault PDA: ${vaultPda.toBase58()}`);
  }

  // ── Step 5: Create strategy ────────────────────────────────────────────
  // Read strategy_count from the existing vault so this script appends
  // a fresh strategy slot rather than trying to claim slot 0 (which may be
  // taken by a sibling strategy like the Lulo agent).
  const vaultState = await vaultProgram.account.vaultState.fetch(vaultPda);
  const strategyIndex = vaultState.strategyCount.toNumber();
  console.log(`\n5. Creating strategy #${strategyIndex} with kamino_looper as delegate...`);
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );

  if (await accountExists(connection, strategyPda)) {
    console.log(`   Strategy already exists at ${strategyPda.toBase58()} (reusing)`);
  } else {
    await vaultProgram.methods
      .createStrategy()
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
        tokenMint: usdcMint,
        strategyTokenAccount: strategyTokenPda,
        delegate: delegateKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`   Strategy PDA: ${strategyPda.toBase58()}`);
    console.log(`   Strategy token: ${strategyTokenPda.toBase58()}`);

    await vaultProgram.methods
      .setStrategyWeight(opts.weightBps)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
      })
      .rpc();
  }

  // ── Step 6: Initialize obligation + ProtocolPosition for the strategy ─
  console.log("\n6. Initializing kamino obligation + ProtocolPosition for strategy...");
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), strategyTokenPda.toBuffer()],
    kaminoProgram.programId
  );
  if (await accountExists(connection, obligationPda)) {
    console.log(`   Obligation already exists at ${obligationPda.toBase58()} (reusing)`);
  } else {
    await kaminoProgram.methods
      .initializeObligation()
      .accountsStrict({
        payer: payer.publicKey,
        strategyTokenAccount: strategyTokenPda,
        obligation: obligationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   Obligation PDA: ${obligationPda.toBase58()}`);
  }

  // ProtocolPosition adapter (for ERC-4626 totalAssets parity on the frontend).
  const [kaminoPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    kaminoProgram.programId
  );
  if (await accountExists(connection, kaminoPositionPda)) {
    console.log(`   ProtocolPosition already exists at ${kaminoPositionPda.toBase58()} (reusing)`);
  } else {
    await kaminoProgram.methods
      .initializeKaminoPosition()
      .accountsStrict({
        payer: payer.publicKey,
        strategyTokenAccount: strategyTokenPda,
        position: kaminoPositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   ProtocolPosition PDA: ${kaminoPositionPda.toBase58()}`);
  }

  // ── Step 7: Whitelist mock_kamino actions ──────────────────────────────
  console.log("\n7. Whitelisting mock_kamino actions...");
  const actions = [
    { name: "deposit", disc: anchorDiscriminator("deposit") },
    { name: "withdraw", disc: anchorDiscriminator("withdraw") },
    { name: "borrow", disc: anchorDiscriminator("borrow") },
    { name: "repay", disc: anchorDiscriminator("repay") },
  ];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const strategy = await vaultProgram.account.strategyAllocation.fetch(strategyPda);
    const [actionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowed_action"), strategyPda.toBuffer(), new BN(strategy.actionCount).toArrayLike(Buffer, "le", 2)],
      vaultProgram.programId
    );
    await vaultProgram.methods
      .addAllowedAction(kaminoProgram.programId, action.disc)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
        allowedAction: actionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   #${i}: ${action.name} → ${actionPda.toBase58()}`);
  }

  // ── Step 8: Fund deployer + deposit + allocate ─────────────────────────
  console.log("\n8. Minting test USDC and funding the strategy...");
  const payerAta = anchor.utils.token.associatedAddress({ mint: usdcMint, owner: payer.publicKey });
  if (!(await accountExists(connection, payerAta))) {
    await createAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey);
  }
  await mintTo(connection, payer, usdcMint, payerAta, payer, opts.depositAmount * 2);

  const payerShareAta = anchor.utils.token.associatedAddress({ mint: shareMintPda, owner: payer.publicKey });
  await vaultProgram.methods
    .deposit(new BN(opts.depositAmount))
    .accountsStrict({
      user: payer.publicKey,
      vaultState: vaultPda,
      tokenMint: usdcMint,
      shareMint: shareMintPda,
      userTokenAccount: payerAta,
      reserveAta,
      userShareToken: payerShareAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`   Deposited ${(opts.depositAmount / 1e6).toFixed(2)} USDC`);

  await vaultProgram.methods
    .allocateToStrategy(new BN(opts.allocateAmount))
    .accountsStrict({
      authority: payer.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      tokenMint: usdcMint,
      reserveAta,
      strategyTokenAccount: strategyTokenPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`   Allocated ${(opts.allocateAmount / 1e6).toFixed(2)} USDC to strategy`);

  // ── Step 9: Print agent .env ──────────────────────────────────────────
  console.log("\n=== Setup Complete ===\n");
  console.log("--- Copy to agent/kamino_looper/.env ---\n");
  console.log(`SOLANA_PRIVATE_KEY=${bs58.encode(delegateKeypair.secretKey)}`);
  console.log(`RPC_URL=${opts.rpcUrl}`);
  console.log(`VAULT_TOKEN_MINT=${usdcMint.toBase58()}`);
  console.log(`VAULT_ID=0`);
  console.log(`STRATEGY_ID=${strategyIndex}`);
  console.log(`KAMINO_PROGRAM_ID=${kaminoProgram.programId.toBase58()}`);
  // JUPITER_PROGRAM_ID intentionally omitted — mock_jupiter is closed (see TODO.md)
  console.log(`USDC_MINT=${usdcMint.toBase58()}`);
  console.log(`BTC_MINT=${btcMint.toBase58()}`);
  console.log(`SOL_MINT=${solMint.toBase58()}`);
  console.log(`EVAL_INTERVAL_MS=300000`);
  console.log(`MAX_LEVERAGE=2.0`);
  console.log(`TARGET_LEVERAGE_MIN=2.0`);
  console.log(`TARGET_LEVERAGE_MAX=2.0`);
  console.log(`MIN_LOOP_NET_APY_PCT=1.5`);
  console.log(`HF_COMFORTABLE=1.8`);
  console.log(`HF_WARNING=1.3`);
  console.log(`DRY_RUN=false`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
