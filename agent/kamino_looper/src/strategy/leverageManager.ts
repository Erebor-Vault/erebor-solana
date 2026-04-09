// leverageManager.ts — Open and close leveraged loops.
//
// MVP: single-iteration leverage. To reach 2x leverage on USDC:
//   1. Deposit `amount` USDC as collateral
//   2. Borrow `amount` USDC against it
//   3. Deposit the borrowed USDC
// Result: 2*amount supplied, amount borrowed, leverage = 2.0
//
// For 3x leverage, you would do another borrow+deposit, but the MVP only
// supports a single iteration (max 2x effective leverage per call).

import {
  KaminoActionContext,
  kaminoBorrow,
  kaminoDeposit,
  kaminoRepay,
  kaminoWithdraw,
} from "../chain/vault.js";

// Open a USDC loop at the requested leverage.
// For MVP, only leverage in [1.0, 2.0] is supported (single iteration).
// Returns the list of transaction signatures for each step.
export async function openUsdcLoop(
  ctx: KaminoActionContext,
  amount: number,
  targetLeverage: number,
  log: (msg: string) => void
): Promise<string[]> {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (targetLeverage < 1.0 || targetLeverage > 2.0) {
    throw new Error(
      `MVP supports leverage 1.0–2.0, got ${targetLeverage}. Multi-iteration loops not implemented.`
    );
  }

  const sigs: string[] = [];

  // Step 1: Deposit initial collateral
  log(`Depositing ${(amount / 1e6).toFixed(2)} USDC as collateral`);
  sigs.push(await kaminoDeposit(ctx, amount));

  if (targetLeverage <= 1.0) {
    return sigs; // single-side lend, no borrow needed
  }

  // Step 2: Borrow (leverage - 1) * amount
  const borrowAmount = Math.floor(amount * (targetLeverage - 1));
  log(`Borrowing ${(borrowAmount / 1e6).toFixed(2)} USDC`);
  sigs.push(await kaminoBorrow(ctx, borrowAmount));

  // Step 3: Re-deposit the borrowed amount as additional collateral
  log(`Re-depositing ${(borrowAmount / 1e6).toFixed(2)} USDC borrowed`);
  sigs.push(await kaminoDeposit(ctx, borrowAmount));

  return sigs;
}

// Close a USDC loop by reversing the operations.
// Withdraw enough collateral to repay all debt, then withdraw remaining.
export async function closeUsdcLoop(
  ctx: KaminoActionContext,
  borrowed: number,
  supplied: number,
  log: (msg: string) => void
): Promise<string[]> {
  const sigs: string[] = [];

  if (borrowed > 0) {
    // Step 1: Withdraw enough collateral to repay debt
    // (This requires HF still passes — MVP just withdraws the borrowed amount)
    log(`Withdrawing ${(borrowed / 1e6).toFixed(2)} USDC to repay debt`);
    sigs.push(await kaminoWithdraw(ctx, borrowed));

    // Step 2: Repay the borrowed amount
    log(`Repaying ${(borrowed / 1e6).toFixed(2)} USDC debt`);
    sigs.push(await kaminoRepay(ctx, borrowed));
  }

  // Step 3: Withdraw remaining collateral
  const remaining = supplied - borrowed;
  if (remaining > 0) {
    log(`Withdrawing remaining ${(remaining / 1e6).toFixed(2)} USDC`);
    sigs.push(await kaminoWithdraw(ctx, remaining));
  }

  return sigs;
}
