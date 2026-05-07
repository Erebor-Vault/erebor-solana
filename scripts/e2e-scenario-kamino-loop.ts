/**
 * e2e-scenario-kamino-loop.ts
 *
 * Drives Scenarios 1 + 2 against an existing Kamino-Looper-configured strategy:
 *   1. Admin (= delegate = E2E wallet) executes deposit_reserve_liquidity_…
 *   2. Borrow obligation_liquidity
 *   3. Settle strategy value sources (so on-chain NAV picks up cToken + debt)
 *   4. Repay obligation_liquidity
 *   5. Withdraw obligation_collateral_and_redeem_reserve_collateral
 *   6. User-side vault.withdraw via the same wallet
 *
 * Reads required addresses from env:
 *   RPC_URL, MINT, VAULT_PDA, STRATEGY_ID, KAMINO_PROGRAM_ID
 *
 * Wallet is loaded from E2E_WALLET_PATH (default ./e2e_wallet.json).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyProject } from "../target/types/my_project";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import {
  kaminoDeposit,
  kaminoBorrow,
  kaminoRepay,
  kaminoWithdraw,
  type KaminoActionContext,
} from "../agent/kamino_looper/src/chain/vault";
import {
  deriveVaultPda,
  deriveVaultAuthorityPda,
  deriveStrategyPda,
  deriveStrategyAuthorityPda,
  deriveStrategyTokenPda,
} from "../agent/shared/vault-client";

const RPC_URL = process.env.RPC_URL || "http://localhost:8899";
const MINT = new PublicKey(process.env.MINT!);
const VAULT_PDA = new PublicKey(process.env.VAULT_PDA!);
const STRATEGY_ID = Number(process.env.STRATEGY_ID || "0");
const KAMINO_PROGRAM_ID = new PublicKey(process.env.KAMINO_PROGRAM_ID!);
const E2E_WALLET_PATH = process.env.E2E_WALLET_PATH || "./e2e_wallet.json";
const VAULT_PROGRAM_ID = new PublicKey("FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo");

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

  // anti-theft snapshot points: caller and delegate ATAs (same here).
  const callerAta = getAssociatedTokenAddressSync(MINT, e2e.publicKey);

  const ctx: KaminoActionContext = {
    vaultProgram: program as any,
    agentKeypair: e2e,
    vaultPda: VAULT_PDA,
    strategyPda,
    strategyTokenPda,
    strategyAuthorityPda: strategyAuthority,
    vaultProgramId: VAULT_PROGRAM_ID,
    kaminoProgramId: KAMINO_PROGRAM_ID,
    liquidityMint: MINT,
    strategyId: STRATEGY_ID,
    callerTokenAta: callerAta,
    delegateTokenAta: callerAta,
  };

  async function strategyBal(): Promise<number> {
    const info = await conn.getTokenAccountBalance(strategyTokenPda).catch(() => null);
    return info ? Number(info.value.amount) : 0;
  }
  async function strategyAccount() {
    return await program.account.strategyAllocation.fetch(strategyPda);
  }
  async function vaultAccount() {
    return await program.account.vaultState.fetch(VAULT_PDA);
  }

  console.log("\n=== Pre-state ===");
  console.log("strategy ATA underlying:", await strategyBal());
  const s0 = await strategyAccount();
  console.log("strategy.allocatedAmount:", Number(s0.allocatedAmount));
  console.log("strategy.computedValue:", Number((s0 as any).computedValue ?? 0));
  console.log("vault.totalDeposited:", Number((await vaultAccount()).totalDeposited));

  // -------------------------------------------------------------------
  // 1. Kamino deposit (push 50 USDC to reserve, mint cTokens)
  // -------------------------------------------------------------------
  const startBal = await strategyBal();
  console.log("\n=== 1. kamino deposit (50 USDC) ===");
  const sig1 = await kaminoDeposit(ctx, 50_000_000);
  console.log("  sig:", sig1);
  console.log("  strategy ATA underlying:", await strategyBal(), "(was", startBal, ")");

  // -------------------------------------------------------------------
  // 2. Kamino borrow (20 USDC against the deposit)
  // -------------------------------------------------------------------
  console.log("\n=== 2. kamino borrow (20 USDC) ===");
  const sig2 = await kaminoBorrow(ctx, 20_000_000);
  console.log("  sig:", sig2);
  console.log("  strategy ATA underlying:", await strategyBal(), "(should be ≈ 20)");

  // -------------------------------------------------------------------
  // 3. Settle value sources — on-chain NAV reflects cToken + debt.
  // -------------------------------------------------------------------
  console.log("\n=== 3. settle_strategy_value ===");
  // The strategy already had value sources written by the preset / setup.
  // settle_strategy_value walks them, computes computed_value, books delta.
  const strategy = await strategyAccount();
  // Find all value source PDAs for this strategy
  const sig3 = await program.methods
    .settleStrategyValue(new BN(STRATEGY_ID))
    .accountsStrict({
      authority: e2e.publicKey,
      vaultState: VAULT_PDA,
      strategy: strategyPda,
      strategyTokenAccount: strategyTokenPda,
    })
    .remainingAccounts(await collectValueSources(program, strategyPda))
    .signers([e2e])
    .rpc();
  console.log("  sig:", sig3);
  const s1 = await strategyAccount();
  console.log("  strategy.allocatedAmount:", Number(s1.allocatedAmount));
  console.log("  strategy.computedValue:", Number((s1 as any).computedValue ?? 0));
  console.log("  vault.totalDeposited:", Number((await vaultAccount()).totalDeposited));

  // -------------------------------------------------------------------
  // 4. Repay (burn the 20 borrowed USDC from strategy ATA)
  // -------------------------------------------------------------------
  console.log("\n=== 4. kamino repay (20 USDC) ===");
  const sig4 = await kaminoRepay(ctx, 20_000_000);
  console.log("  sig:", sig4);
  console.log("  strategy ATA underlying:", await strategyBal(), "(should be ≈ 0)");

  // -------------------------------------------------------------------
  // 5. Withdraw (burn 50 cTokens, get USDC back)
  // -------------------------------------------------------------------
  console.log("\n=== 5. kamino withdraw (50 cTokens) ===");
  const sig5 = await kaminoWithdraw(ctx, 50_000_000);
  console.log("  sig:", sig5);
  console.log("  strategy ATA underlying:", await strategyBal(), "(should be ≈ 50)");

  // -------------------------------------------------------------------
  // 6. Settle again to clear NAV
  // -------------------------------------------------------------------
  console.log("\n=== 6. settle_strategy_value (post-unwind) ===");
  await program.methods
    .settleStrategyValue(new BN(STRATEGY_ID))
    .accountsStrict({
      authority: e2e.publicKey,
      vaultState: VAULT_PDA,
      strategy: strategyPda,
      strategyTokenAccount: strategyTokenPda,
    })
    .remainingAccounts(await collectValueSources(program, strategyPda))
    .signers([e2e])
    .rpc();
  const s2 = await strategyAccount();
  console.log("  strategy.allocatedAmount:", Number(s2.allocatedAmount));
  console.log("  strategy.computedValue:", Number((s2 as any).computedValue ?? 0));

  console.log("\n=== Scenario 1+2 complete ===");
}

/**
 * Walk all `ValueSourceConfig` PDAs registered for a strategy and return them
 * (plus their target accounts) as `remaining_accounts`. Each entry takes 2 slots:
 * the value-source PDA itself, then the target account it reads.
 */
async function collectValueSources(
  program: Program<MyProject>,
  strategyPda: PublicKey
) {
  // Scan up to MAX_VALUE_SOURCES_PER_STRATEGY indices looking for existing PDAs.
  const out: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  for (let i = 0; i < 8; i++) {
    const [vsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), strategyPda.toBuffer(), Uint8Array.of(i)],
      program.programId
    );
    const info = await program.provider.connection.getAccountInfo(vsPda);
    if (!info) continue;
    const account = (await program.account.valueSource.fetch(vsPda)) as any;
    out.push({ pubkey: vsPda, isSigner: false, isWritable: true });
    out.push({ pubkey: account.targetAccount as PublicKey, isSigner: false, isWritable: false });
  }
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
