// strategy.ts — Lending protocol integration (Lulo).
//
// This module provides two implementations of the LuloProtocol interface:
//
// 1. MockLuloProtocol (USE_MOCK_LULO=true, devnet):
//    Simulates Lulo in memory. Tracks lent amount locally, returns a simulated
//    ~5% APY with slight randomization. No on-chain transactions are made.
//    The full agent decision pipeline still runs (polling, LLM, logging),
//    only the final CPI step is skipped.
//
// 2. RealLuloProtocol (USE_MOCK_LULO=false, mainnet):
//    Builds real Lulo instruction data and wraps it in execute_strategy_action.
//    The vault program validates the action against the strategy's whitelist,
//    then CPIs into Lulo with the vault PDA as signer.
//    Currently a stub — requires Lulo's program ID, IDL, and account layout.
//
// KEY ARCHITECTURE: The agent NEVER holds tokens or calls Lulo directly.
// All token movement goes through execute_strategy_action on the vault program:
//   Agent signs tx → vault validates whitelist → vault CPIs into Lulo via invoke_signed

import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import BN from "bn.js";
import type { MyProject } from "../../target/types/my_project.js";
import type { AgentConfig, AgentDecision, LuloProtocol } from "./types.js";
import {
  findAllowedActionByDiscriminator,
} from "./vault-client.js";

// =============================================================================
// MOCK LULO PROTOCOL (devnet)
// =============================================================================

// Simulates a lending protocol entirely in memory.
// Used on devnet where Lulo is not deployed.
// The agent's decision loop runs normally — only the on-chain CPI is skipped.
export class MockLuloProtocol implements LuloProtocol {
  // In-memory tracking of how much the agent has "lent" to the mock protocol.
  // Resets to 0 when the agent restarts.
  private lentAmount: number = 0;

  // Simulated base yield — real Lulo rates fluctuate around 3-8% for USDC.
  private baseYield: number = 0.05; // 5% APY

  // Returns a slightly randomized yield to simulate real market fluctuations.
  // Varies ±0.5% around the base yield each time it's called.
  async getCurrentYield(): Promise<number> {
    return this.baseYield + (Math.random() - 0.5) * 0.01;
  }

  // Returns the amount currently "lent" in memory.
  async getLentBalance(): Promise<number> {
    return this.lentAmount;
  }

  // Simulates executing a LEND or WITHDRAW action.
  // Updates internal tracking and logs the action. Returns a fake tx signature.
  async execute(decision: AgentDecision): Promise<string> {
    if (decision.action === "LEND") {
      this.lentAmount += decision.amount;
      console.log(
        `  [MOCK LULO] Deposited ${(decision.amount / 1e6).toFixed(2)} USDC → total lent: ${(this.lentAmount / 1e6).toFixed(2)} USDC`
      );
    } else if (decision.action === "WITHDRAW") {
      // Can't withdraw more than what's lent
      const withdrawAmount = Math.min(decision.amount, this.lentAmount);
      this.lentAmount -= withdrawAmount;
      console.log(
        `  [MOCK LULO] Withdrew ${(withdrawAmount / 1e6).toFixed(2)} USDC → total lent: ${(this.lentAmount / 1e6).toFixed(2)} USDC`
      );
    }
    return `mock-tx-${Date.now()}`;
  }
}

// =============================================================================
// REAL LULO PROTOCOL (mainnet)
// =============================================================================

// Integrates with the real Lulo (FlexLend) protocol on Solana mainnet.
// Builds CPI instructions and executes them through the vault's
// execute_strategy_action instruction, which validates the whitelist
// and signs with the vault PDA.
//
// IMPORTANT: This is currently a stub. To complete the mainnet integration:
// 1. Determine Lulo's on-chain program ID
// 2. Obtain Lulo's IDL or instruction layout (from their docs or tx inspection)
// 3. Identify the required accounts for deposit/withdraw instructions
// 4. Have the vault admin whitelist Lulo's deposit and withdraw discriminators
export class RealLuloProtocol implements LuloProtocol {
  private program: Program<MyProject>;       // Erebor vault program instance
  private connection: Connection;
  private config: AgentConfig;
  private vaultPda: PublicKey;               // vault state PDA (signs CPIs)
  private strategyPda: PublicKey;            // this agent's strategy PDA
  private strategyTokenPda: PublicKey;       // strategy's token account PDA
  private luloProgramId: PublicKey;          // Lulo's on-chain program ID
  private depositDiscriminator: number[];    // 8-byte Anchor discriminator for Lulo deposit
  private withdrawDiscriminator: number[];   // 8-byte Anchor discriminator for Lulo withdraw

  constructor(
    program: Program<MyProject>,
    connection: Connection,
    config: AgentConfig,
    vaultPda: PublicKey,
    strategyPda: PublicKey,
    strategyTokenPda: PublicKey,
    luloProgramId: PublicKey,
    depositDiscriminator: number[],
    withdrawDiscriminator: number[]
  ) {
    this.program = program;
    this.connection = connection;
    this.config = config;
    this.vaultPda = vaultPda;
    this.strategyPda = strategyPda;
    this.strategyTokenPda = strategyTokenPda;
    this.luloProgramId = luloProgramId;
    this.depositDiscriminator = depositDiscriminator;
    this.withdrawDiscriminator = withdrawDiscriminator;
  }

  // Fetches the current USDC lending yield from Lulo's API.
  // Falls back to 5% if the API is unreachable.
  async getCurrentYield(): Promise<number> {
    try {
      const res = await fetch(
        "https://api.flexlend.fi/v1/rates?token=USDC"
      );
      const data = (await res.json()) as any;
      return (data?.rate ?? 0.05) as number;
    } catch {
      console.warn("  Failed to fetch Lulo yield, using default 5%");
      return 0.05;
    }
  }

  // Returns the amount currently lent to Lulo.
  // TODO: Read Lulo deposit receipt tokens or query the pool balance
  // for this strategy's position. Implementation depends on Lulo's account layout.
  async getLentBalance(): Promise<number> {
    return 0;
  }

  // Executes a LEND or WITHDRAW action by calling execute_strategy_action
  // on the Erebor vault program.
  //
  // Flow:
  // 1. Find the AllowedAction PDA matching the deposit/withdraw discriminator
  // 2. Build instruction data: [8-byte discriminator | 8-byte amount LE]
  // 3. Build remaining_accounts: all accounts Lulo's instruction needs
  // 4. Call vault's execute_strategy_action — vault validates whitelist, CPIs into Lulo
  async execute(decision: AgentDecision): Promise<string> {
    if (decision.action === "HOLD") return "no-op";

    const isDeposit = decision.action === "LEND";
    const discriminator = isDeposit
      ? this.depositDiscriminator
      : this.withdrawDiscriminator;

    // Step 1: Find the AllowedAction PDA that matches this discriminator.
    // The admin must have called add_allowed_action with this discriminator
    // before the agent can execute.
    const strategy = await this.program.account.strategyAllocation.fetch(
      this.strategyPda
    );
    const found = await findAllowedActionByDiscriminator(
      this.program,
      this.strategyPda,
      (strategy as any).actionCount,
      this.luloProgramId,
      discriminator
    );

    if (!found) {
      throw new Error(
        `No active AllowedAction found for ${decision.action} discriminator`
      );
    }

    // Step 2: Build the instruction data for Lulo.
    // Format: [8-byte Anchor discriminator][8-byte amount as u64 LE]
    // The first 8 bytes must match what's stored in the AllowedAction PDA.
    const instructionData = Buffer.alloc(16);
    Buffer.from(discriminator).copy(instructionData, 0);
    new BN(decision.amount).toArrayLike(Buffer, "le", 8).copy(instructionData, 8);

    // Step 3: Build the accounts that Lulo's instruction expects.
    // These are passed as remaining_accounts to execute_strategy_action.
    // The vault PDA will be automatically marked as signer by the vault program.
    // TODO: Complete with real Lulo accounts (pool state, token accounts, etc.)
    const remainingAccounts = [
      {
        pubkey: this.strategyTokenPda,
        isSigner: false,
        isWritable: true,
      },
      // ... Lulo-specific accounts would go here (pool, market, token program, etc.)
    ];

    // Step 4: Call execute_strategy_action with retry logic.
    // The vault validates the whitelist, then CPIs into Lulo with the vault PDA signing.
    const sig = await executeWithRetry(
      () =>
        this.program.methods
          .executeStrategyAction(Buffer.from(instructionData))
          .accountsStrict({
            caller: this.config.agentKeypair.publicKey,
            vaultState: this.vaultPda,
            strategy: this.strategyPda,
            allowedAction: found.pda,
            targetProgram: this.luloProgramId,
          })
          .remainingAccounts(remainingAccounts)
          .signers([this.config.agentKeypair])
          .rpc(),
      this.config.maxRetries,
      this.config.retryDelayMs
    );

    console.log(
      `  [LULO] ${decision.action} ${(decision.amount / 1e6).toFixed(2)} USDC — tx: ${sig}`
    );
    return sig;
  }
}

// =============================================================================
// RETRY UTILITY
// Retries transient errors (network issues, blockhash expiry, rate limits)
// with linear backoff. Non-transient errors (program errors, validation
// failures) are thrown immediately without retry.
// =============================================================================

async function executeWithRetry(
  fn: () => Promise<string>,
  maxRetries: number,
  delayMs: number
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Only retry transient network/RPC errors, not program logic errors
      if (!isTransientError(error) || attempt === maxRetries) throw error;
      console.warn(
        `  Attempt ${attempt} failed, retrying in ${delayMs * attempt}ms...`
      );
      await sleep(delayMs * attempt);
    }
  }
  throw new Error("Unreachable");
}

// Checks if an error is likely transient (worth retrying).
// Permanent errors like "ActionNotAllowed" or "UnauthorizedCaller" should NOT be retried.
function isTransientError(error: unknown): boolean {
  const msg = String(error);
  return (
    msg.includes("blockhash") ||    // expired blockhash — common on busy networks
    msg.includes("timeout") ||      // RPC request timeout
    msg.includes("429") ||          // rate limited by RPC provider
    msg.includes("503") ||          // service temporarily unavailable
    msg.includes("ECONNRESET")      // TCP connection reset
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
