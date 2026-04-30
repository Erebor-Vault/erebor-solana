/**
 * read-kamino-position.ts — Read the kamino_looper strategy's on-chain state.
 *
 * Prints:
 *   - cToken ATA balance (collateral the strategy holds)
 *   - Reserve totals (total_liquidity, total_collateral_supply, total_borrowed)
 *   - Implied supplied liquidity = ctoken_balance × total_liquidity / total_collateral_supply
 *   - Obligation borrowed_liquidity (debt against this collateral)
 *   - Implied health factor = supplied / borrowed
 *
 * mock_kamino on OLD_Erebor doesn't have a ProtocolPosition account — the
 * value of the position is derived from the cToken redemption rate at read
 * time, which grows as simulate_yield runs against the reserve.
 *
 * Usage:
 *   bun scripts/read-kamino-position.ts --mint <USDC> --strategy-id 1
 */

import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

// =============================================================================
// CONFIG
// =============================================================================

// Read program IDs from target/idl after `anchor build`. If the file isn't
// present, fall back to the source declare_id! values; step 7 will sync these
// after redeploy.
function readProgramId(idlPath: string, fallback: string): PublicKey {
  try {
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    return new PublicKey(idl.address);
  } catch {
    return new PublicKey(fallback);
  }
}

const VAULT_PROGRAM_ID = readProgramId(
  "./target/idl/my_project.json",
  "B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z"
);
const KAMINO_PROGRAM_ID = readProgramId(
  "./target/idl/mock_kamino.json",
  "S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK"
);

// =============================================================================
// CLI
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let mint = "";
  let vaultId = 0;
  let strategyId = 0;
  let rpcUrl = "https://api.devnet.solana.com";
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mint":        mint = args[++i]; break;
      case "--vault-id":    vaultId = Number(args[++i]); break;
      case "--strategy-id": strategyId = Number(args[++i]); break;
      case "--rpc":         rpcUrl = args[++i]; break;
    }
  }
  if (!mint) {
    console.error("--mint required");
    process.exit(1);
  }
  return { mint, vaultId, strategyId, rpcUrl };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const { mint, vaultId, strategyId, rpcUrl } = parseArgs();
  const connection = new Connection(rpcUrl, "confirmed");
  const mintPk = new PublicKey(mint);

  // ── Vault + strategy PDAs ─────────────────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mintPk.toBuffer(), new BN(vaultId).toArrayLike(Buffer, "le", 8)],
    VAULT_PROGRAM_ID
  );
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    VAULT_PROGRAM_ID
  );
  const [strategyAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), vaultPda.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    VAULT_PROGRAM_ID
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    VAULT_PROGRAM_ID
  );

  // ── Kamino PDAs ───────────────────────────────────────────────────────
  const [reservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), mintPk.toBuffer()],
    KAMINO_PROGRAM_ID
  );
  const [collateralMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), mintPk.toBuffer()],
    KAMINO_PROGRAM_ID
  );
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), reservePda.toBuffer(), strategyAuthorityPda.toBuffer()],
    KAMINO_PROGRAM_ID
  );
  // Strategy's cToken ATA — owned by strategy_authority because that's what
  // signs every mock_kamino deposit/borrow/repay/withdraw inside execute_action.
  const strategyCtokenAta = await getAtaAddress(collateralMintPda, strategyAuthorityPda);

  console.log(`\nVault PDA:          ${vaultPda.toBase58()}`);
  console.log(`Strategy PDA:       ${strategyPda.toBase58()}`);
  console.log(`Strategy Authority: ${strategyAuthorityPda.toBase58()}`);
  console.log(`Strategy Token ATA: ${strategyTokenPda.toBase58()}`);
  console.log(`Reserve PDA:        ${reservePda.toBase58()}`);
  console.log(`Collateral Mint:    ${collateralMintPda.toBase58()}`);
  console.log(`cToken ATA:         ${strategyCtokenAta.toBase58()}`);
  console.log(`Obligation PDA:     ${obligationPda.toBase58()}\n`);

  // ── Fetch state ───────────────────────────────────────────────────────
  const [reserveInfo, obligationInfo, ctokenInfo, idleInfo] = await Promise.all([
    connection.getAccountInfo(reservePda),
    connection.getAccountInfo(obligationPda),
    connection.getAccountInfo(strategyCtokenAta),
    connection.getAccountInfo(strategyTokenPda),
  ]);

  if (!reserveInfo) {
    console.log("Reserve NOT initialized. Run setup-kamino-strategy.ts first.");
    return;
  }

  // Reserve layout (after 8-byte Anchor disc):
  //   admin(32) liquidity_mint(32) collateral_mint(32) liquidity_supply(32)
  //   total_liquidity(8) total_collateral_supply(8) total_borrowed(8) bumps(2)
  const totalLiquidity = new BN(reserveInfo.data.subarray(8 + 128, 8 + 136), "le");
  const totalCollateralSupply = new BN(reserveInfo.data.subarray(8 + 136, 8 + 144), "le");
  const totalBorrowed = new BN(reserveInfo.data.subarray(8 + 144, 8 + 152), "le");

  console.log("Reserve:");
  console.log(`  total_liquidity:         ${totalLiquidity.toString()} (${(Number(totalLiquidity) / 1e6).toFixed(4)} USDC)`);
  console.log(`  total_collateral_supply: ${totalCollateralSupply.toString()}`);
  console.log(`  total_borrowed:          ${totalBorrowed.toString()} (${(Number(totalBorrowed) / 1e6).toFixed(4)} USDC)`);
  if (!totalCollateralSupply.isZero()) {
    const rate = Number(totalLiquidity) / Number(totalCollateralSupply);
    console.log(`  redemption_rate:         ${rate.toFixed(6)} liquidity per cToken`);
  }
  console.log();

  // SPL token account: amount at offset 64..72 (both classic + Token-2022).
  const ctokenBalance = ctokenInfo && ctokenInfo.data.length >= 72
    ? new BN(ctokenInfo.data.subarray(64, 72), "le")
    : new BN(0);
  const idleBalance = idleInfo && idleInfo.data.length >= 72
    ? new BN(idleInfo.data.subarray(64, 72), "le")
    : new BN(0);

  // Obligation layout (after 8-byte disc):
  //   reserve(32) owner(32) borrowed_liquidity(8) bump(1)
  let borrowedLiquidity = new BN(0);
  if (obligationInfo && obligationInfo.data.length >= 80) {
    borrowedLiquidity = new BN(obligationInfo.data.subarray(8 + 64, 8 + 72), "le");
  }

  // Implied supplied = ctoken × redemption_rate.
  const suppliedLiquidity = totalCollateralSupply.isZero()
    ? new BN(0)
    : ctokenBalance.mul(totalLiquidity).div(totalCollateralSupply);

  console.log("Strategy position:");
  console.log(`  idle (strategy ATA):  ${idleBalance.toString()} (${(Number(idleBalance) / 1e6).toFixed(4)} USDC)`);
  console.log(`  cToken balance:       ${ctokenBalance.toString()}`);
  console.log(`  supplied (implied):   ${suppliedLiquidity.toString()} (${(Number(suppliedLiquidity) / 1e6).toFixed(4)} USDC)`);
  console.log(`  borrowed:             ${borrowedLiquidity.toString()} (${(Number(borrowedLiquidity) / 1e6).toFixed(4)} USDC)`);

  if (!borrowedLiquidity.isZero()) {
    const hf = Number(suppliedLiquidity) / Number(borrowedLiquidity);
    console.log(`  health_factor:        ${hf.toFixed(4)}`);
  } else if (!suppliedLiquidity.isZero()) {
    console.log(`  health_factor:        ∞ (no debt)`);
  }

  const totalValue = idleBalance.add(suppliedLiquidity).sub(borrowedLiquidity);
  console.log(`\n  total_value_usdc:     ${totalValue.toString()} (${(Number(totalValue) / 1e6).toFixed(4)} USDC)\n`);
}

// Compute an SPL ATA address without a network call. The address is just
// `find_program_address([owner, token_program, mint], ASSOCIATED_TOKEN_PROGRAM)`.
async function getAtaAddress(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

main().catch((e) => {
  console.error("Failed:", e.message || e);
  if (e.logs) console.error(e.logs);
  process.exit(1);
});
