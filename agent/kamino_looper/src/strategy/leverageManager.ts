// leverageManager.ts — Open and close leveraged loops.
//
// MVP: single-iteration leverage. To open a leveraged USDC position:
//   1. Deposit `amount` USDC as collateral
//   2. Borrow some fraction of `amount` USDC against it (capped by HF safety)
//   3. Re-deposit the borrowed USDC
// Result: (amount + borrow) supplied, borrow borrowed.
//
// Important: in a single-iteration loop, the borrow happens BEFORE the
// re-deposit, so the protocol checks HF at the intermediate state where
// supplied = amount and debt = borrow. To keep that intermediate HF above
// a safety floor (INTERMEDIATE_HF_FLOOR), the maximum borrow is:
//   borrow_max = amount / INTERMEDIATE_HF_FLOOR
// This caps the achievable single-iteration leverage at:
//   max_leverage = 1 + 1 / INTERMEDIATE_HF_FLOOR
// For INTERMEDIATE_HF_FLOOR = 1.10 → max_leverage ≈ 1.909x.
// True 2x+ leverage requires multi-iteration loops or flash loans (not MVP).

import {
  KaminoActionContext,
  kaminoBorrow,
  kaminoDeposit,
  kaminoRepay,
  kaminoWithdraw,
} from "../chain/vault.js";

// Safety margin above the protocol's hard HF_MIN (mock_kamino enforces 1.05).
// 1.10 gives a 5-point buffer so price ticks between txs don't trip the check.
const INTERMEDIATE_HF_FLOOR = 1.10;
const MAX_SINGLE_ITERATION_LEVERAGE = 1 + 1 / INTERMEDIATE_HF_FLOOR;

// Open a USDC loop at the requested leverage (single iteration).
// If the requested leverage exceeds what a single iteration can achieve,
// the borrow is silently capped and the achieved leverage will be lower.
// Returns the list of transaction signatures for each step.
export async function openUsdcLoop(
  ctx: KaminoActionContext,
  amount: number,
  targetLeverage: number,
  log: (msg: string) => void
): Promise<string[]> {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (targetLeverage < 1.0) {
    throw new Error(`Leverage must be >= 1.0, got ${targetLeverage}`);
  }

  const sigs: string[] = [];

  // Step 1: Deposit initial collateral
  log(`Depositing ${(amount / 1e6).toFixed(2)} USDC as collateral`);
  sigs.push(await kaminoDeposit(ctx, amount));

  if (targetLeverage <= 1.0) {
    return sigs; // single-side lend, no borrow needed
  }

  // Step 2: Borrow, capped so intermediate HF stays above the safety floor.
  const requestedBorrow = Math.floor(amount * (targetLeverage - 1));
  const maxSafeBorrow = Math.floor(amount / INTERMEDIATE_HF_FLOOR);
  const borrowAmount = Math.min(requestedBorrow, maxSafeBorrow);

  if (borrowAmount < requestedBorrow) {
    const achieved = 1 + borrowAmount / amount;
    log(
      `Capped borrow: requested ${targetLeverage.toFixed(2)}x → achievable ${achieved.toFixed(2)}x (single-iteration max ${MAX_SINGLE_ITERATION_LEVERAGE.toFixed(2)}x)`
    );
  }

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
