/**
 * Registry of redeem adapters. The frontend's `useWithdraw` orchestration
 * walks this list per strategy: each adapter is asked for an open position;
 * if any have non-zero `underlyingAvailable`, the orchestrator builds the
 * corresponding redeem action and stacks it ahead of the `withdraw` ix in
 * the same transaction.
 *
 * Order matters mildly — adapters earlier in the list are queried first.
 * Pick a stable, low-latency one (mock-Kamino on devnet, Kamino mainnet
 * on prod) as the default.
 */

import type { RedeemAdapter, ProtocolPosition } from "./types";
import { mockKaminoAdapter } from "./mockKamino";
import { mockLuloAdapter } from "./mockLulo";
import { jupiterAdapter } from "./jupiter";

export const ADAPTERS: RedeemAdapter[] = [
  mockKaminoAdapter,
  mockLuloAdapter,
  jupiterAdapter,
];

export function adapterById(id: string): RedeemAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

export type { RedeemAdapter, ProtocolPosition };
export { mockKaminoAdapter, mockLuloAdapter, jupiterAdapter };
