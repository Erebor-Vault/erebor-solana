import { Connection } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import {
  createProgram,
  deriveVaultPda,
  deriveStrategyPda,
  deriveStrategyTokenPda,
  fetchVaultState,
  fetchStrategy,
  fetchTokenBalance,
} from "./vault-client.js";
import { MockLuloProtocol, RealLuloProtocol } from "./strategy.js";
import { LLMAdvisor } from "./llm-advisor.js";
import { startMonitorLoop } from "./monitor.js";

async function main() {
  console.log("╔══════════════════════════════╗");
  console.log("║    Erebor Vault Agent        ║");
  console.log("╚══════════════════════════════╝\n");

  // 1. Load and validate config
  const config = loadConfig();

  console.log(`Agent:      ${config.agentKeypair.publicKey.toBase58()}`);
  console.log(`RPC:        ${config.rpcUrl}`);
  console.log(`Vault ID:   ${config.vaultId}`);
  console.log(`Strategy:   ${config.strategyId}`);
  console.log(`Mock Lulo:  ${config.useMockLulo}`);
  console.log(`Poll:       ${config.pollIntervalMs / 1000}s`);
  console.log(`Min lend:   ${(config.minLendAmount / 1e6).toFixed(2)} USDC\n`);

  // 2. Connect
  const connection = new Connection(config.rpcUrl, "confirmed");
  const program = createProgram(connection, config.agentKeypair);

  // 3. Derive PDAs
  const vaultPda = deriveVaultPda(config.vaultTokenMint, config.vaultId);
  const strategyPda = deriveStrategyPda(vaultPda, config.strategyId);
  const strategyTokenPda = deriveStrategyTokenPda(vaultPda, config.strategyId);

  console.log(`Vault PDA:  ${vaultPda.toBase58()}`);
  console.log(`Strategy:   ${strategyPda.toBase58()}`);
  console.log(`Token Acct: ${strategyTokenPda.toBase58()}\n`);

  // 4. Validate on-chain state
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
    `  Strategy active, delegate verified, balance = ${(tokenBalance / 1e6).toFixed(2)} USDC`
  );
  console.log(
    `  Action count: ${strategy.actionCount}\n`
  );

  // 5. Initialize protocol (mock or real)
  let protocol;
  if (config.useMockLulo) {
    console.log("Using MOCK Lulo protocol (devnet mode)\n");
    protocol = new MockLuloProtocol();
  } else {
    console.log("Using REAL Lulo protocol (mainnet mode)\n");
    // TODO: Determine Lulo program ID and discriminators from mainnet
    // These would come from Lulo's IDL or transaction inspection
    throw new Error(
      "Real Lulo integration not yet implemented. Set USE_MOCK_LULO=true for devnet."
    );
  }

  // 6. Initialize LLM advisor
  const advisor = new LLMAdvisor(config);

  // 7. Graceful shutdown
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

  // 8. Start monitor loop
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
