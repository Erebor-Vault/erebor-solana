/**
 * emit-test-event.ts — One-off: mint 1 USDC into Vault 0 / Strategy 0's
 * token account, then call report_yield to emit a `YieldReported` event.
 * Used to verify the frontend's ActivityFeed live subscription decodes
 * Anchor events.
 *
 * Usage: bun scripts/emit-test-event.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mintTo } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

const RPC_URL = "https://api.devnet.solana.com";
const TOKEN_MINT = new PublicKey("BZwn5e9GvEei1HAJvXBFHi6VUk4JEJ9b6r3QCqABWJEY");
const VAULT_ID = 0;
const STRATEGY_ID = 0;
const YIELD = 1_000_000; // 1 USDC

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
  const conn = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(
    Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync("./id.json", "utf-8")))
    )
  );
  anchor.setProvider(new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" }));
  const program = anchor.workspace.myProject as Program<MyProject>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer(), new BN(VAULT_ID).toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(STRATEGY_ID).toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [strategyToken] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(STRATEGY_ID).toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  console.log(`Vault PDA:    ${vaultPda.toBase58()}`);
  console.log(`Strategy PDA: ${strategyPda.toBase58()}`);

  console.log(`\nMinting ${YIELD / 1e6} USDC into strategy token account...`);
  const sig = await mintTo(
    conn,
    wallet.payer,
    TOKEN_MINT,
    strategyToken,
    wallet.payer,
    YIELD
  );
  await confirm(conn, sig);
  console.log(`  mint sig: ${sig}`);

  console.log("Calling report_yield...");
  const txSig = await program.methods
    .reportYield()
    .accountsStrict({
      authority: wallet.payer.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      strategyTokenAccount: strategyToken,
    })
    .rpc();
  console.log(`  report_yield sig: ${txSig}`);

  const v = await program.account.vaultState.fetch(vaultPda);
  console.log(`\nVault total deposited now: ${v.totalDeposited.toNumber() / 1e6} USDC`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
