/**
 * e2e-scenario-allowed-token.ts — Scenario 4
 *
 *   - Create a mock SPL token mint X.
 *   - Add X to the protocol-level AllowedToken list (admin).
 *   - Add X to the vault-level VaultAllowedToken list (admin).
 *   - Create the strategy-authority's ATA for X.
 *   - Register a ValueSource (SplAtaBalance) reading that ATA.
 *   - Mint 100 X tokens (assume X is 6-decimal stable-equivalent for simplicity).
 *   - settle_strategy_value.
 *   - Print pre/post strategy.allocatedAmount + vault.totalDeposited.
 *
 * UI assertion: visit the strategy admin page and verify the value source
 * is listed and the strategy's allocated amount changed by ~100 USDC.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import {
  deriveStrategyPda,
  deriveStrategyAuthorityPda,
  deriveStrategyTokenPda,
} from "../agent/shared/vault-client";

const RPC_URL = process.env.RPC_URL || "http://localhost:8899";
const VAULT_PDA = new PublicKey(process.env.VAULT_PDA!);
const STRATEGY_ID = Number(process.env.STRATEGY_ID || "0");
const E2E_WALLET_PATH = process.env.E2E_WALLET_PATH || "./e2e_wallet.json";
const VAULT_PROGRAM_ID = new PublicKey("FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo");
const VS_INDEX = Number(process.env.VS_INDEX || "0");

function loadWallet(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const e2e = loadWallet(E2E_WALLET_PATH);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(e2e), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;

  const strategyPda = deriveStrategyPda(VAULT_PDA, STRATEGY_ID, VAULT_PROGRAM_ID);
  const strategyAuthority = deriveStrategyAuthorityPda(VAULT_PDA, STRATEGY_ID, VAULT_PROGRAM_ID);
  const strategyTokenPda = deriveStrategyTokenPda(VAULT_PDA, STRATEGY_ID, VAULT_PROGRAM_ID);

  // ── 1. Mint a mock token ──────────────────────────────────────────────
  console.log("1. Creating mock token mint X...");
  const mintX = await createMint(conn, e2e, e2e.publicKey, null, 6);
  console.log("   mint:", mintX.toBase58());

  // ── 2a. Ensure ProtocolConfig exists (governance = E2E wallet) ────────
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId
  );
  if (!(await conn.getAccountInfo(protocolConfig))) {
    console.log("\n2a. Initializing ProtocolConfig...");
    await program.methods
      .initializeProtocolConfig(e2e.publicKey, 100)
      .accountsStrict({
        governance: e2e.publicKey,
        protocolConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   PDA:", protocolConfig.toBase58());
  } else {
    console.log("\n2a. ProtocolConfig already exists.");
  }

  // ── 2b. Add protocol-level AllowedToken ───────────────────────────────
  console.log("\n2b. Adding AllowedToken (protocol-level)...");
  const [allowedToken] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowed_token"), mintX.toBuffer()],
    program.programId
  );
  await program.methods
    .addAllowedToken(mintX)
    .accountsStrict({
      governance: e2e.publicKey,
      protocolConfig,
      allowedToken,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("   PDA:", allowedToken.toBase58());

  // ── 3. Add vault-level VaultAllowedToken ──────────────────────────────
  console.log("\n3. Adding VaultAllowedToken...");
  const [vaultAllowedToken] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_allowed_token"), VAULT_PDA.toBuffer(), mintX.toBuffer()],
    program.programId
  );
  await program.methods
    .addVaultAllowedToken(mintX)
    .accountsStrict({
      admin: e2e.publicKey,
      vaultState: VAULT_PDA,
      allowedToken,
      vaultAllowedToken,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("   PDA:", vaultAllowedToken.toBase58());

  // ── 4. Create strategy_authority's ATA for X ─────────────────────────
  console.log("\n4. Creating strategy_authority ATA for X...");
  const ataX = await getOrCreateAssociatedTokenAccount(conn, e2e, mintX, strategyAuthority, true);
  console.log("   ATA:", ataX.address.toBase58());

  // ── 5. Register a ValueSource (SplAtaBalance) ─────────────────────────
  console.log("\n5. Adding ValueSource at index", VS_INDEX, "...");
  const [vsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("value_source"), strategyPda.toBuffer(), Uint8Array.of(VS_INDEX)],
    program.programId
  );
  await program.methods
    .addValueSource(
      new BN(STRATEGY_ID),
      VS_INDEX,
      0,                          // kind = 0 (SplAtaBalance)
      ataX.address,               // target_account
      new BN(0),                  // offset (ignored for kind 0)
      new BN(1),                  // scale_num
      new BN(1),                  // scale_den
      null,                       // mint_balance_source_index (Pyth-only)
      null,                       // max_staleness_secs (Pyth-only)
    )
    .accountsStrict({
      admin: e2e.publicKey,
      vaultState: VAULT_PDA,
      strategy: strategyPda,
      valueSource: vsPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("   PDA:", vsPda.toBase58());

  // ── Pre-state ─────────────────────────────────────────────────────────
  const s0 = await program.account.strategyAllocation.fetch(strategyPda);
  const v0 = await program.account.vaultState.fetch(VAULT_PDA);
  console.log("\n=== Pre-mint state ===");
  console.log("strategy.allocatedAmount:", Number(s0.allocatedAmount));
  console.log("strategy.computedValue:", Number((s0 as any).computedValue ?? 0));
  console.log("vault.totalDeposited:", Number(v0.totalDeposited));

  // ── 6. Mint 100 X tokens to strategy authority's X ATA ───────────────
  console.log("\n6. Minting 100 X to strategy_authority's ATA...");
  await mintTo(conn, e2e, mintX, ataX.address, e2e, 100_000_000);
  const xBal = (await conn.getTokenAccountBalance(ataX.address)).value.uiAmount;
  console.log("   ATA X balance:", xBal);

  // ── 7. Settle ─────────────────────────────────────────────────────────
  console.log("\n7. Calling settle_strategy_value...");
  // Walk all value sources for this strategy (could be more than just our new one)
  const remaining: any[] = [];
  for (let i = 0; i < 8; i++) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), strategyPda.toBuffer(), Uint8Array.of(i)],
      program.programId
    );
    const info = await conn.getAccountInfo(pda);
    if (!info) continue;
    const acc = (await program.account.valueSource.fetch(pda)) as any;
    remaining.push({ pubkey: pda, isSigner: false, isWritable: true });
    remaining.push({ pubkey: acc.targetAccount as PublicKey, isSigner: false, isWritable: false });
  }
  await program.methods
    .settleStrategyValue(new BN(STRATEGY_ID))
    .accountsStrict({
      authority: e2e.publicKey,
      vaultState: VAULT_PDA,
      strategy: strategyPda,
      strategyTokenAccount: strategyTokenPda,
    })
    .remainingAccounts(remaining)
    .signers([e2e])
    .rpc();

  // ── Post-state ────────────────────────────────────────────────────────
  const s1 = await program.account.strategyAllocation.fetch(strategyPda);
  const v1 = await program.account.vaultState.fetch(VAULT_PDA);
  console.log("\n=== Post-settle state ===");
  console.log("strategy.allocatedAmount:", Number(s1.allocatedAmount));
  console.log("strategy.computedValue:", Number((s1 as any).computedValue ?? 0));
  console.log("vault.totalDeposited:", Number(v1.totalDeposited));

  console.log("\nMint X for UI assertion:", mintX.toBase58());
}

main().catch((e) => { console.error(e); process.exit(1); });
