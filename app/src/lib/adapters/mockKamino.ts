/**
 * Mock-Kamino redeem adapter. Targets the in-repo `mock_kamino` program
 * deployed on devnet at `H4tUCeXMQduSmB6fjqbYMdFb49E8YnEHku5NWFrWKaGU` and
 * mirrors a single-reserve cToken model close enough to real Kamino Lend
 * that the program-side execute_action path is exercised end-to-end.
 *
 * Used as the default redeem path during devnet testing. Real Kamino Lend
 * (mainnet) ships in `kamino.ts` once we move to mainnet — same interface,
 * different account derivations.
 */

import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
  AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { sha256 } from "@noble/hashes/sha2";
import type { RedeemAdapter, ProtocolPosition } from "./types";

export const MOCK_KAMINO_PROGRAM_ID = new PublicKey(
  "H4tUCeXMQduSmB6fjqbYMdFb49E8YnEHku5NWFrWKaGU",
);

/** Anchor discriminator: sha256("global:withdraw_obligation_collateral_and_redeem_reserve_collateral")[..8]. */
const WITHDRAW_DISC: number[] = Array.from(
  sha256(
    new TextEncoder().encode(
      "global:withdraw_obligation_collateral_and_redeem_reserve_collateral",
    ),
  ).slice(0, 8),
);

function deriveReservePda(liquidityMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), liquidityMint.toBuffer()],
    MOCK_KAMINO_PROGRAM_ID,
  );
  return pda;
}

function deriveCollateralMintPda(liquidityMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), liquidityMint.toBuffer()],
    MOCK_KAMINO_PROGRAM_ID,
  );
  return pda;
}

// Per-(reserve, owner) borrow PDA. Owner here is the strategy_authority PDA
// (the only signer mock_kamino's borrow_obligation_liquidity accepts).
function deriveObligationPda(
  reservePda: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), reservePda.toBuffer(), owner.toBuffer()],
    MOCK_KAMINO_PROGRAM_ID,
  );
  return pda;
}

export const mockKaminoAdapter: RedeemAdapter = {
  id: "mock-kamino",
  label: "Mock Kamino · USDC reserve",
  targetProgram: MOCK_KAMINO_PROGRAM_ID,
  discriminator: WITHDRAW_DISC,

  async readPosition({ connection, strategy, underlyingMint }): Promise<ProtocolPosition | null> {
    const reservePda = deriveReservePda(underlyingMint);
    const collateralMint = deriveCollateralMintPda(underlyingMint);
    const obligationPda = deriveObligationPda(reservePda, strategy.strategyAuthority);

    // Strategy's cToken ATA — owned by strategy_authority[i] because that's
    // the signer authority on every mock_kamino deposit/withdraw/borrow/repay.
    const strategyCollateralAta = getAssociatedTokenAddressSync(
      collateralMint,
      strategy.strategyAuthority,
      true,
    );

    // Read cToken ATA, reserve totals, and obligation in parallel.
    const [collateralAcct, reserveAcct, obligationAcct] = await Promise.all([
      connection.getAccountInfo(strategyCollateralAta),
      connection.getAccountInfo(reservePda),
      connection.getAccountInfo(obligationPda),
    ]);
    if (!collateralAcct || !reserveAcct) return null;

    // SPL token account: amount at offset 64..72.
    const collateralBalance = new BN(collateralAcct.data.slice(64, 72), "le");
    if (collateralBalance.isZero()) return null;

    // Obligation layout (after 8-byte discriminator):
    //   reserve(32) owner(32) borrowed_liquidity(8) bump(1)
    // If the obligation has outstanding debt, redeeming naïvely would either
    // fail HF or leave the position underwater. The orchestrator can't safely
    // unwind a loop in a single redeem ix — that needs withdraw → repay →
    // withdraw via the agent's close-loop flow. Surface 0 here so the
    // orchestrator falls through; authority must close loops first.
    let borrowedLiquidity = new BN(0);
    if (obligationAcct && obligationAcct.data.length >= 80) {
      borrowedLiquidity = new BN(obligationAcct.data.slice(8 + 64, 8 + 72), "le");
    }

    // Reserve layout (after 8-byte Anchor discriminator):
    //   admin(32) liquidity_mint(32) collateral_mint(32) liquidity_supply(32)
    //   total_liquidity(8) total_collateral_supply(8) total_borrowed(8)
    //   bump(1) collateral_mint_bump(1)
    const reserveData = reserveAcct.data;
    const totalLiquidity = new BN(reserveData.slice(8 + 128, 8 + 136), "le");
    const totalCollateral = new BN(reserveData.slice(8 + 136, 8 + 144), "le");

    if (!borrowedLiquidity.isZero()) {
      return {
        label: this.label,
        underlyingAvailable: new BN(0),
        raw: {
          reservePda: reservePda.toBase58(),
          obligationPda: obligationPda.toBase58(),
          borrowedLiquidity: borrowedLiquidity.toString(),
          collateralBalance: collateralBalance.toString(),
          note: "outstanding debt — close loop first",
        },
      };
    }

    // No debt: underlyingAvailable = collateralBalance × totalLiquidity / totalCollateral.
    const underlyingAvailable = totalCollateral.isZero()
      ? collateralBalance
      : collateralBalance.mul(totalLiquidity).div(totalCollateral);

    return {
      label: this.label,
      underlyingAvailable,
      raw: {
        reservePda: reservePda.toBase58(),
        collateralMint: collateralMint.toBase58(),
        collateralBalance: collateralBalance.toString(),
        totalLiquidity: totalLiquidity.toString(),
        totalCollateral: totalCollateral.toString(),
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
    const reservePda = deriveReservePda(underlyingMint);
    const collateralMint = deriveCollateralMintPda(underlyingMint);
    const reserveLiquiditySupply = getAssociatedTokenAddressSync(
      underlyingMint,
      reservePda,
      true,
    );

    // Derive strategy_authority (mock_kamino's withdraw expects this as the
    // signer authority on the cToken ATA).
    const strategyId = strategy.strategyId.toNumber();
    const [strategyAuthority] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy_authority"),
        vaultPda.toBuffer(),
        new BN(strategyId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    const strategyCollateralAta = getAssociatedTokenAddressSync(
      collateralMint,
      strategyAuthority,
      true,
    );

    // Convert underlyingAmount → collateral_amount via current reserve
    // ratio. Reads totalLiquidity / totalCollateral from chain.
    const reserveAcct = await program.provider.connection.getAccountInfo(reservePda);
    if (!reserveAcct) throw new Error("Mock-Kamino reserve account not found");
    const totalLiquidity = new BN(reserveAcct.data.slice(8 + 128, 8 + 136), "le");
    const totalCollateral = new BN(reserveAcct.data.slice(8 + 136, 8 + 144), "le");
    let collateralAmount: BN;
    if (totalLiquidity.isZero() || totalCollateral.isZero()) {
      collateralAmount = underlyingAmount;
    } else {
      // collateral = underlyingAmount × totalCollateral / totalLiquidity, rounded UP
      collateralAmount = underlyingAmount
        .mul(totalCollateral)
        .add(totalLiquidity.subn(1))
        .div(totalLiquidity);
    }

    // Build the relayed-ix data: u64 collateral_amount (LE), the discriminator
    // is prepended by the program inside execute_action.
    const ixData = Buffer.from(collateralAmount.toArrayLike(Buffer, "le", 8));

    // Account list expected by mock_kamino.withdraw (recipient_index = 1):
    const remainingAccounts: AccountMeta[] = [
      { pubkey: strategyCollateralAta, isSigner: false, isWritable: true },
      { pubkey: strategy.tokenAccount, isSigner: false, isWritable: true }, // recipient_index = 1
      { pubkey: reservePda, isSigner: false, isWritable: true },
      { pubkey: underlyingMint, isSigner: false, isWritable: false },
      { pubkey: collateralMint, isSigner: false, isWritable: true },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: strategyAuthority, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    // Locate the AllowedAction PDA — caller is responsible for ensuring the
    // admin has whitelisted (mock_kamino, withdraw_disc) on this strategy.
    const [allowedAction] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_action"),
        strategy.publicKey.toBuffer(),
        MOCK_KAMINO_PROGRAM_ID.toBuffer(),
        Buffer.from(WITHDRAW_DISC),
      ],
      program.programId,
    );

    // Caller's ATA + delegate's ATA (anti-theft snapshot points). For a
    // redeem-back-to-strategy flow these don't grow, so picking the strategy
    // delegate's underlying ATA for both is correct.
    const callerTokenAta = getAssociatedTokenAddressSync(
      underlyingMint,
      caller,
      true,
    );
    const delegateTokenAta = getAssociatedTokenAddressSync(
      underlyingMint,
      strategy.delegate,
      true,
    );

    return await program.methods
      .executeAction(strategy.strategyId, MOCK_KAMINO_PROGRAM_ID, WITHDRAW_DISC, ixData)
      .accountsStrict({
        caller,
        vaultState: vaultPda,
        strategy: strategy.publicKey,
        strategyAuthority,
        allowedAction,
        callerTokenAta,
        delegateTokenAta,
        targetProgramAccount: MOCK_KAMINO_PROGRAM_ID,
        // Phase-4d: this adapter's redeem leaves the strategy holding the
        // SAME underlying mint, so output_mint_index on the AllowedAction
        // should be `null`. Pass SystemProgram::id as a placeholder; the
        // program ignores it when the gate isn't enabled.
        allowedOutputToken: SystemProgram.programId,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  },
};
