// strategy.ts — Lending protocol integration via execute_action.
//
// The agent never calls mock_lulo (or real Lulo) directly. Every CPI goes
// through the Erebor vault's execute_action gateway, which:
//   1. Verifies the (strategy, target_program, discriminator) tuple is on
//      the AllowedAction whitelist
//   2. Pins one slot in remaining_accounts to strategy.token_account
//      (the recipient pin)
//   3. Snapshots both caller's and delegate's underlying ATAs
//   4. invoke_signed's the inner CPI as strategy_authority[i]
//   5. Anti-theft re-reads both ATAs; reverts if either grew
//
// Both deposit ("LEND") and withdraw target mock_lulo's 6-account layout
// (strategy_token_account, treasury, mint, vault_authority, token_program,
// position) — the strategy ATA is at index 0 in both cases.

import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { createHash } from "crypto";
import type { MyProject } from "../../../target/types/my_project.js";
import type { AgentConfig, AgentDecision, LuloProtocol } from "../../shared/types.js";
import {
  deriveAllowedActionPda,
  deriveProtocolPositionPda,
  fetchProtocolPosition,
  fetchTokenBalance,
} from "../../shared/vault-client.js";

// =============================================================================
// DISCRIMINATORS + RECIPIENT INDICES
// =============================================================================

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

const DEPOSIT_DISCRIMINATOR = anchorDiscriminator("deposit");
const WITHDRAW_DISCRIMINATOR = anchorDiscriminator("withdraw");

// Both mock_lulo deposit and withdraw place strategy_token_account at slot 0
// in their account structs. Must match what add_allowed_action(...) is called
// with at setup — off-by-one here breaks every execute_action with
// RecipientMismatch.
export const LULO_RECIPIENT_INDEX = {
  lend: 0,
  withdraw: 0,
} as const;

// =============================================================================
// CONSTRUCTOR OPTIONS
// =============================================================================

export interface OnChainLuloProtocolOpts {
  program: Program<MyProject>;
  connection: Connection;
  config: AgentConfig;
  vaultPda: PublicKey;
  strategyPda: PublicKey;
  strategyTokenPda: PublicKey;
  strategyAuthorityPda: PublicKey;
  luloProgramId: PublicKey;
  treasuryPda: PublicKey;
  tokenMint: PublicKey;
  vaultProgramId: PublicKey;
  // Caller's + delegate's underlying ATAs — both must already exist on-chain
  // (setup script creates the agent's USDC ATA). When agent == delegate, both
  // are the same account.
  callerTokenAta: PublicKey;
  delegateTokenAta: PublicKey;
  strategyId: number;
}

// =============================================================================
// LENDING PROTOCOL IMPLEMENTATION
// =============================================================================

export class OnChainLuloProtocol implements LuloProtocol {
  private program: Program<MyProject>;
  private connection: Connection;
  private config: AgentConfig;
  private vaultPda: PublicKey;
  private strategyPda: PublicKey;
  private strategyTokenPda: PublicKey;
  private strategyAuthorityPda: PublicKey;
  private luloProgramId: PublicKey;
  private treasuryPda: PublicKey;
  private tokenMint: PublicKey;
  private vaultProgramId: PublicKey;
  private callerTokenAta: PublicKey;
  private delegateTokenAta: PublicKey;
  private strategyId: number;

  constructor(opts: OnChainLuloProtocolOpts) {
    this.program = opts.program;
    this.connection = opts.connection;
    this.config = opts.config;
    this.vaultPda = opts.vaultPda;
    this.strategyPda = opts.strategyPda;
    this.strategyTokenPda = opts.strategyTokenPda;
    this.strategyAuthorityPda = opts.strategyAuthorityPda;
    this.luloProgramId = opts.luloProgramId;
    this.treasuryPda = opts.treasuryPda;
    this.tokenMint = opts.tokenMint;
    this.vaultProgramId = opts.vaultProgramId;
    this.callerTokenAta = opts.callerTokenAta;
    this.delegateTokenAta = opts.delegateTokenAta;
    this.strategyId = opts.strategyId;
  }

  // Reads the on-chain ProtocolPosition to compute observed yield against
  // the treasury balance. Surplus over principal == accrued yield.
  async getCurrentYield(): Promise<{ rate: number; hasAccrued: boolean }> {
    const positionPda = deriveProtocolPositionPda(this.strategyTokenPda, this.luloProgramId);
    const principal = await fetchProtocolPosition(this.connection, positionPda);
    if (principal <= 0) return { rate: 0, hasAccrued: false };

    const treasuryBalance = await fetchTokenBalance(this.connection, this.treasuryPda).catch(() => 0);
    const surplus = treasuryBalance - principal;
    if (surplus > 0) {
      return { rate: surplus / principal, hasAccrued: true };
    }
    return { rate: 0, hasAccrued: false };
  }

  // Returns this strategy's deposited principal from the on-chain
  // ProtocolPosition. The vault reads the same account during report_yield
  // to compute total strategy value.
  async getLentBalance(): Promise<number> {
    const positionPda = deriveProtocolPositionPda(this.strategyTokenPda, this.luloProgramId);
    return fetchProtocolPosition(this.connection, positionPda);
  }

  async execute(decision: AgentDecision): Promise<string> {
    if (decision.action === "HOLD") return "no-op";

    const isDeposit = decision.action === "LEND";
    const discriminator = isDeposit ? DEPOSIT_DISCRIMINATOR : WITHDRAW_DISCRIMINATOR;

    // Deterministic AllowedAction PDA — admin must have created it at setup
    // via add_allowed_action(strategyId, luloProgramId, discriminator,
    // expected_recipient_index=0, output_mint_index=None).
    const allowedActionPda = deriveAllowedActionPda(
      this.strategyPda,
      this.luloProgramId,
      discriminator,
      this.vaultProgramId
    );

    // ix_data body = u64 amount LE; the discriminator goes in a separate arg.
    const ixData = new BN(decision.amount).toArrayLike(Buffer, "le", 8);

    const positionPda = deriveProtocolPositionPda(this.strategyTokenPda, this.luloProgramId);

    // remaining_accounts must match mock_lulo's Deposit / Withdraw struct
    // exactly. mock_lulo names slot 3 "vault_authority" but on OLD_Erebor's
    // model it's the strategy_authority PDA — execute_action marks it as
    // signer at the meta-build stage so mock_lulo's Signer<'info> /
    // UncheckedAccount<'info> constraint is satisfied.
    const remainingAccounts = [
      { pubkey: this.strategyTokenPda, isSigner: false, isWritable: true },
      { pubkey: this.treasuryPda, isSigner: false, isWritable: true },
      { pubkey: this.tokenMint, isSigner: false, isWritable: false },
      { pubkey: this.strategyAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
    ];

    const sig = await executeWithRetry(
      () =>
        this.program.methods
          .executeAction(
            new BN(this.strategyId),
            this.luloProgramId,
            Array.from(discriminator) as any,
            ixData
          )
          .accountsStrict({
            caller: this.config.agentKeypair.publicKey,
            vaultState: this.vaultPda,
            strategy: this.strategyPda,
            strategyAuthority: this.strategyAuthorityPda,
            allowedAction: allowedActionPda,
            callerTokenAta: this.callerTokenAta,
            delegateTokenAta: this.delegateTokenAta,
            targetProgramAccount: this.luloProgramId,
            // output_mint_index is None for lulo, so this is a placeholder.
            allowedOutputToken: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .signers([this.config.agentKeypair])
          .rpc(),
      this.config.maxRetries,
      this.config.retryDelayMs
    );

    console.log(
      `  [PROTOCOL] ${decision.action} ${(decision.amount / 1e6).toFixed(2)} USDC — tx: ${sig}`
    );
    return sig;
  }
}

// =============================================================================
// RETRY UTILITY
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
      if (!isTransientError(error) || attempt === maxRetries) throw error;
      console.warn(
        `  Attempt ${attempt} failed, retrying in ${delayMs * attempt}ms...`
      );
      await sleep(delayMs * attempt);
    }
  }
  throw new Error("Unreachable");
}

// Only retry transient network/RPC errors, not program logic errors.
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
