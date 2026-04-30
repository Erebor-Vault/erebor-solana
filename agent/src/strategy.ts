import {
  Connection,
  PublicKey,
  Transaction,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import type { Decision, StrategySnapshot } from "./types";

/**
 * Move funds out of the strategy ATA (signed via SPL delegate) and
 * into the agent's own ATA. This is the "two-step" pattern — the
 * agent then independently lends from its ATA into the chosen
 * protocol. Per AI_PLAN.md.
 *
 * Note: when the spec's `execute_action` whitelist
 * (SOLANA_VAULT_SPEC.md §7.7) ships, this transfer should go away
 * and the agent should call `execute_action` with a Lulo
 * `lend`/`withdraw` discriminator on the whitelist instead. See
 * MISMATCHES.md §2.3.
 */
export async function pullFromStrategy(
  connection: Connection,
  agent: Signer,
  tokenMint: PublicKey,
  strategyTokenAccount: PublicKey,
  amount: bigint
): Promise<string> {
  const agentAta = getAssociatedTokenAddressSync(tokenMint, agent.publicKey);

  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      agent.publicKey,
      agentAta,
      agent.publicKey,
      tokenMint
    ),
    createTransferInstruction(
      strategyTokenAccount,
      agentAta,
      agent.publicKey, // SPL delegate authority
      amount,
      [],
      TOKEN_PROGRAM_ID
    ),
  ];

  const tx = new Transaction().add(...ixs);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = agent.publicKey;
  tx.sign(agent);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
  return sig;
}

/**
 * Lend `amount` of the underlying via the configured protocol. Today
 * this is a mock — it just logs the action and returns a placeholder
 * signature. A real Lulo / Marginfi / Drift integration plugs in here
 * by replacing the `lendMock` body.
 *
 * Returning early without a tx is fine — the harness treats that as
 * "considered, no-op".
 */
export async function lend(
  decision: Extract<Decision, { kind: "lend" }>,
  snapshot: StrategySnapshot,
  options: { useMockLulo: boolean }
): Promise<{ signature: string | null; note: string }> {
  if (options.useMockLulo) {
    return {
      signature: null,
      note: `[mock-lulo] would lend ${decision.amount} from strategy ${snapshot.strategyId}`,
    };
  }
  // Real Lulo / Marginfi / Drift integration goes here. Keep this
  // branch mock-only until the spec's execute_action gateway is in
  // place — without it the agent has no on-chain proof that this
  // call is sandboxed.
  return {
    signature: null,
    note: `[real-lulo] not yet implemented — see AI_PLAN.md §5`,
  };
}

/**
 * Withdraw `amount` from the protocol back to the agent ATA, then
 * push it back into the strategy ATA so the vault can withdraw it
 * via `deallocate_from_strategy`. Mock equivalent for now.
 */
export async function withdraw(
  decision: Extract<Decision, { kind: "withdraw" }>,
  snapshot: StrategySnapshot,
  options: { useMockLulo: boolean }
): Promise<{ signature: string | null; note: string }> {
  if (options.useMockLulo) {
    return {
      signature: null,
      note: `[mock-lulo] would withdraw ${decision.amount} from strategy ${snapshot.strategyId}`,
    };
  }
  return {
    signature: null,
    note: `[real-lulo] not yet implemented — see AI_PLAN.md §5`,
  };
}
