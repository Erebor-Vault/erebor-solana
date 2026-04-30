// kamino.ts — On-chain reads for the mock_kamino program.
//
// Reads obligations, reserves, and the price oracle directly from the
// blockchain using raw byte deserialization (no Anchor IDL dependency on
// mock_kamino — this keeps the agent decoupled from the program's IDL).
//
// PDA seeds (must match mock_kamino):
//   PriceOracle: ["prices"]
//   Reserve:     ["reserve", token_mint]
//   Obligation:  ["obligation", strategy_token_account]
//   Treasury:    ["treasury", token_mint]

import { Connection, PublicKey } from "@solana/web3.js";
import type { ApyData, Asset } from "../strategy/apyScanner.js";
import { bpsToDecimal, microUsdToDollars } from "../utils/math.js";

export interface ObligationData {
  usdcSupplied: number;
  usdcBorrowed: number;
  btcSupplied: number;
  btcBorrowed: number;
  solSupplied: number;
  solBorrowed: number;
}

export interface PriceOracleData {
  usdcPrice: number; // micro-USD per token unit
  btcPrice: number;
  solPrice: number;
}

export interface ReserveData {
  supplyApyBps: number;
  borrowApyBps: number;
  totalSupplied: number;
  totalBorrowed: number;
}

// =============================================================================
// PDA DERIVATION
// =============================================================================

export function deriveKaminoOraclePda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("prices")], programId);
  return pda;
}

export function deriveKaminoReservePda(
  mint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), mint.toBuffer()],
    programId
  );
  return pda;
}

export function deriveKaminoTreasuryPda(
  mint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mint.toBuffer()],
    programId
  );
  return pda;
}

export function deriveKaminoObligationPda(
  strategyTokenAccount: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), strategyTokenAccount.toBuffer()],
    programId
  );
  return pda;
}

// =============================================================================
// READS — raw byte deserialization
// =============================================================================

// PriceOracle layout (after 8-byte Anchor discriminator):
//   bytes 8..40   admin (Pubkey)
//   bytes 40..48  usdc_price (u64 LE)
//   bytes 48..56  btc_price (u64 LE)
//   bytes 56..64  sol_price (u64 LE)
//   bytes 64..65  bump (u8)
export async function fetchPriceOracle(
  connection: Connection,
  programId: PublicKey
): Promise<PriceOracleData | null> {
  const pda = deriveKaminoOraclePda(programId);
  const info = await connection.getAccountInfo(pda);
  if (!info || info.data.length < 65) return null;
  return {
    usdcPrice: Number(info.data.readBigUInt64LE(40)),
    btcPrice: Number(info.data.readBigUInt64LE(48)),
    solPrice: Number(info.data.readBigUInt64LE(56)),
  };
}

// Reserve layout (after 8-byte discriminator):
//   bytes 8..40   mint (Pubkey)
//   bytes 40..72  supply_treasury (Pubkey)
//   bytes 72..74  supply_apy_bps (u16 LE)
//   bytes 74..76  borrow_apy_bps (u16 LE)
//   bytes 76..84  total_supplied (u64 LE)
//   bytes 84..92  total_borrowed (u64 LE)
//   bytes 92..93  bump (u8)
export async function fetchReserve(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey
): Promise<ReserveData | null> {
  const pda = deriveKaminoReservePda(mint, programId);
  const info = await connection.getAccountInfo(pda);
  if (!info || info.data.length < 93) return null;
  return {
    supplyApyBps: info.data.readUInt16LE(72),
    borrowApyBps: info.data.readUInt16LE(74),
    totalSupplied: Number(info.data.readBigUInt64LE(76)),
    totalBorrowed: Number(info.data.readBigUInt64LE(84)),
  };
}

// Obligation layout (after 8-byte discriminator):
//   bytes 8..40   strategy_token_account (Pubkey)
//   bytes 40..48  usdc_supplied (u64 LE)
//   bytes 48..56  usdc_borrowed (u64 LE)
//   bytes 56..64  btc_supplied (u64 LE)
//   bytes 64..72  btc_borrowed (u64 LE)
//   bytes 72..80  sol_supplied (u64 LE)
//   bytes 80..88  sol_borrowed (u64 LE)
//   bytes 88..89  bump (u8)
export async function fetchObligation(
  connection: Connection,
  strategyTokenAccount: PublicKey,
  programId: PublicKey
): Promise<ObligationData | null> {
  const pda = deriveKaminoObligationPda(strategyTokenAccount, programId);
  const info = await connection.getAccountInfo(pda);
  if (!info || info.data.length < 89) return null;
  return {
    usdcSupplied: Number(info.data.readBigUInt64LE(40)),
    usdcBorrowed: Number(info.data.readBigUInt64LE(48)),
    btcSupplied: Number(info.data.readBigUInt64LE(56)),
    btcBorrowed: Number(info.data.readBigUInt64LE(64)),
    solSupplied: Number(info.data.readBigUInt64LE(72)),
    solBorrowed: Number(info.data.readBigUInt64LE(80)),
  };
}

// =============================================================================
// HIGH-LEVEL HELPERS
// =============================================================================

// Fetch all reserves and convert APYs from bps to decimal.
export async function getReserveApys(
  connection: Connection,
  programId: PublicKey,
  mints: { usdc: PublicKey; btc: PublicKey; sol: PublicKey }
): Promise<ApyData[]> {
  const [usdcRes, btcRes, solRes] = await Promise.all([
    fetchReserve(connection, mints.usdc, programId),
    fetchReserve(connection, mints.btc, programId),
    fetchReserve(connection, mints.sol, programId),
  ]);

  const result: ApyData[] = [];
  if (usdcRes) {
    result.push({
      asset: "USDC",
      supplyApy: bpsToDecimal(usdcRes.supplyApyBps),
      borrowApy: bpsToDecimal(usdcRes.borrowApyBps),
    });
  }
  if (btcRes) {
    result.push({
      asset: "BTC",
      supplyApy: bpsToDecimal(btcRes.supplyApyBps),
      borrowApy: bpsToDecimal(btcRes.borrowApyBps),
    });
  }
  if (solRes) {
    result.push({
      asset: "SOL",
      supplyApy: bpsToDecimal(solRes.supplyApyBps),
      borrowApy: bpsToDecimal(solRes.borrowApyBps),
    });
  }
  return result;
}

// Compute USD value of an obligation using the on-chain prices.
export function obligationUsdValues(
  obligation: ObligationData,
  prices: PriceOracleData
): {
  collateralUsd: number;
  debtUsd: number;
  healthFactor: number;
} {
  const collateralMicroUsd =
    obligation.usdcSupplied * prices.usdcPrice +
    obligation.btcSupplied * prices.btcPrice +
    obligation.solSupplied * prices.solPrice;
  const debtMicroUsd =
    obligation.usdcBorrowed * prices.usdcPrice +
    obligation.btcBorrowed * prices.btcPrice +
    obligation.solBorrowed * prices.solPrice;

  const collateralUsd = microUsdToDollars(collateralMicroUsd);
  const debtUsd = microUsdToDollars(debtMicroUsd);
  const healthFactor = debtUsd > 0 ? collateralUsd / debtUsd : Infinity;

  return { collateralUsd, debtUsd, healthFactor };
}
