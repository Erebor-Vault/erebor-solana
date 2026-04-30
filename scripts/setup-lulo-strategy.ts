/**
 * setup-lulo-strategy.ts — Full setup for the lulo agent on the OLD_Erebor
 * account model.
 *
 * Steps:
 *   1. Resolve the underlying mint (USDC test mint) — reuse existing or create
 *   2. Initialize the Erebor vault (or reuse)
 *   3. Initialize mock_lulo's treasury for the mint (or reuse)
 *   4. Create a strategy with the lulo agent keypair as delegate
 *   5. Initialize the per-strategy ProtocolPosition at
 *      ["position", strategy_token_account]
 *   6. Whitelist mock_lulo's deposit (LEND) + withdraw with
 *      expected_recipient_index = 0 (strategy ATA at slot 0 in both ix layouts)
 *   7. Create the agent's underlying ATA (anti-theft snapshot point)
 *   8. Mint test USDC, deposit into vault, allocate to the strategy
 *   9. Print agent .env values
 *
 * Usage:
 *   bun scripts/setup-lulo-strategy.ts --delegate ./agent_keypair.json
 *
 * Default amounts (override via flags):
 *   --weight 5000           50% of vault → strategy
 *   --deposit 100000000     100 USDC test funds
 *   --allocate 50000000     50 USDC allocated to the strategy
 *
 * Optional:
 *   --mint <USDC>           Reuse an existing USDC mint
 *   --vault-id <N>          Default 0 (shared vault for lulo + kamino)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { MockLulo } from "../target/types/mock_lulo";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import bs58 from "bs58";
import { createHash } from "crypto";

// =============================================================================
// CONSTANTS — must match agent/lulo/src/strategy.ts
// =============================================================================

// mock_lulo's deposit ix is "LEND" in agent decisions; both deposit + withdraw
// place strategy_token_account at slot 0 in their account structs.
const LULO_DEPOSIT_IX = "deposit";
const LULO_WITHDRAW_IX = "withdraw";
const LULO_RECIPIENT_INDEX = 0;

// =============================================================================
// HELPERS
// =============================================================================

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function accountExists(connection: anchor.web3.Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let delegatePath = "";
  let weightBps = 5000;
  let depositAmount = 100_000_000;
  let allocateAmount = 50_000_000;
  let rpcUrl = "https://api.devnet.solana.com";
  let walletPath = "./id.json";
  let mintArg = "";
  let vaultId = 0;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--delegate": delegatePath = args[++i]; break;
      case "--weight":   weightBps = Number(args[++i]); break;
      case "--deposit":  depositAmount = Number(args[++i]); break;
      case "--allocate": allocateAmount = Number(args[++i]); break;
      case "--rpc":      rpcUrl = args[++i]; break;
      case "--wallet":   walletPath = args[++i]; break;
      case "--mint":     mintArg = args[++i]; break;
      case "--vault-id": vaultId = Number(args[++i]); break;
    }
  }

  if (!delegatePath) {
    console.error("Error: --delegate is required");
    process.exit(1);
  }
  return { delegatePath, weightBps, depositAmount, allocateAmount, rpcUrl, walletPath, mintArg, vaultId };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const opts = parseArgs();

  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const delegateKeypair = loadKeypair(opts.delegatePath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const luloProgram = anchor.workspace.mockLulo as Program<MockLulo>;

  console.log("\n=== Erebor Lulo Agent Setup ===\n");
  console.log(`Deployer:      ${payer.publicKey.toBase58()}`);
  console.log(`Agent:         ${delegateKeypair.publicKey.toBase58()}`);
  console.log(`Vault Program: ${vaultProgram.programId.toBase58()}`);
  console.log(`Lulo:          ${luloProgram.programId.toBase58()}\n`);

  // ── Step 1: Resolve mint ──────────────────────────────────────────────
  console.log("1. Resolving USDC mint...");
  const usdcMint = opts.mintArg
    ? new PublicKey(opts.mintArg)
    : await createMint(connection, payer, payer.publicKey, null, 6);
  console.log(`   USDC: ${usdcMint.toBase58()}${opts.mintArg ? " (reused)" : " (new)"}\n`);

  // ── Step 2: Initialize Erebor vault ───────────────────────────────────
  console.log(`2. Initializing Erebor vault (vault_id=${opts.vaultId})...`);
  const vaultId = new BN(opts.vaultId);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), usdcMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()],
    vaultProgram.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    vaultProgram.programId
  );
  const reserveAta = getAssociatedTokenAddressSync(usdcMint, vaultAuthorityPda, true);

  if (await accountExists(connection, vaultPda)) {
    console.log(`   Vault already exists at ${vaultPda.toBase58()} (reusing)`);
  } else {
    await vaultProgram.methods
      .initializeVault(vaultId)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        vaultAuthority: vaultAuthorityPda,
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
  console.log();

  // ── Step 3: Initialize mock_lulo treasury ─────────────────────────────
  console.log("3. Initializing mock_lulo treasury...");
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), usdcMint.toBuffer()],
    luloProgram.programId
  );
  if (await accountExists(connection, treasuryPda)) {
    console.log(`   Treasury already exists at ${treasuryPda.toBase58()} (reusing)`);
  } else {
    await luloProgram.methods
      .initializeTreasury()
      .accountsStrict({
        payer: payer.publicKey,
        mint: usdcMint,
        treasury: treasuryPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   Treasury PDA: ${treasuryPda.toBase58()}`);
  }
  console.log();

  // ── Step 4: Create strategy ───────────────────────────────────────────
  const vaultState = await vaultProgram.account.vaultState.fetch(vaultPda);
  const strategyIndex = vaultState.strategyCount.toNumber();
  console.log(`4. Creating strategy #${strategyIndex} with lulo agent as delegate...`);
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );

  if (await accountExists(connection, strategyPda)) {
    console.log(`   Strategy already exists at ${strategyPda.toBase58()} (reusing)`);
  } else {
    const existingStrategyMetas = [];
    for (let j = 0; j < strategyIndex; j++) {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(j).toArrayLike(Buffer, "le", 8)],
        vaultProgram.programId
      );
      existingStrategyMetas.push({ pubkey: pda, isSigner: false, isWritable: false });
    }

    await vaultProgram.methods
      .createStrategy()
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
        strategyAuthority: strategyAuthorityPda,
        tokenMint: usdcMint,
        strategyTokenAccount: strategyTokenPda,
        delegate: delegateKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(existingStrategyMetas)
      .rpc();
    console.log(`   Strategy PDA: ${strategyPda.toBase58()}`);
    console.log(`   Strategy authority: ${strategyAuthorityPda.toBase58()}`);
    console.log(`   Strategy token: ${strategyTokenPda.toBase58()}`);

    await vaultProgram.methods
      .setStrategyWeight(opts.weightBps)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
      })
      .rpc();
    console.log(`   Weight: ${opts.weightBps / 100}%`);
  }
  console.log();

  // ── Step 5: Initialize the ProtocolPosition tracker ──────────────────
  console.log("5. Initializing mock_lulo ProtocolPosition...");
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    luloProgram.programId
  );
  if (await accountExists(connection, positionPda)) {
    console.log(`   Position already exists at ${positionPda.toBase58()} (reusing)`);
  } else {
    await luloProgram.methods
      .initializePosition()
      .accountsStrict({
        payer: payer.publicKey,
        strategyTokenAccount: strategyTokenPda,
        position: positionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   Position PDA: ${positionPda.toBase58()}`);
  }
  console.log();

  // ── Step 6: Whitelist 2 mock_lulo actions ─────────────────────────────
  console.log("6. Whitelisting mock_lulo actions...");
  const actions = [
    { name: LULO_DEPOSIT_IX,  recipientIndex: LULO_RECIPIENT_INDEX },
    { name: LULO_WITHDRAW_IX, recipientIndex: LULO_RECIPIENT_INDEX },
  ];
  for (const action of actions) {
    const disc = anchorDiscriminator(action.name);
    const [actionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_action"),
        strategyPda.toBuffer(),
        luloProgram.programId.toBuffer(),
        disc,
      ],
      vaultProgram.programId
    );
    if (await accountExists(connection, actionPda)) {
      console.log(`   ${action.name} already whitelisted (reusing)`);
      continue;
    }
    await vaultProgram.methods
      .addAllowedAction(
        new BN(strategyIndex),
        luloProgram.programId,
        Array.from(disc) as any,
        action.recipientIndex,
        null
      )
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: vaultPda,
        strategy: strategyPda,
        allowedAction: actionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   ${action.name} (recipient_index=${action.recipientIndex})`);
  }
  console.log();

  // ── Step 7: Ensure agent USDC ATA exists ─────────────────────────────
  console.log("7. Ensuring agent USDC ATA exists (anti-theft snapshot point)...");
  const agentTokenAta = getAssociatedTokenAddressSync(usdcMint, delegateKeypair.publicKey);
  if (await accountExists(connection, agentTokenAta)) {
    console.log(`   Agent ATA already exists at ${agentTokenAta.toBase58()}`);
  } else {
    await createAssociatedTokenAccount(connection, payer, usdcMint, delegateKeypair.publicKey);
    console.log(`   Agent ATA: ${agentTokenAta.toBase58()}`);
  }
  console.log();

  // ── Step 8: Fund deployer + deposit + allocate ───────────────────────
  console.log("8. Minting test USDC and funding the strategy...");
  const payerAta = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  if (!(await accountExists(connection, payerAta))) {
    await createAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey);
  }
  await mintTo(connection, payer, usdcMint, payerAta, payer, opts.depositAmount * 2);

  const payerShareAta = getAssociatedTokenAddressSync(shareMintPda, payer.publicKey);
  await vaultProgram.methods
    .deposit(new BN(opts.depositAmount))
    .accountsStrict({
      user: payer.publicKey,
      vaultState: vaultPda,
      vaultAuthority: vaultAuthorityPda,
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
      vaultAuthority: vaultAuthorityPda,
      strategy: strategyPda,
      tokenMint: usdcMint,
      reserveAta,
      strategyTokenAccount: strategyTokenPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`   Allocated ${(opts.allocateAmount / 1e6).toFixed(2)} USDC to strategy\n`);

  // ── Step 9: Print agent .env values ──────────────────────────────────
  console.log("=== Setup Complete ===\n");
  console.log("--- Copy to agent/lulo/.env ---\n");
  console.log(`SOLANA_PRIVATE_KEY=${bs58.encode(delegateKeypair.secretKey)}`);
  console.log(`RPC_URL=${opts.rpcUrl}`);
  console.log(`ANTHROPIC_API_KEY=<paste-your-key>`);
  console.log(`VAULT_TOKEN_MINT=${usdcMint.toBase58()}`);
  console.log(`VAULT_ID=${opts.vaultId}`);
  console.log(`STRATEGY_ID=${strategyIndex}`);
  console.log(`LULO_PROGRAM_ID=${luloProgram.programId.toBase58()}`);
  console.log(`LULO_TREASURY=${treasuryPda.toBase58()}`);
  console.log(`POLL_INTERVAL_MS=120000`);
  console.log(`MIN_LEND_AMOUNT=1000000`);
  console.log(`MAX_RETRIES=3`);
  console.log(`RETRY_DELAY_MS=2000`);
  console.log(`WITHDRAW_SIGNAL_PATH=./withdraw-signal.json`);
  console.log("\nAgent must hold a small SOL balance for tx fees:");
  console.log(`  solana transfer ${delegateKeypair.publicKey.toBase58()} 0.1 --allow-unfunded-recipient\n`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
