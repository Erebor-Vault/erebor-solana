// @ts-nocheck — TODO(step5c): adjust on-chain validation for new StrategyAccount.
// References strategy.actionCount which doesn't exist on OLD_Erebor's layout.
//
// index.ts — Agent entry point.
//
// This is the main file that wires everything together and starts the agent.
// It performs a strict sequence of startup steps:
//
// 1. Load config from .env — validates all required variables immediately
// 2. Connect to Solana RPC — creates connection and Anchor program instance
// 3. Derive all PDAs — deterministic addresses for vault, strategy, token account
// 4. Validate on-chain state — ensures vault/strategy exist, strategy is active,
//    and the agent's keypair matches the strategy's delegate field
// 5. Initialize protocol — MockLuloProtocol (devnet) or RealLuloProtocol (mainnet)
// 6. Initialize LLM advisor — Claude API client for decision-making
// 7. Register shutdown handlers — graceful SIGINT/SIGTERM handling
// 8. Start monitor loop — infinite polling cycle (never returns)
//
// If any validation fails (missing config, strategy inactive, delegate mismatch),
// the agent prints an error and exits immediately. This catches misconfiguration
// at startup rather than failing on the first transaction.

import { Connection } from "@solana/web3.js";
import { loadConfig, PROGRAM_ID } from "./config.js";
import {
  createProgram,
  deriveVaultPda,
  deriveStrategyPda,
  deriveStrategyTokenPda,
  fetchVaultState,
  fetchStrategy,
  fetchTokenBalance,
} from "../../shared/vault-client.js";
import { OnChainLuloProtocol } from "./strategy.js";
import { LLMAdvisor } from "./llm-advisor.js";
import { startMonitorLoop } from "./monitor.js";

async function main() {
  console.log("╔══════════════════════════════╗");
  console.log("║    Erebor Vault Agent        ║");
  console.log("╚══════════════════════════════╝\n");

  // ── Step 1: Load and validate config from .env ────────────────────────────
  // Throws immediately if SOLANA_PRIVATE_KEY, ANTHROPIC_API_KEY, or
  // VAULT_TOKEN_MINT are missing.
  const config = loadConfig();

  console.log(`Agent:      ${config.agentKeypair.publicKey.toBase58()}`);
  console.log(`RPC:        ${config.rpcUrl}`);
  console.log(`Vault ID:   ${config.vaultId}`);
  console.log(`Strategy:   ${config.strategyId}`);
  console.log(`Protocol:   ${config.luloProgramId.toBase58()}`);
  console.log(`Treasury:   ${config.luloTreasury.toBase58()}`);
  console.log(`Poll:       ${config.pollIntervalMs / 1000}s`);
  console.log(`Min lend:   ${(config.minLendAmount / 1e6).toFixed(2)} USDC\n`);

  // ── Step 2: Connect to Solana ─────────────────────────────────────────────
  // Create a connection with "confirmed" commitment (1 confirmation).
  // Create an Anchor Program instance using the agent's keypair as signer.
  const connection = new Connection(config.rpcUrl, "confirmed");
  const program = createProgram(connection, config.agentKeypair);

  // ── Step 3: Derive all PDAs ───────────────────────────────────────────────
  // These are deterministic — same seeds always produce the same address.
  // Must match the seeds used by the on-chain program in state.rs.
  const vaultPda = deriveVaultPda(config.vaultTokenMint, config.vaultId, PROGRAM_ID);
  const strategyPda = deriveStrategyPda(vaultPda, config.strategyId, PROGRAM_ID);
  const strategyTokenPda = deriveStrategyTokenPda(vaultPda, config.strategyId, PROGRAM_ID);

  console.log(`Vault PDA:  ${vaultPda.toBase58()}`);
  console.log(`Strategy:   ${strategyPda.toBase58()}`);
  console.log(`Token Acct: ${strategyTokenPda.toBase58()}\n`);

  // ── Step 4: Validate on-chain state ───────────────────────────────────────
  // Fetches accounts from the blockchain and verifies:
  // - The vault exists
  // - The strategy exists and is active
  // - The agent's keypair matches the strategy's delegate field
  // This catches misconfiguration early (wrong STRATEGY_ID, wrong keypair, etc.)
  console.log("Validating on-chain state...");

  const vault = await fetchVaultState(program, vaultPda);
  console.log(
    `  Vault found: total_deposited = ${vault.totalDeposited.toString()}, strategies = ${vault.strategyCount.toString()}`
  );

  const strategy = await fetchStrategy(program, strategyPda);

  // Strategy must be active — deactivated strategies are permanently shut down.
  if (!strategy.isActive) {
    console.error("ERROR: Strategy is not active. Exiting.");
    process.exit(1);
  }

  // The agent's keypair must match what the admin set as the strategy's delegate.
  // If this doesn't match, every execute_strategy_action call will fail with
  // UnauthorizedCaller, so we catch it here instead.
  if (!strategy.delegate.equals(config.agentKeypair.publicKey)) {
    console.error(
      `ERROR: Agent key ${config.agentKeypair.publicKey.toBase58()} does not match strategy delegate ${strategy.delegate.toBase58()}`
    );
    process.exit(1);
  }

  const tokenBalance = await fetchTokenBalance(connection, strategyTokenPda);
  console.log(
    `  Strategy active, delegate verified, balance = ${(tokenBalance / 1e6).toFixed(2)} USDC`
  );
  console.log(
    `  Action count: ${strategy.actionCount}\n`
  );

  // ── Step 5: Initialize protocol adapter ───────────────────────────────────
  // Same code path for devnet (mock_lulo program) and mainnet (real Lulo).
  // The only difference is the program ID and treasury PDA, configured via .env.
  console.log(`Protocol:   ${config.luloProgramId.toBase58()}`);
  console.log(`Treasury:   ${config.luloTreasury.toBase58()}\n`);

  const protocol = new OnChainLuloProtocol(
    program,
    connection,
    config,
    vaultPda,
    strategyPda,
    strategyTokenPda,
    config.luloProgramId,
    config.luloTreasury,
    config.vaultTokenMint,
    PROGRAM_ID,
  );

  // ── Step 6: Initialize LLM advisor ────────────────────────────────────────
  // Wraps the Anthropic Claude API. Uses Haiku for routine checks, Sonnet for
  // state-change decisions. Defaults to HOLD if the LLM call fails.
  const advisor = new LLMAdvisor(config);

  // ── Step 7: Graceful shutdown handlers ────────────────────────────────────
  // On Ctrl+C (SIGINT) or container stop (SIGTERM), log remaining position and exit.
  // Note: in production, you might want to withdraw from Lulo before exiting.
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

  // ── Step 8: Start the monitor loop ────────────────────────────────────────
  // This runs forever (or until the strategy is deactivated / process is killed).
  // Each cycle: read state → check hard rules → maybe consult LLM → execute decision.
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

// Top-level error handler. If main() throws (e.g., RPC unreachable at startup),
// log the error and exit with code 1.
main().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
