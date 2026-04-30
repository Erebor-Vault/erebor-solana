// Read and print the mock_kamino ProtocolPosition PDA for a given strategy.
// Useful for verifying the adapter is in sync with the obligation.

import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const RPC = "https://api.devnet.solana.com";
const VAULT_PROGRAM_ID = new PublicKey("B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z");
const KAMINO_PROGRAM_ID = new PublicKey("S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK");

function parseArgs() {
  const args = process.argv.slice(2);
  let mint = "";
  let vaultId = 0;
  let strategyId = 0;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mint":        mint = args[++i]; break;
      case "--vault-id":    vaultId = Number(args[++i]); break;
      case "--strategy-id": strategyId = Number(args[++i]); break;
    }
  }
  if (!mint) { console.error("--mint required"); process.exit(1); }
  return { mint, vaultId, strategyId };
}

async function main() {
  const { mint, vaultId, strategyId } = parseArgs();
  const connection = new Connection(RPC, "confirmed");

  const mintPk = new PublicKey(mint);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mintPk.toBuffer(), new BN(vaultId).toArrayLike(Buffer, "le", 8)],
    VAULT_PROGRAM_ID
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(strategyId).toArrayLike(Buffer, "le", 8)],
    VAULT_PROGRAM_ID
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    KAMINO_PROGRAM_ID
  );
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), strategyTokenPda.toBuffer()],
    KAMINO_PROGRAM_ID
  );

  console.log(`Strategy #${strategyId} token: ${strategyTokenPda.toBase58()}`);
  console.log(`ProtocolPosition PDA: ${positionPda.toBase58()}`);
  console.log(`Obligation PDA:       ${obligationPda.toBase58()}\n`);

  const posInfo = await connection.getAccountInfo(positionPda);
  if (!posInfo) { console.log("ProtocolPosition NOT initialized"); return; }
  const posStrategyToken = new PublicKey(posInfo.data.slice(8, 40));
  const posDeposited = Number(posInfo.data.readBigUInt64LE(40));
  console.log("ProtocolPosition:");
  console.log(`  strategy_token_account: ${posStrategyToken.toBase58()}`);
  console.log(`  deposited_amount:       ${posDeposited} (${(posDeposited / 1e6).toFixed(4)} USDC)`);

  const obInfo = await connection.getAccountInfo(obligationPda);
  if (!obInfo) { console.log("\nObligation NOT initialized"); return; }
  const usdcSupplied = Number(obInfo.data.readBigUInt64LE(40));
  const usdcBorrowed = Number(obInfo.data.readBigUInt64LE(48));
  console.log("\nObligation:");
  console.log(`  usdc_supplied: ${usdcSupplied} (${(usdcSupplied / 1e6).toFixed(4)} USDC)`);
  console.log(`  usdc_borrowed: ${usdcBorrowed} (${(usdcBorrowed / 1e6).toFixed(4)} USDC)`);
  console.log(`  net value:     ${usdcSupplied - usdcBorrowed} (${((usdcSupplied - usdcBorrowed) / 1e6).toFixed(4)} USDC)`);

  const match = posDeposited === usdcSupplied - usdcBorrowed ? "MATCH" : "MISMATCH";
  console.log(`\nSync check: ${match}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
