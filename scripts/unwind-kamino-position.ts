/**
 * unwind-kamino-position.ts — Force-close a kamino_looper strategy's position.
 *
 * Use this when a strategy has stranded funds in mock_kamino (e.g. an open_loop
 * partially executed and left collateral with no leverage). The script calls
 * the same execute_strategy_action sequence the agent would call internally,
 * signed by the agent's delegate keypair.
 *
 * Sequence:
 *   - If borrowed > 0: withdraw(borrowed), repay(borrowed), withdraw(remaining)
 *   - If borrowed == 0: withdraw(supplied)
 *
 * Usage:
 *   bunx ts-node scripts/unwind-kamino-position.ts \
 *     --delegate ./agent_keypair.json \
 *     --mint <USDC_MINT_ADDRESS> \
 *     --strategy-id 1
 *
 * The default --strategy-id is 1 because the kamino strategy is created as the
 * second strategy of the shared vault (Lulo is at slot 0).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import { createHash } from "crypto";

// Asset code for USDC (must match mock_kamino enum order)
const ASSET_USDC = 0;

// -------------------------------------------------------------------
// CLI parsing
// -------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let delegatePath = "";
  let mintAddress = "";
  let vaultId = 0;
  let strategyId = 1;
  let rpcUrl = "https://api.devnet.solana.com";
  let walletPath = "./id.json";
  let kaminoProgramId = "S4taBhfvbCEKkGYvD9ESwiEEKHgnZmCusLXE47vzhoK";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--delegate":     delegatePath = args[++i]; break;
      case "--mint":         mintAddress = args[++i]; break;
      case "--vault-id":     vaultId = Number(args[++i]); break;
      case "--strategy-id":  strategyId = Number(args[++i]); break;
      case "--rpc":          rpcUrl = args[++i]; break;
      case "--wallet":       walletPath = args[++i]; break;
      case "--kamino":       kaminoProgramId = args[++i]; break;
    }
  }

  if (!delegatePath || !mintAddress) {
    console.error("Error: --delegate and --mint are required");
    console.error("Usage: bunx ts-node scripts/unwind-kamino-position.ts --delegate ./agent_keypair.json --mint <USDC>");
    process.exit(1);
  }

  return { delegatePath, mintAddress, vaultId, strategyId, rpcUrl, walletPath, kaminoProgramId };
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(name: string): number[] {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Array.from(hash.subarray(0, 8));
}

// Build instruction data for a kamino op: [8 disc][1 asset][8 amount LE]
function buildKaminoData(disc: number[], asset: number, amount: number): Buffer {
  const buf = Buffer.alloc(17);
  Buffer.from(disc).copy(buf, 0);
  buf.writeUInt8(asset, 8);
  new BN(amount).toArrayLike(Buffer, "le", 8).copy(buf, 9);
  return buf;
}

// -------------------------------------------------------------------
// Read obligation from mock_kamino (raw bytes, no IDL dependency)
// -------------------------------------------------------------------
async function readObligation(
  connection: Connection,
  strategyTokenPda: PublicKey,
  kaminoProgramId: PublicKey
): Promise<{ supplied: number; borrowed: number } | null> {
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), strategyTokenPda.toBuffer()],
    kaminoProgramId
  );
  const info = await connection.getAccountInfo(obligationPda);
  if (!info || info.data.length < 89) return null;
  return {
    supplied: Number(info.data.readBigUInt64LE(40)),
    borrowed: Number(info.data.readBigUInt64LE(48)),
  };
}

// -------------------------------------------------------------------
// Find the AllowedAction PDA matching a kamino discriminator on this strategy
// -------------------------------------------------------------------
async function findAllowedAction(
  vaultProgram: Program<MyProject>,
  strategyPda: PublicKey,
  actionCount: number,
  kaminoProgramId: PublicKey,
  discriminator: number[]
): Promise<PublicKey | null> {
  for (let i = 0; i < actionCount; i++) {
    const [actionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_action"),
        strategyPda.toBuffer(),
        new BN(i).toArrayLike(Buffer, "le", 2),
      ],
      vaultProgram.programId
    );
    try {
      const acct = (await vaultProgram.account.allowedAction.fetch(actionPda)) as any;
      if (
        acct.targetProgram.equals(kaminoProgramId) &&
        Buffer.from(acct.discriminator).equals(Buffer.from(discriminator)) &&
        acct.isActive
      ) {
        return actionPda;
      }
    } catch {
      // skip if fetch fails
    }
  }
  return null;
}

// -------------------------------------------------------------------
// Submit one execute_strategy_action call (deposit/withdraw/borrow/repay)
// Post-adapter layout: mint, user_token, treasury, reserve, obligation,
//                      oracle, position, user_authority, token_program
// -------------------------------------------------------------------
async function executeKaminoAction(
  vaultProgram: Program<MyProject>,
  delegate: Keypair,
  vaultPda: PublicKey,
  strategyPda: PublicKey,
  strategyTokenPda: PublicKey,
  allowedActionPda: PublicKey,
  kaminoProgramId: PublicKey,
  mint: PublicKey,
  discriminator: number[],
  amount: number
): Promise<string> {
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mint.toBuffer()],
    kaminoProgramId
  );
  const [reservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), mint.toBuffer()],
    kaminoProgramId
  );
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), strategyTokenPda.toBuffer()],
    kaminoProgramId
  );
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("prices")],
    kaminoProgramId
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), strategyTokenPda.toBuffer()],
    kaminoProgramId
  );

  const remainingAccounts: any[] = [
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: strategyTokenPda, isSigner: false, isWritable: true },
    { pubkey: treasuryPda, isSigner: false, isWritable: true },
    { pubkey: reservePda, isSigner: false, isWritable: true },
    { pubkey: obligationPda, isSigner: false, isWritable: true },
    { pubkey: oraclePda, isSigner: false, isWritable: false },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = buildKaminoData(discriminator, ASSET_USDC, amount);

  return vaultProgram.methods
    .executeStrategyAction(data)
    .accountsStrict({
      caller: delegate.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      allowedAction: allowedActionPda,
      targetProgram: kaminoProgramId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([delegate])
    .rpc();
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  const connection = new anchor.web3.Connection(opts.rpcUrl, "confirmed");
  const payer = loadKeypair(opts.walletPath);
  const delegate = loadKeypair(opts.delegatePath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const vaultProgram = anchor.workspace.myProject as Program<MyProject>;
  const mint = new PublicKey(opts.mintAddress);
  const kaminoProgramId = new PublicKey(opts.kaminoProgramId);

  console.log("\n=== Kamino Position Unwind ===\n");
  console.log(`Delegate:   ${delegate.publicKey.toBase58()}`);
  console.log(`Vault prog: ${vaultProgram.programId.toBase58()}`);
  console.log(`Kamino:     ${kaminoProgramId.toBase58()}`);
  console.log(`Mint:       ${mint.toBase58()}`);
  console.log(`Vault ID:   ${opts.vaultId}`);
  console.log(`Strategy:   ${opts.strategyId}\n`);

  // Derive PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer(), new BN(opts.vaultId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );
  const [strategyTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_token"), vaultPda.toBuffer(), new BN(opts.strategyId).toArrayLike(Buffer, "le", 8)],
    vaultProgram.programId
  );

  console.log(`Vault PDA:        ${vaultPda.toBase58()}`);
  console.log(`Strategy PDA:     ${strategyPda.toBase58()}`);
  console.log(`Strategy Token:   ${strategyTokenPda.toBase58()}\n`);

  // Read current obligation
  const obligation = await readObligation(connection, strategyTokenPda, kaminoProgramId);
  if (!obligation) {
    console.log("No obligation found — nothing to unwind.");
    return;
  }

  console.log(
    `Current state: supplied=${(obligation.supplied / 1e6).toFixed(2)} USDC, borrowed=${(obligation.borrowed / 1e6).toFixed(2)} USDC`
  );

  if (obligation.supplied === 0 && obligation.borrowed === 0) {
    console.log("Position is already empty. Nothing to do.");
    return;
  }

  // Look up allowed actions on this strategy
  const strategy = (await vaultProgram.account.strategyAllocation.fetch(strategyPda)) as any;
  const actionCount = strategy.actionCount;
  console.log(`Strategy has ${actionCount} whitelisted actions\n`);

  const withdrawDisc = anchorDiscriminator("withdraw");
  const repayDisc = anchorDiscriminator("repay");

  const withdrawAction = await findAllowedAction(vaultProgram, strategyPda, actionCount, kaminoProgramId, withdrawDisc);
  if (!withdrawAction) throw new Error("No active withdraw AllowedAction found on this strategy");

  let repayAction: PublicKey | null = null;
  if (obligation.borrowed > 0) {
    repayAction = await findAllowedAction(vaultProgram, strategyPda, actionCount, kaminoProgramId, repayDisc);
    if (!repayAction) throw new Error("No active repay AllowedAction found on this strategy");
  }

  // ── Unwind sequence ──────────────────────────────────────────────────
  if (obligation.borrowed > 0) {
    // Step 1: withdraw enough collateral to repay debt
    console.log(`1. Withdrawing ${(obligation.borrowed / 1e6).toFixed(2)} USDC to repay debt...`);
    const sig1 = await executeKaminoAction(
      vaultProgram, delegate, vaultPda, strategyPda, strategyTokenPda,
      withdrawAction, kaminoProgramId, mint, withdrawDisc, obligation.borrowed
    );
    console.log(`   tx: ${sig1}`);

    // Step 2: repay debt
    console.log(`2. Repaying ${(obligation.borrowed / 1e6).toFixed(2)} USDC...`);
    const sig2 = await executeKaminoAction(
      vaultProgram, delegate, vaultPda, strategyPda, strategyTokenPda,
      repayAction!, kaminoProgramId, mint, repayDisc, obligation.borrowed
    );
    console.log(`   tx: ${sig2}`);
  }

  // Step 3: withdraw remaining collateral
  const remaining = obligation.supplied - obligation.borrowed;
  if (remaining > 0) {
    console.log(`3. Withdrawing remaining ${(remaining / 1e6).toFixed(2)} USDC...`);
    const sig3 = await executeKaminoAction(
      vaultProgram, delegate, vaultPda, strategyPda, strategyTokenPda,
      withdrawAction, kaminoProgramId, mint, withdrawDisc, remaining
    );
    console.log(`   tx: ${sig3}`);
  }

  // Verify
  const after = await readObligation(connection, strategyTokenPda, kaminoProgramId);
  console.log("\n=== Done ===");
  console.log(
    `New state: supplied=${((after?.supplied || 0) / 1e6).toFixed(2)} USDC, borrowed=${((after?.borrowed || 0) / 1e6).toFixed(2)} USDC`
  );
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.logs) console.error(err.logs);
  process.exit(1);
});
