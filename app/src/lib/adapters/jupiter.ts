/**
 * Jupiter v6 redeem adapter — stub.
 *
 * Real wiring needs Jupiter's HTTP swap-API:
 *   1. POST https://quote-api.jup.ag/v6/quote with
 *      `{ inputMint: <strategy_holding>, outputMint: <vault.token_mint>,
 *         amount: <best-effort>, swapMode: "ExactIn" }` to get a route.
 *   2. POST .../swap-instructions with `{ quoteResponse, userPublicKey:
 *      strategy_authority, wrapAndUnwrapSol: false, asLegacyTransaction:
 *      false }` to get the raw swap ix + lookup tables + cleanup ixs.
 *   3. Repackage the swap ix as `execute_action(JUPITER_V6, route_disc,
 *      <ix.data>)` with `remaining_accounts = ix.keys`.
 *
 * Two non-trivial bits before this can run on devnet:
 *   - Jupiter quote-api needs to know the input mint exists *with non-zero
 *     liquidity on mainnet*; devnet test mints have neither.
 *   - Output token must be on the protocol-level allow list (Phase 4d) —
 *     each strategy's `withdraw_config` route can only target whitelisted
 *     mints.
 *
 * Returns null for now so the orchestrator falls through to other adapters.
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { RedeemAdapter, ProtocolPosition } from "./types";

export const JUPITER_V6_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);

const ROUTE_DISC: number[] = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];

export const jupiterAdapter: RedeemAdapter = {
  id: "jupiter-v6",
  label: "Jupiter v6 · swap-back-to-USDC",
  targetProgram: JUPITER_V6_PROGRAM_ID,
  discriminator: ROUTE_DISC,

  async readPosition(): Promise<ProtocolPosition | null> {
    // Jupiter is a swap router, not a custody protocol — strategies don't
    // "park" funds in Jupiter. A position would mean the strategy holds a
    // non-USDC asset (e.g. JLP, mSOL) that needs swapping back.
    //
    // To implement: scan the strategy_authority's ATAs for non-USDC mints
    // with non-zero balance, return their underlying-equivalent value via
    // a Jupiter quote.
    return null;
  },

  async buildRedeemAction(): Promise<TransactionInstruction> {
    throw new Error(
      "jupiterAdapter.buildRedeemAction not implemented — wire jup-ag/api first",
    );
  },
};
