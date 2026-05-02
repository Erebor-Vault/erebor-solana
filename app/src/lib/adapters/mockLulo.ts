/**
 * Mock-Lulo redeem adapter. Targets the in-repo `mock_lulo` program deployed
 * on devnet at `DUECqnJ77fP2Kd9SqeTsVc9n7MiTaBvSW3mREM8DuBVs`.
 *
 * mock_lulo is a single-asset lending mock: deposits go into a per-mint
 * treasury and a per-strategy ProtocolPosition tracks the deposited
 * principal. Withdrawals pull from the treasury back into the strategy ATA;
 * the position's `deposited_amount` decrements (saturating to 0 for yield
 * over-pull). The mock has no on-chain yield mechanism — `simulate_yield`
 * isn't part of mock_lulo — so `underlyingAvailable` equals the recorded
 * principal.
 *
 * AllowedAction PDA seeds: ["allowed_action", strategy, mock_lulo,
 * sha256("global:withdraw")[..8]]. Admin must have called add_allowed_action
 * with `expected_recipient_index = 0` and `output_mint_index = None` for
 * this redeem to succeed.
 */

import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
  AccountMeta,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { sha256 } from "@noble/hashes/sha2";
import type { RedeemAdapter, ProtocolPosition } from "./types";

export const MOCK_LULO_PROGRAM_ID = new PublicKey(
  "DUECqnJ77fP2Kd9SqeTsVc9n7MiTaBvSW3mREM8DuBVs",
);

/** Anchor discriminator: sha256("global:withdraw")[..8]. */
const WITHDRAW_DISC: number[] = Array.from(
  sha256(new TextEncoder().encode("global:withdraw")).slice(0, 8),
);

function deriveTreasuryPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mint.toBuffer()],
    MOCK_LULO_PROGRAM_ID,
  );
  return pda;
}

// ProtocolPosition seeds — keyed by strategy_token_account, not by strategy
// PDA. mock_lulo's initialize_position uses this same seed.
function derivePositionPda(strategyTokenAccount: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenAccount.toBuffer()],
    MOCK_LULO_PROGRAM_ID,
  );
  return pda;
}

export const mockLuloAdapter: RedeemAdapter = {
  id: "mock-lulo",
  label: "Mock Lulo · USDC vault",
  targetProgram: MOCK_LULO_PROGRAM_ID,
  discriminator: WITHDRAW_DISC,

  async readPosition({ connection, strategy }): Promise<ProtocolPosition | null> {
    const positionPda = derivePositionPda(strategy.tokenAccount);
    const info = await connection.getAccountInfo(positionPda);
    if (!info || info.data.length < 48) return null;

    // ProtocolPosition layout (after 8-byte Anchor discriminator):
    //   strategy_token_account(32) deposited_amount(u64) bump(u8)
    const deposited = new BN(info.data.subarray(40, 48), "le");
    if (deposited.isZero()) return null;

    return {
      label: this.label,
      underlyingAvailable: deposited,
      raw: {
        positionPda: positionPda.toBase58(),
        depositedAmount: deposited.toString(),
      },
    };
  },

  async buildRedeemAction({
    program,
    caller,
    vaultPda,
    strategy,
    underlyingMint,
    underlyingAmount,
  }): Promise<TransactionInstruction> {
    const treasuryPda = deriveTreasuryPda(underlyingMint);
    const positionPda = derivePositionPda(strategy.tokenAccount);

    // Account list expected by mock_lulo.withdraw (recipient_index = 0):
    //   0  strategy_token_account (mut)   ← strategy ATA, recipient pin
    //   1  treasury (mut)
    //   2  mint
    //   3  vault_authority (UncheckedAccount; mock_lulo's withdraw doesn't
    //      require a signer here — the treasury PDA signs internally — but
    //      execute_action will mark this slot as a signer at meta-build time
    //      because the key matches strategy_authority. Harmless for mock_lulo.)
    //   4  token_program
    //   5  position (mut)
    const remainingAccounts: AccountMeta[] = [
      { pubkey: strategy.tokenAccount, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: true },
      { pubkey: underlyingMint, isSigner: false, isWritable: false },
      { pubkey: strategy.strategyAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
    ];

    // Locate the AllowedAction PDA — admin must have called add_allowed_action
    // with (mock_lulo, withdraw_disc, expected_recipient_index=0,
    // output_mint_index=None) on this strategy.
    const [allowedAction] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_action"),
        strategy.publicKey.toBuffer(),
        MOCK_LULO_PROGRAM_ID.toBuffer(),
        Buffer.from(WITHDRAW_DISC),
      ],
      program.programId,
    );

    // Caller's + delegate's underlying ATAs — anti-theft snapshot points.
    // Redeem-back-to-strategy doesn't grow either, so this passes the
    // post-execute check trivially.
    const callerTokenAta = getAssociatedTokenAddressSync(underlyingMint, caller, true);
    const delegateTokenAta = getAssociatedTokenAddressSync(
      underlyingMint,
      strategy.delegate,
      true,
    );

    // ix_data body = u64 amount LE; the discriminator goes in the separate
    // executeAction arg (vault prepends it before invoke_signed).
    const ixData = Buffer.from(underlyingAmount.toArrayLike(Buffer, "le", 8));

    return await program.methods
      .executeAction(strategy.strategyId, MOCK_LULO_PROGRAM_ID, WITHDRAW_DISC, ixData)
      .accountsStrict({
        caller,
        vaultState: vaultPda,
        strategy: strategy.publicKey,
        strategyAuthority: strategy.strategyAuthority,
        allowedAction,
        callerTokenAta,
        delegateTokenAta,
        targetProgramAccount: MOCK_LULO_PROGRAM_ID,
        // mock_lulo.withdraw doesn't change the held mint, so output_mint_index
        // on the AllowedAction is None. SystemProgram is the standard
        // placeholder per the IDL doc — applies to both layers (protocol
        // allow-list + per-vault curator allow-list).
        allowedOutputToken: SystemProgram.programId,
        vaultAllowedOutputToken: SystemProgram.programId,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  },
};
