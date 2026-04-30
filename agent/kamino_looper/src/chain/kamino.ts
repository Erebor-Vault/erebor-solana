// kamino.ts — On-chain reads + PDA helpers for OLD_Erebor's mock_kamino.
//
// Single-mint reserve model: each Reserve PDA covers one liquidity_mint and
// mints its own cToken (collateral_mint) at a 1:1 ratio that grows with
// simulated yield. There is no oracle and no multi-asset price model — the
// looper agent runs a single-asset (USDC self-loop) leveraged position.
//
// Layouts mirror programs/mock_kamino/src/lib.rs's `Reserve` and `Obligation`
// structs.
//
// PDA seeds (must match mock_kamino):
//   Reserve:           ["reserve", liquidity_mint]
//   CollateralMint:    ["collateral_mint", liquidity_mint]
//   Obligation:        ["obligation", reserve, owner]    (owner = strategy_authority PDA)

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// =============================================================================
// PDA DERIVATION
// =============================================================================

export function deriveKaminoReservePda(
  liquidityMint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), liquidityMint.toBuffer()],
    programId
  );
  return pda;
}

export function deriveKaminoCollateralMintPda(
  liquidityMint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), liquidityMint.toBuffer()],
    programId
  );
  return pda;
}

// Per-(reserve, owner) borrow-tracking PDA. Owner is the account that signs
// borrow/repay against the obligation — for the looper agent, that's the
// strategy_authority[i] PDA.
export function deriveKaminoObligationPda(
  reservePda: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), reservePda.toBuffer(), owner.toBuffer()],
    programId
  );
  return pda;
}

// =============================================================================
// READS — raw byte deserialization
// =============================================================================

export interface ReserveData {
  admin: PublicKey;
  liquidityMint: PublicKey;
  collateralMint: PublicKey;
  liquiditySupply: PublicKey;
  totalLiquidity: number;
  totalCollateralSupply: number;
  totalBorrowed: number;
}

// Reserve layout (after 8-byte Anchor discriminator):
//   bytes   8..40   admin                  (Pubkey, 32)
//   bytes  40..72   liquidity_mint         (Pubkey, 32)
//   bytes  72..104  collateral_mint        (Pubkey, 32)
//   bytes 104..136  liquidity_supply       (Pubkey, 32)
//   bytes 136..144  total_liquidity        (u64 LE)
//   bytes 144..152  total_collateral_supply(u64 LE)
//   bytes 152..160  total_borrowed         (u64 LE)
//   bytes 160..161  bump                   (u8)
//   bytes 161..162  collateral_mint_bump   (u8)
//
// Total size: 8 + 154 = 162 bytes.
export async function fetchReserve(
  connection: Connection,
  liquidityMint: PublicKey,
  programId: PublicKey
): Promise<ReserveData | null> {
  const pda = deriveKaminoReservePda(liquidityMint, programId);
  const info = await connection.getAccountInfo(pda);
  if (!info || info.data.length < 160) return null;
  return {
    admin: new PublicKey(info.data.subarray(8, 40)),
    liquidityMint: new PublicKey(info.data.subarray(40, 72)),
    collateralMint: new PublicKey(info.data.subarray(72, 104)),
    liquiditySupply: new PublicKey(info.data.subarray(104, 136)),
    totalLiquidity: Number(info.data.readBigUInt64LE(136)),
    totalCollateralSupply: Number(info.data.readBigUInt64LE(144)),
    totalBorrowed: Number(info.data.readBigUInt64LE(152)),
  };
}

export interface ObligationData {
  reserve: PublicKey;
  owner: PublicKey;
  borrowedLiquidity: number;
}

// Obligation layout (after 8-byte discriminator):
//   bytes   8..40   reserve            (Pubkey)
//   bytes  40..72   owner              (Pubkey)
//   bytes  72..80   borrowed_liquidity (u64 LE)
//   bytes  80..81   bump               (u8)
//
// Total size: 8 + 73 = 81 bytes.
export async function fetchObligation(
  connection: Connection,
  reservePda: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): Promise<ObligationData | null> {
  const obligationPda = deriveKaminoObligationPda(reservePda, owner, programId);
  const info = await connection.getAccountInfo(obligationPda);
  if (!info || info.data.length < 80) return null;
  return {
    reserve: new PublicKey(info.data.subarray(8, 40)),
    owner: new PublicKey(info.data.subarray(40, 72)),
    borrowedLiquidity: Number(info.data.readBigUInt64LE(72)),
  };
}

// =============================================================================
// CTOKEN HELPERS
// =============================================================================

// Compute the supplied-underlying value implied by a strategy's cToken balance.
// mock_kamino's deposit handler mints cTokens at the rate
//   ctokens = liquidity_amount × ctoken_supply / total_liquidity
// so the inverse — current underlying value — is:
//   liquidity = ctoken_balance × total_liquidity / ctoken_supply
// which grows over time as simulate_yield raises total_liquidity.
//
// Returns 0 when the cToken ATA doesn't exist or the reserve has no supply.
export async function fetchSuppliedLiquidity(
  connection: Connection,
  liquidityMint: PublicKey,
  strategyAuthority: PublicKey,
  programId: PublicKey
): Promise<{ ctokenBalance: number; suppliedLiquidity: number } | null> {
  const reserve = await fetchReserve(connection, liquidityMint, programId);
  if (!reserve) return null;

  const collateralMintPda = deriveKaminoCollateralMintPda(liquidityMint, programId);
  const ctokenAta = getAssociatedTokenAddressSync(
    collateralMintPda,
    strategyAuthority,
    true
  );
  const balanceResult = await connection
    .getTokenAccountBalance(ctokenAta)
    .catch(() => null);
  const ctokenBalance = balanceResult ? Number(balanceResult.value.amount) : 0;

  if (
    ctokenBalance === 0 ||
    reserve.totalCollateralSupply === 0 ||
    reserve.totalLiquidity === 0
  ) {
    return { ctokenBalance, suppliedLiquidity: 0 };
  }

  const suppliedLiquidity = Math.floor(
    (ctokenBalance * reserve.totalLiquidity) / reserve.totalCollateralSupply
  );
  return { ctokenBalance, suppliedLiquidity };
}
