// index.ts — Agent entry point.
//
// Startup sequence:
//   1. Load config from .env — validates all required variables immediately
//   2. Connect to Solana RPC — creates connection and Anchor program instance
//   3. Derive PDAs — vault, strategy, strategy_token, strategy_authority,
//      and the agent's own USDC ATA
//   4. Validate on-chain state — vault/strategy exist, strategy active,
//      agent keypair == strategy.delegate
//   5. Initialize protocol adapter — OnChainLuloProtocol (mock_lulo on devnet,
//      real Lulo on mainnet — same code path, different program ID)
//   6. Initialize LLM advisor — Claude API client for decision-making
//   7. Register shutdown handlers
//   8. Start monitor loop — infinite poll cycle (never returns)

import { Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { loadConfig, PROGRAM_ID } from "./config.js";
import {
  createProgram,
  deriveStrategyAuthorityPda,
  deriveStrategyPda,
  deriveStrategyTokenPda,
  deriveVaultPda,
  fetchStrategy,
  fetchTokenBalance,
  fetchVaultState,
} from "../../shared/vault-client.js";
import { OnChainLuloProtocol } from "./strategy.js";
import { LLMAdvisor } from "./llm-advisor.js";
import { startMonitorLoop } from "./monitor.js";

async function main() {
  console.log("╔══════════════════════════════╗");
  console.log("║    Erebor Vault Agent        ║");
  console.log("╚══════════════════════════════╝\n");

  // Step 1: Load config
  const config = loadConfig();

  console.log(`Agent:      ${config.agentKeypair.publicKey.toBase58()}`);
  console.log(`RPC:        ${config.rpcUrl}`);
  console.log(`Vault ID:   ${config.vaultId}`);
  console.log(`Strategy:   ${config.strategyId}`);
  console.log(`Protocol:   ${config.luloProgramId.toBase58()}`);
  console.log(`Treasury:   ${config.luloTreasury.toBase58()}`);
  console.log(`Poll:       ${config.pollIntervalMs / 1000}s`);
  console.log(`Min lend:   ${(config.minLendAmount / 1e6).toFixed(2)} USDC\n`);

  // Step 2: Connect
  const connection = new Connection(config.rpcUrl, "confirmed");
  const program = createProgram(connection, config.agentKeypair);

  // Step 3: Derive PDAs
  const vaultPda = deriveVaultPda(config.vaultTokenMint, config.vaultId, PROGRAM_ID);
  const strategyPda = deriveStrategyPda(vaultPda, config.strategyId, PROGRAM_ID);
  const strategyTokenPda = deriveStrategyTokenPda(vaultPda, config.strategyId, PROGRAM_ID);
  const strategyAuthorityPda = deriveStrategyAuthorityPda(
    vaultPda,
    config.strategyId,
    PROGRAM_ID
  );
  // Agent's own USDC ATA — anti-theft snapshot point on every execute_action.
  // Must already exist on-chain (setup script creates it).
  const agentTokenAta = getAssociatedTokenAddressSync(
    config.vaultTokenMint,
    config.agentKeypair.publicKey
  );

  console.log(`Vault PDA:           ${vaultPda.toBase58()}`);
  console.log(`Strategy PDA:        ${strategyPda.toBase58()}`);
  console.log(`Strategy Token:      ${strategyTokenPda.toBase58()}`);
  console.log(`Strategy Authority:  ${strategyAuthorityPda.toBase58()}`);
  console.log(`Agent Token ATA:     ${agentTokenAta.toBase58()}\n`);

  // Step 4: Validate on-chain state
  console.log("Validating on-chain state...");

  const vault = await fetchVaultState(program, vaultPda);
  console.log(
    `  Vault found: total_deposited = ${vault.totalDeposited.toString()}, strategies = ${vault.strategyCount.toString()}`
  );

  const strategy = await fetchStrategy(program, strategyPda);

  if (!strategy.isActive) {
    console.error("ERROR: Strategy is not active. Exiting.");
    process.exit(1);
  }

  if (!strategy.delegate.equals(config.agentKeypair.publicKey)) {
    console.error(
      `ERROR: Agent key ${config.agentKeypair.publicKey.toBase58()} does not match strategy delegate ${strategy.delegate.toBase58()}`
    );
    process.exit(1);
  }

  const tokenBalance = await fetchTokenBalance(connection, strategyTokenPda);
  console.log(
    `  Strategy active, delegate verified, balance = ${(tokenBalance / 1e6).toFixed(2)} USDC, target_weight = ${strategy.targetWeightBps} bps\n`
  );

  // Step 5: Initialize protocol adapter
  const protocol = new OnChainLuloProtocol({
    program,
    connection,
    config,
    vaultPda,
    strategyPda,
    strategyTokenPda,
    strategyAuthorityPda,
    luloProgramId: config.luloProgramId,
    treasuryPda: config.luloTreasury,
    tokenMint: config.vaultTokenMint,
    vaultProgramId: PROGRAM_ID,
    callerTokenAta: agentTokenAta,
    delegateTokenAta: agentTokenAta,
    strategyId: config.strategyId,
  });

  // Step 6: Initialize LLM advisor (Claude — Haiku for routine, Sonnet for state-change).
  const advisor = new LLMAdvisor(config);

  // Step 7: Graceful shutdown handlers
  process.on("SIGINT", async () => {
    console.log("\nShutting down agent...");
    const lent = await protocol.getLentBalance();
    if (lent > 0) {
      console.log(`  ${(lent / 1e6).toFixed(2)} USDC still lent to protocol`);
    }
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nSIGTERM received, exiting...");
    process.exit(0);
  });

  // Step 8: Start the monitor loop (never returns).
  await startMonitorLoop(
    program,
    connection,
    config,
    strategyPda,
    strategyTokenPda,
    protocol,
    advisor
  );
}

main().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
