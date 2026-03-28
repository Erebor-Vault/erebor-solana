/**
 * setup-devnet.ts — Full devnet setup with mock strategies and yield simulation.
 *
 * Creates a custom test token (we control the mint), initializes a vault,
 * creates strategies, allocates funds, and simulates yield.
 *
 * Usage:
 *   bunx ts-node scripts/setup-devnet.ts
 *
 * Prerequisites:
 *   - ./id.json wallet with devnet SOL (at least 1 SOL)
 *   - Program deployed on devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// -------------------------------------------------------------------
// Config
// -------------------------------------------------------------------
const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";
const STRATEGIES = [
  { name: "Lending Protocol A", yieldBps: 500 },   // 5% yield
  { name: "Lending Protocol B", yieldBps: 1000 },  // 10% yield
  { name: "Staking Protocol C", yieldBps: 2000 },  // 20% yield
];
const DEPOSIT_AMOUNT = 100_000_000; // 100 tokens (6 decimals)
const ALLOCATIONS = [30_000_000, 25_000_000, 20_000_000]; // 30, 25, 20 tokens

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
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature: sig,
  });
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

  const program = anchor.workspace.myProject as Program<MyProject>;

  console.log("\n=== Sol Vault Devnet Setup ===\n");
  console.log(`Wallet:    ${walletKeypair.publicKey.toBase58()}`);
  console.log(`Program:   ${program.programId.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`Balance:   ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.5e9) {
    console.error("Need at least 0.5 SOL. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // Step 1: Create custom test token (we control the mint authority)
  // -------------------------------------------------------------------
  console.log("1. Creating test token mint...");
  const tokenMint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey, // mint authority = us
    null,
    6 // 6 decimals like USDC
  );
  console.log(`   Token Mint: ${tokenMint.toBase58()}`);

  // Create our ATA and mint test tokens
  const userAta = await createAssociatedTokenAccount(
    connection,
    walletKeypair,
    tokenMint,
    walletKeypair.publicKey
  );
  console.log(`   User ATA:   ${userAta.toBase58()}`);

  const mintAmount = 1_000_000_000; // 1000 tokens
  const mintSig = await mintTo(
    connection,
    walletKeypair,
    tokenMint,
    userAta,
    walletKeypair,
    mintAmount
  );
  await confirmTx(connection, mintSig);
  console.log(`   Minted:     ${mintAmount / 1e6} tokens\n`);

  // -------------------------------------------------------------------
  // Step 2: Initialize vault
  // -------------------------------------------------------------------
  console.log("2. Initializing vault...");
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    program.programId
  );
  const reserveAta = anchor.utils.token.associatedAddress({
    mint: tokenMint,
    owner: vaultPda,
  });

  await program.methods
    .initializeVault(new BN(0))
    .accountsStrict({
      admin: walletKeypair.publicKey,
      vaultState: vaultPda,
      tokenMint,
      shareMint: shareMintPda,
      reserveAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`   Vault PDA:    ${vaultPda.toBase58()}`);
  console.log(`   Share Mint:   ${shareMintPda.toBase58()}`);
  console.log(`   Reserve ATA:  ${reserveAta.toBase58()}\n`);

  // -------------------------------------------------------------------
  // Step 3: Deposit tokens
  // -------------------------------------------------------------------
  console.log(`3. Depositing ${DEPOSIT_AMOUNT / 1e6} tokens...`);
  const userShareAta = await getAssociatedTokenAddress(
    shareMintPda,
    walletKeypair.publicKey
  );

  await program.methods
    .deposit(new BN(DEPOSIT_AMOUNT))
    .accountsStrict({
      user: walletKeypair.publicKey,
      vaultState: vaultPda,
      tokenMint,
      shareMint: shareMintPda,
      userTokenAccount: userAta,
      reserveAta,
      userShareToken: userShareAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`   Deposited ${DEPOSIT_AMOUNT / 1e6} tokens, received shares\n`);

  // -------------------------------------------------------------------
  // Step 4: Create strategies and allocate
  // -------------------------------------------------------------------
  console.log("4. Creating strategies...");

  const strategyInfos: {
    pda: PublicKey;
    tokenAccount: PublicKey;
    yieldBps: number;
    name: string;
  }[] = [];

  for (let i = 0; i < STRATEGIES.length; i++) {
    const delegate = Keypair.generate();
    const [sPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy"),
        vaultPda.toBuffer(),
        new BN(i).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [sToken] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy_token"),
        vaultPda.toBuffer(),
        new BN(i).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .createStrategy()
      .accountsStrict({
        admin: walletKeypair.publicKey,
        vaultState: vaultPda,
        strategy: sPda,
        tokenMint,
        strategyTokenAccount: sToken,
        delegate: delegate.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    strategyInfos.push({
      pda: sPda,
      tokenAccount: sToken,
      yieldBps: STRATEGIES[i].yieldBps,
      name: STRATEGIES[i].name,
    });

    console.log(
      `   Strategy #${i} "${STRATEGIES[i].name}" (${STRATEGIES[i].yieldBps / 100}% yield)`
    );
    console.log(`     PDA:           ${sPda.toBase58()}`);
    console.log(`     Token Account: ${sToken.toBase58()}`);
  }
  console.log();

  // -------------------------------------------------------------------
  // Step 5: Allocate funds to strategies
  // -------------------------------------------------------------------
  console.log("5. Allocating funds...");
  for (let i = 0; i < strategyInfos.length; i++) {
    const amount = ALLOCATIONS[i];
    await program.methods
      .allocateToStrategy(new BN(amount))
      .accountsStrict({
        authority: walletKeypair.publicKey,
        vaultState: vaultPda,
        strategy: strategyInfos[i].pda,
        tokenMint,
        reserveAta,
        strategyTokenAccount: strategyInfos[i].tokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(
      `   Allocated ${amount / 1e6} tokens to Strategy #${i}`
    );
  }

  const reserveRemaining = DEPOSIT_AMOUNT - ALLOCATIONS.reduce((a, b) => a + b, 0);
  console.log(`   Reserve remaining: ${reserveRemaining / 1e6} tokens\n`);

  // -------------------------------------------------------------------
  // Step 6: Simulate yield (mint tokens into strategy accounts)
  // -------------------------------------------------------------------
  console.log("6. Simulating yield...");
  let totalYield = 0;

  for (let i = 0; i < strategyInfos.length; i++) {
    const yieldAmount = Math.floor(
      (ALLOCATIONS[i] * strategyInfos[i].yieldBps) / 10_000
    );
    if (yieldAmount > 0) {
      const sig = await mintTo(
        connection,
        walletKeypair,
        tokenMint,
        strategyInfos[i].tokenAccount,
        walletKeypair,
        yieldAmount
      );
      await confirmTx(connection, sig);
      totalYield += yieldAmount;
      console.log(
        `   Strategy #${i}: +${yieldAmount / 1e6} tokens (${strategyInfos[i].yieldBps / 100}% of ${ALLOCATIONS[i] / 1e6})`
      );
    }
  }
  console.log(`   Total yield generated: ${totalYield / 1e6} tokens\n`);

  // -------------------------------------------------------------------
  // Step 7: Report yield
  // -------------------------------------------------------------------
  console.log("7. Reporting yield...");
  for (let i = 0; i < strategyInfos.length; i++) {
    await program.methods
      .reportYield()
      .accountsStrict({
        authority: walletKeypair.publicKey,
        vaultState: vaultPda,
        strategy: strategyInfos[i].pda,
        strategyTokenAccount: strategyInfos[i].tokenAccount,
      })
      .rpc();
    console.log(`   Reported yield for Strategy #${i}`);
  }

  // -------------------------------------------------------------------
  // Final summary
  // -------------------------------------------------------------------
  const vault = await program.account.vaultState.fetch(vaultPda);
  const shareSupply = await connection.getTokenSupply(shareMintPda);

  console.log("\n=== Setup Complete ===\n");
  console.log(`Token Mint:       ${tokenMint.toBase58()}`);
  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Share Mint:       ${shareMintPda.toBase58()}`);
  console.log(`Total Deposited:  ${vault.totalDeposited.toNumber() / 1e6} tokens`);
  console.log(`Share Supply:     ${Number(shareSupply.value.amount) / 1e6}`);
  console.log(`Share Price:      ${(vault.totalDeposited.toNumber() / Number(shareSupply.value.amount)).toFixed(4)}`);
  console.log(`Strategies:       ${vault.strategyCount.toString()}`);
  console.log();
  console.log("To use this vault in the frontend, update app/.env.local:");
  console.log(`  NEXT_PUBLIC_TOKEN_MINT=${tokenMint.toBase58()}`);
  console.log();
  console.log("Explorer:");
  console.log(
    `  https://explorer.solana.com/address/${vaultPda.toBase58()}?cluster=devnet`
  );
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message || err);
  process.exit(1);
});
