/**
 * setup-multi-vaults.ts — Mint a fresh devnet test token + init 5 named
 * vaults (vault_id 0..4) with 2..5 strategies each, allocate funds, and
 * simulate yield. Used to populate a clean devnet for frontend testing.
 *
 * Usage:
 *   bun scripts/setup-multi-vaults.ts
 *
 * After it finishes, copy the printed `NEXT_PUBLIC_TOKEN_MINT=...` into
 * app/.env.local and update VAULT_REGISTRY in app/src/lib/constants.ts
 * to point at the same mint.
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

const RPC_URL = "https://api.devnet.solana.com";
const WALLET_PATH = "./id.json";

interface VaultPlan {
  name: string;
  vaultId: number;
  deposit: number; // base units, 6 dp
  strategies: { name: string; alloc: number; yieldBps: number }[];
}

const VAULTS: VaultPlan[] = [
  {
    name: "AT trader agent",
    vaultId: 0,
    deposit: 100_000_000, // 100 USDC
    strategies: [
      { name: "Lending A", alloc: 20_000_000, yieldBps: 500 },
      { name: "Lending B", alloc: 15_000_000, yieldBps: 800 },
      { name: "Staking C", alloc: 12_000_000, yieldBps: 1500 },
      { name: "LP D", alloc: 8_000_000, yieldBps: 2200 },
    ],
  },
  {
    name: "Conservative",
    vaultId: 1,
    deposit: 50_000_000, // 50 USDC
    strategies: [
      { name: "T-Bill A", alloc: 18_000_000, yieldBps: 300 },
      { name: "T-Bill B", alloc: 12_000_000, yieldBps: 400 },
    ],
  },
  {
    name: "Aggressive Vault",
    vaultId: 2,
    deposit: 200_000_000, // 200 USDC
    strategies: [
      { name: "Perp Funding", alloc: 40_000_000, yieldBps: 1200 },
      { name: "Vol Selling", alloc: 35_000_000, yieldBps: 1800 },
      { name: "Long-Short", alloc: 30_000_000, yieldBps: 2500 },
      { name: "Basis Trade", alloc: 25_000_000, yieldBps: 1500 },
      { name: "Momentum", alloc: 20_000_000, yieldBps: 3000 },
    ],
  },
  {
    name: "Stablecoin Yield",
    vaultId: 3,
    deposit: 80_000_000,
    strategies: [
      { name: "USDC Lend", alloc: 25_000_000, yieldBps: 600 },
      { name: "USDT Lend", alloc: 20_000_000, yieldBps: 700 },
      { name: "DAI Lend", alloc: 15_000_000, yieldBps: 550 },
    ],
  },
  {
    name: "DeFi Alpha",
    vaultId: 4,
    deposit: 120_000_000,
    strategies: [
      { name: "DEX LP", alloc: 30_000_000, yieldBps: 1100 },
      { name: "Yield Farm", alloc: 25_000_000, yieldBps: 1800 },
      { name: "Liquid Staking", alloc: 20_000_000, yieldBps: 700 },
    ],
  },
];

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")))
  );
}

async function confirm(connection: anchor.web3.Connection, sig: string) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature: sig,
  });
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

  console.log("\n=== Multi-vault Devnet Setup ===\n");
  console.log(`Wallet:   ${walletKeypair.publicKey.toBase58()}`);
  console.log(`Program:  ${program.programId.toBase58()}`);

  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`Balance:  ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 1e9) {
    console.error("Need at least 1 SOL. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // Step 1 — fresh test token
  console.log("1. Creating test token mint (6 dp)...");
  const tokenMint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey,
    null,
    6
  );
  console.log(`   ${tokenMint.toBase58()}`);

  const userAta = await createAssociatedTokenAccount(
    connection,
    walletKeypair,
    tokenMint,
    walletKeypair.publicKey
  );

  // Mint enough for every vault deposit + strategy yield
  const totalDeposit = VAULTS.reduce((sum, v) => sum + v.deposit, 0);
  const buffer = 1_000_000_000; // 1000 USDC headroom
  const sigMint = await mintTo(
    connection,
    walletKeypair,
    tokenMint,
    userAta,
    walletKeypair,
    totalDeposit + buffer
  );
  await confirm(connection, sigMint);
  console.log(
    `   Minted ${((totalDeposit + buffer) / 1e6).toFixed(2)} USDC to wallet ATA\n`
  );

  // Step 2..N — init each vault, deposit, strategies, allocate, yield
  const summary: {
    name: string;
    vaultId: number;
    vaultPda: string;
    shareMint: string;
    deposited: number;
    sharePrice: number;
    strategies: number;
  }[] = [];

  for (const plan of VAULTS) {
    console.log(`Vault #${plan.vaultId} "${plan.name}"`);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        tokenMint.toBuffer(),
        new BN(plan.vaultId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), vaultPda.toBuffer()],
      program.programId
    );
    const [shareMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vaultPda.toBuffer()],
      program.programId
    );
    const reserveAta = anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: vaultAuthority,
    });

    // 2a — initialize_vault
    await program.methods
      .initializeVault(new BN(plan.vaultId))
      .accountsStrict({
        admin: walletKeypair.publicKey,
        vaultState: vaultPda,
        vaultAuthority,
        tokenMint,
        shareMint: shareMintPda,
        reserveAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`   init: ${vaultPda.toBase58()}`);

    // 2b — deposit
    const userShareAta = await getAssociatedTokenAddress(
      shareMintPda,
      walletKeypair.publicKey
    );
    await program.methods
      .deposit(new BN(plan.deposit))
      .accountsStrict({
        user: walletKeypair.publicKey,
        vaultState: vaultPda,
        vaultAuthority,
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
    console.log(`   deposit: ${plan.deposit / 1e6} USDC`);

    // 2c — strategies
    const strategyInfos: {
      pda: PublicKey;
      authority: PublicKey;
      tokenAccount: PublicKey;
      alloc: number;
      yieldBps: number;
      name: string;
    }[] = [];

    for (let i = 0; i < plan.strategies.length; i++) {
      const s = plan.strategies[i];
      const delegate = Keypair.generate();
      const [sPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy"),
          vaultPda.toBuffer(),
          new BN(i).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const [sAuthority] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_authority"),
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

      const existingMetas = strategyInfos.map((x) => ({
        pubkey: x.pda,
        isSigner: false,
        isWritable: false,
      }));

      await program.methods
        .createStrategy()
        .accountsStrict({
          admin: walletKeypair.publicKey,
          vaultState: vaultPda,
          strategy: sPda,
          strategyAuthority: sAuthority,
          tokenMint,
          strategyTokenAccount: sToken,
          delegate: delegate.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(existingMetas)
        .rpc();

      strategyInfos.push({
        pda: sPda,
        authority: sAuthority,
        tokenAccount: sToken,
        alloc: s.alloc,
        yieldBps: s.yieldBps,
        name: s.name,
      });
    }
    console.log(`   created ${plan.strategies.length} strategies`);

    // 2d — set weights so the allocation pie shows non-trivial bps
    const totalAlloc = plan.strategies.reduce((sum, s) => sum + s.alloc, 0);
    for (let i = 0; i < strategyInfos.length; i++) {
      const weightBps = Math.floor(
        (plan.strategies[i].alloc / plan.deposit) * 10_000
      );
      await program.methods
        .setStrategyWeight(weightBps)
        .accountsStrict({
          admin: walletKeypair.publicKey,
          vaultState: vaultPda,
          strategy: strategyInfos[i].pda,
        })
        .rpc();
    }
    console.log(`   weights set (sum=${Math.floor((totalAlloc / plan.deposit) * 10_000)} bps)`);

    // 2e — allocate
    for (const s of strategyInfos) {
      await program.methods
        .allocateToStrategy(new BN(s.alloc))
        .accountsStrict({
          authority: walletKeypair.publicKey,
          vaultState: vaultPda,
          vaultAuthority,
          strategy: s.pda,
          tokenMint,
          reserveAta,
          strategyTokenAccount: s.tokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    }
    console.log(`   allocated`);

    // 2f — simulate yield + report
    for (const s of strategyInfos) {
      const yieldAmt = Math.floor((s.alloc * s.yieldBps) / 10_000);
      if (yieldAmt > 0) {
        const sig = await mintTo(
          connection,
          walletKeypair,
          tokenMint,
          s.tokenAccount,
          walletKeypair,
          yieldAmt
        );
        await confirm(connection, sig);

        await program.methods
          .reportYield()
          .accountsStrict({
            authority: walletKeypair.publicKey,
            vaultState: vaultPda,
            strategy: s.pda,
            strategyTokenAccount: s.tokenAccount,
          })
          .rpc();
      }
    }
    console.log(`   yield simulated + reported\n`);

    const vault = await program.account.vaultState.fetch(vaultPda);
    const supply = await connection.getTokenSupply(shareMintPda);
    const sharePrice =
      Number(supply.value.amount) > 0
        ? vault.totalDeposited.toNumber() / Number(supply.value.amount)
        : 1;

    summary.push({
      name: plan.name,
      vaultId: plan.vaultId,
      vaultPda: vaultPda.toBase58(),
      shareMint: shareMintPda.toBase58(),
      deposited: vault.totalDeposited.toNumber() / 1e6,
      sharePrice,
      strategies: vault.strategyCount.toNumber(),
    });
  }

  console.log("=== Setup Complete ===\n");
  console.log(`Token Mint: ${tokenMint.toBase58()}\n`);
  console.log("Vault summary:");
  for (const s of summary) {
    console.log(
      `  #${s.vaultId} ${s.name.padEnd(20)} TVL=${s.deposited.toFixed(2)} USDC  price=${s.sharePrice.toFixed(4)}  strategies=${s.strategies}  ${s.vaultPda}`
    );
  }
  console.log();
  console.log("Next steps:");
  console.log(`  1. Update app/.env.local: NEXT_PUBLIC_TOKEN_MINT=${tokenMint.toBase58()}`);
  console.log(`  2. Update VAULT_REGISTRY in app/src/lib/constants.ts to point at the same mint`);
  console.log();
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message || err);
  if (err.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
