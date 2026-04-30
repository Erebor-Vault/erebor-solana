// index.ts — Kamino looper agent entry point.
//
// Startup sequence:
//   1. Load config from .env
//   2. Connect to Solana RPC
//   3. Derive vault, strategy, and strategy token account PDAs
//   4. Validate vault state, strategy active, agent matches delegate
//   5. Start the main eval loop

import { Connection } from "@solana/web3.js";
import { loadConfig, VAULT_PROGRAM_ID } from "./config.js";
import {
  createProgram,
  deriveVaultPda,
  deriveStrategyPda,
  deriveStrategyTokenPda,
  fetchVaultState,
  fetchStrategy,
} from "../../shared/vault-client.js";
import { startMainLoop } from "./loop/mainLoop.js";

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  Erebor Vault — Kamino Looper Agent  ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Step 1: Load config
  const config = loadConfig();

  console.log(`Agent:      ${config.agentKeypair.publicKey.toBase58()}`);
  console.log(`RPC:        ${config.rpcUrl}`);
  console.log(`Vault ID:   ${config.vaultId}`);
  console.log(`Strategy:   ${config.strategyId}`);
  console.log(`Kamino:     ${config.kaminoProgramId.toBase58()}`);
  console.log(`Eval:       ${config.evalIntervalMs / 1000}s`);
  console.log(`Max lev:    ${config.maxLeverage}x`);
  console.log(`Dry run:    ${config.dryRun}\n`);

  // Step 2: Connect
  const connection = new Connection(config.rpcUrl, "confirmed");
  const vaultProgram = createProgram(connection, config.agentKeypair);

  // Step 3: Derive PDAs
  const vaultPda = deriveVaultPda(config.vaultTokenMint, config.vaultId, VAULT_PROGRAM_ID);
  const strategyPda = deriveStrategyPda(vaultPda, config.strategyId, VAULT_PROGRAM_ID);
  const strategyTokenPda = deriveStrategyTokenPda(vaultPda, config.strategyId, VAULT_PROGRAM_ID);

  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Strategy PDA:     ${strategyPda.toBase58()}`);
  console.log(`Strategy Token:   ${strategyTokenPda.toBase58()}\n`);

  // Step 4: Validate on-chain state
  console.log("Validating on-chain state...");

  const vault = await fetchVaultState(vaultProgram, vaultPda);
  console.log(
    `  Vault: total_deposited=${vault.totalDeposited.toString()}, strategies=${vault.strategyCount.toString()}`
  );

  const strategy = await fetchStrategy(vaultProgram, strategyPda);

  if (!strategy.isActive) {
    console.error("ERROR: Strategy is not active. Exiting.");
    process.exit(1);
  }

  if (!strategy.delegate.equals(config.agentKeypair.publicKey)) {
    console.error(
      `ERROR: Agent ${config.agentKeypair.publicKey.toBase58()} is not the delegate.`
    );
    console.error(`       Strategy delegate: ${strategy.delegate.toBase58()}`);
    process.exit(1);
  }

  console.log(`  Strategy active, delegate verified, action_count=${strategy.actionCount}\n`);

  // Step 5: Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nSIGINT received, shutting down...");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("\nSIGTERM received, shutting down...");
    process.exit(0);
  });

  // Step 6: Start the main loop
  await startMainLoop({
    config,
    connection,
    vaultProgram,
    vaultPda,
    strategyPda,
    strategyTokenPda,
    vaultProgramId: VAULT_PROGRAM_ID,
  });
}

main().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
