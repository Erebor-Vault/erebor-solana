/**
 * init-kamino-position.ts — Initialize a mock_kamino ProtocolPosition PDA
 * for an already-existing strategy.
 *
 * Use case: the strategy already exists (and possibly has an active obligation)
 * but was created before the ProtocolPosition adapter was added to mock_kamino.
 * Without a ProtocolPosition, no deposit/withdraw/borrow/repay can execute
 * because the new handlers require it as a strict account.
 *
 * Usage:
 *   bunx ts-node scripts/init-kamino-position.ts \
 *     --mint <USDC_MINT> \
 *     --vault-id 0 \
 *     --strategy-id 1
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { MockKamino } from "../target/types/mock_kamino";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

function parseArgs() {
  const args = process.argv.slice(2);
  let mintAddress = "";
  let vaultId = 0;
  let strategyId = 0;
  let walletPath = "./id.json";
  let rpcUrl = "https://api.devnet.solana.com";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mint":        mintAddress = args[++i]; break;
      case "--vault-id":    vaultId = Number(args[++i]); break;
      case "--strategy-id": strategyId = Number(args[++i]); break;
      case "--wallet":      walletPath = args[++i]; break;
      case "--rpc":         rpcUrl = args[++i]; break;
    }
  }

  if (!mintAddress) {
    console.error("Error: --mint is required");
    process.exit(1);
  }

  return { mintAddress, vaultId, strategyId, walletPath, rpcUrl };
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf-8"))));
}

async function main() {
  const opts = parseArgs();

  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const kaminoProgram = anchor.workspace.mockKamino as Program<MockKamino>;
  const mint = new PublicKey(opts.mintAddress);

  // Derive strategy_token PDA for the given (vault, strategy_id)
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer(), new BN(opts.vaultId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    kaminoProgram.programId
  );

  console.log(`Vault:           ${vaultPda.toBase58()}`);
  console.log(`Strategy token:  ${strategyTokenPda.toBase58()}`);
  console.log(`Position PDA:    ${positionPda.toBase58()}`);

  const existing = await connection.getAccountInfo(positionPda);
  if (existing) {
    console.log("\nProtocolPosition already exists. Nothing to do.");
    return;
  }

  console.log("\nInitializing ProtocolPosition...");
  const sig = await kaminoProgram.methods
    .initializeKaminoPosition()
    .accountsStrict({
      payer: payer.publicKey,
      strategyTokenAccount: strategyTokenPda,
      position: positionPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Done. tx: ${sig}`);
}

main().catch((err) => {
  console.error("Failed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
