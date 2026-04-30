import {
  Connection,
  PublicKey,
  type Commitment,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import type { StrategySnapshot } from "./types";

/**
 * PDA helpers — must match programs/my_project/src/lib.rs.
 *   vault           : ["vault", token_mint, vault_id_le_u64]
 *   share_mint      : ["shares", vault_state]
 *   strategy        : ["strategy", vault_state, strategy_id_le_u64]
 *   strategy_token  : ["strategy_token", vault_state, strategy_id_le_u64]
 */
export function deriveVaultPda(
  programId: PublicKey,
  tokenMint: PublicKey,
  vaultId: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      tokenMint.toBuffer(),
      new BN(vaultId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  )[0];
}

export function deriveStrategyPda(
  programId: PublicKey,
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  )[0];
}

export function deriveStrategyTokenPda(
  programId: PublicKey,
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_token"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  )[0];
}

/**
 * Pull a fresh on-chain snapshot the advisor can act on. Uses
 * Anchor's account discriminators only at the layout level — the
 * fields here are read by raw offsets to keep the agent decoupled
 * from the IDL TS bindings (which would force ESM/Anchor wiring).
 *
 * Layout (matches the `#[account]` structs in lib.rs):
 *
 *   VaultState (after 8-byte discriminator):
 *     admin            : 32
 *     authority        : 32
 *     token_mint       : 32
 *     share_mint       : 32
 *     vault_id         : u64 (le)
 *     total_deposited  : u64 (le)
 *     strategy_count   : u64 (le)
 *     bump             : u8
 *     share_mint_bump  : u8
 *     paused           : u8 (Phase 2 addition)
 *
 *   StrategyAllocation (after 8-byte discriminator):
 *     vault            : 32
 *     strategy_id      : u64 (le)
 *     delegate         : 32
 *     allocated_amount : u64 (le)
 *     token_account    : 32
 *     is_active        : u8
 *     target_weight_bps: u16 (le)
 *     bump             : u8
 */
export async function readSnapshot(
  connection: Connection,
  ctx: {
    programId: PublicKey;
    tokenMint: PublicKey;
    vaultId: number;
    strategyId: number;
    agent: PublicKey;
  },
  commitment: Commitment = "confirmed"
): Promise<StrategySnapshot> {
  const vaultPda = deriveVaultPda(ctx.programId, ctx.tokenMint, ctx.vaultId);
  const strategyPda = deriveStrategyPda(ctx.programId, vaultPda, ctx.strategyId);
  const strategyTokenPda = deriveStrategyTokenPda(
    ctx.programId,
    vaultPda,
    ctx.strategyId
  );
  const agentAta = getAssociatedTokenAddressSync(ctx.tokenMint, ctx.agent);

  const [vaultInfo, stratInfo, stratTokInfo, agentTokInfo] =
    await connection.getMultipleAccountsInfo(
      [vaultPda, strategyPda, strategyTokenPda, agentAta],
      commitment
    );

  if (!vaultInfo) throw new Error(`Vault state not found at ${vaultPda.toBase58()}`);
  if (!stratInfo) throw new Error(`Strategy not found at ${strategyPda.toBase58()}`);

  // Vault fields
  const v = vaultInfo.data;
  const vaultAdmin = new PublicKey(v.subarray(8, 40));
  const vaultAuthority = new PublicKey(v.subarray(40, 72));
  const totalDeposited = readU64LE(v, 8 + 32 * 4 + 8); // skip 4 pubkeys + vault_id
  // paused is the last byte (after share_mint_bump). Older accounts may not
  // include it — default to false.
  const pausedOffset = 8 + 32 * 4 + 8 * 3 + 1 + 1; // disc + 4 pubkeys + 3 u64 + 2 u8
  const vaultPaused =
    v.length > pausedOffset ? v[pausedOffset] !== 0 : false;

  // Strategy fields
  const s = stratInfo.data;
  const delegate = new PublicKey(s.subarray(8 + 32 + 8, 8 + 32 + 8 + 32));
  const allocatedAmount = readU64LE(s, 8 + 32 + 8 + 32);
  const isActive =
    s[8 + 32 + 8 + 32 + 8 + 32] !== 0; // disc + vault + id + delegate + allocated + token_account
  const targetWeightBpsOffset = 8 + 32 + 8 + 32 + 8 + 32 + 1;
  const targetWeightBps = s.readUInt16LE(targetWeightBpsOffset);

  // Token balances — SPL Token Account: amount at offset 64 (8 bytes LE)
  const strategyTokenBalance = stratTokInfo
    ? readU64LE(stratTokInfo.data, 64)
    : 0n;
  const agentTokenBalance = agentTokInfo
    ? readU64LE(agentTokInfo.data, 64)
    : 0n;

  return {
    vault: vaultPda,
    vaultPaused,
    vaultAdmin,
    vaultAuthority,
    totalDeposited,

    strategy: strategyPda,
    strategyId: ctx.strategyId,
    delegate,
    isActive,
    targetWeightBps,
    allocatedAmount,
    strategyTokenBalance,
    agentTokenBalance,
  };
}

function readU64LE(buf: Uint8Array, offset: number): bigint {
  return new DataView(buf.buffer, buf.byteOffset + offset, 8).getBigUint64(0, true);
}
