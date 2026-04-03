import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import BN from "bn.js";
import type { MyProject } from "../../target/types/my_project.js";
import type { AgentConfig, AgentDecision, LuloProtocol } from "./types.js";
import {
  deriveAllowedActionPda,
  findAllowedActionByDiscriminator,
} from "./vault-client.js";

// --- Mock Lulo Protocol (devnet) ---

export class MockLuloProtocol implements LuloProtocol {
  private lentAmount: number = 0;
  private baseYield: number = 0.05; // 5% APY

  async getCurrentYield(): Promise<number> {
    // Slight randomization to simulate real yield fluctuation
    return this.baseYield + (Math.random() - 0.5) * 0.01;
  }

  async getLentBalance(): Promise<number> {
    return this.lentAmount;
  }

  async execute(decision: AgentDecision): Promise<string> {
    if (decision.action === "LEND") {
      this.lentAmount += decision.amount;
      console.log(
        `  [MOCK LULO] Deposited ${(decision.amount / 1e6).toFixed(2)} USDC → total lent: ${(this.lentAmount / 1e6).toFixed(2)} USDC`
      );
    } else if (decision.action === "WITHDRAW") {
      const withdrawAmount = Math.min(decision.amount, this.lentAmount);
      this.lentAmount -= withdrawAmount;
      console.log(
        `  [MOCK LULO] Withdrew ${(withdrawAmount / 1e6).toFixed(2)} USDC → total lent: ${(this.lentAmount / 1e6).toFixed(2)} USDC`
      );
    }
    return `mock-tx-${Date.now()}`;
  }
}

// --- Real Lulo Protocol (mainnet) ---

export class RealLuloProtocol implements LuloProtocol {
  private program: Program<MyProject>;
  private connection: Connection;
  private config: AgentConfig;
  private vaultPda: PublicKey;
  private strategyPda: PublicKey;
  private strategyTokenPda: PublicKey;
  private luloProgramId: PublicKey;
  private depositDiscriminator: number[];
  private withdrawDiscriminator: number[];

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

  async getCurrentYield(): Promise<number> {
    // TODO: Fetch real yield from Lulo API
    // GET https://api.flexlend.fi/v1/rates?token=USDC
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

  async getLentBalance(): Promise<number> {
    // TODO: Read the Lulo deposit receipt or pool balance for this strategy
    // For now, return 0 — the real implementation depends on Lulo's account layout
    return 0;
  }

  async execute(decision: AgentDecision): Promise<string> {
    if (decision.action === "HOLD") return "no-op";

    const isDeposit = decision.action === "LEND";
    const discriminator = isDeposit
      ? this.depositDiscriminator
      : this.withdrawDiscriminator;

    // Find the AllowedAction PDA that matches this discriminator
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

    // Build Lulo instruction data: [8-byte discriminator, amount as u64 LE]
    const instructionData = Buffer.alloc(16);
    Buffer.from(discriminator).copy(instructionData, 0);
    new BN(decision.amount).toArrayLike(Buffer, "le", 8).copy(instructionData, 8);

    // TODO: Build real Lulo remaining accounts (pool, market, token program, etc.)
    // This depends on Lulo's on-chain program layout which needs to be determined
    // from their IDL or by inspecting mainnet transactions.
    const remainingAccounts = [
      {
        pubkey: this.strategyTokenPda,
        isSigner: false,
        isWritable: true,
      },
      // ... Lulo-specific accounts would go here
    ];

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

// --- Retry utility ---

async function executeWithRetry(
  fn: () => Promise<string>,
  maxRetries: number,
  delayMs: number
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientError(error) || attempt === maxRetries) throw error;
      console.warn(
        `  Attempt ${attempt} failed, retrying in ${delayMs * attempt}ms...`
      );
      await sleep(delayMs * attempt);
    }
  }
  throw new Error("Unreachable");
}

function isTransientError(error: unknown): boolean {
  const msg = String(error);
  return (
    msg.includes("blockhash") ||
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("ECONNRESET")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
