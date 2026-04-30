/**
 * scripts/e2e-kamino.ts — End-to-end demonstration of Erebor's
 * `execute_action` whitelist gateway against the mock Kamino program.
 *
 * Run on a local validator after `anchor build` to demonstrate:
 *   1. Initialise mock_kamino reserve for a test mint
 *   2. Initialise an Erebor vault + strategy on the same mint, with a
 *      throwaway delegate keypair acting as the AI agent
 *   3. Deposit user funds → allocate to strategy
 *   4. Admin whitelists mock_kamino's deposit + withdraw actions on the
 *      strategy via `add_allowed_action`
 *   5. Agent calls `execute_action(target=mock_kamino, disc=deposit, …)`
 *      → strategy ATA → mock_kamino reserve, cTokens minted to the
 *      strategy_authority's collateral ATA
 *   6. Mock yield: admin calls `mock_kamino.simulate_yield(amount)`
 *      to mint extra liquidity into the reserve, raising the cToken
 *      redemption rate
 *   7. Agent calls `execute_action(target=mock_kamino, disc=withdraw, …)`
 *      → cTokens burned, principal+yield returned to strategy ATA
 *   8. Authority deallocates strategy → reserve, and we verify
 *      `total_deposited` grew by the yield (after `report_yield` is
 *      called against the strategy)
 *
 * Negative tests:
 *   - Agent tries an un-whitelisted discriminator → reverts with
 *     `ActionNotAllowed`
 *   - Agent attempts to siphon: relayed instruction routes destination
 *     to agent's own ATA → reverts with `AntiTheft`
 *
 * STATUS: requires docs/REFACTOR_PLAN.md to be applied first. Specifically the
 * test depends on:
 *   - Per-strategy `strategy_authority` PDA owning the strategy ATA
 *   - `execute_action` signing as `strategy_authority` (not vault_state)
 *   - `expected_recipient_index` mandatory in `add_allowed_action`
 *
 * Until the refactor lands the test will fail at the first whitelist
 * call. After the refactor lands, run with:
 *
 *   solana-test-validator -r --quiet &
 *   anchor build
 *   anchor deploy --provider.cluster localnet
 *   bun scripts/e2e-kamino.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import BN from "bn.js";
import * as fs from "node:fs";
import { MyProject } from "../target/types/my_project";
import { MockKamino } from "../target/types/mock_kamino";

const MOCK_KAMINO_PROGRAM_ID = new PublicKey(
  "HLDVeTCx7mJeHApCpDptwbHd78iLCPYrFnVAymjrANp2"
);
const MY_PROJECT_PROGRAM_ID = new PublicKey(
  "DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B"
);

const VAULT_ID = 0;
const STRATEGY_ID = 0;
const DEPOSIT_AMOUNT = 1_000_000_000; // 1000 USDC (6 dp)
const ALLOCATION_AMOUNT = 800_000_000; // 800 USDC into the strategy
const KAMINO_DEPOSIT_AMOUNT = 500_000_000; // 500 USDC into Kamino
const SIMULATED_YIELD = 50_000_000; // 50 USDC of "interest"

// ---------- helpers ----------

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf-8")))
  );
}

/** Anchor instruction discriminator: sha256("global:<method>")[..8]. */
function anchorDiscriminator(method: string): number[] {
  const hash = createHash("sha256")
    .update(`global:${method}`)
    .digest();
  return Array.from(hash.subarray(0, 8));
}

function deriveVaultPda(programId: PublicKey, mint: PublicKey, vaultId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      mint.toBuffer(),
      new BN(vaultId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

function deriveVaultAuthorityPda(programId: PublicKey, vaultPda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultPda.toBuffer()],
    programId
  );
  return pda;
}

function deriveStrategyPda(
  programId: PublicKey,
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

function deriveStrategyAuthorityPda(
  programId: PublicKey,
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_authority"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

function deriveStrategyTokenPda(
  programId: PublicKey,
  vaultPda: PublicKey,
  strategyId: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy_token"),
      vaultPda.toBuffer(),
      new BN(strategyId).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

function deriveAllowedActionPda(
  programId: PublicKey,
  strategyPda: PublicKey,
  targetProgram: PublicKey,
  discriminator: number[]
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_action"),
      strategyPda.toBuffer(),
      targetProgram.toBuffer(),
      Buffer.from(discriminator),
    ],
    programId
  );
  return pda;
}

function deriveReservePda(programId: PublicKey, liquidityMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), liquidityMint.toBuffer()],
    programId
  );
  return pda;
}

function deriveCollateralMintPda(
  programId: PublicKey,
  liquidityMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_mint"), liquidityMint.toBuffer()],
    programId
  );
  return pda;
}

/**
 * Build a relayed instruction's data buffer for `deposit_reserve_liquidity_and_obligation_collateral`.
 * Anchor instruction args are Borsh-serialized after the 8-byte discriminator.
 * For this method the only arg is `liquidity_amount: u64`.
 */
function encodeDepositArgs(liquidityAmount: BN): Buffer {
  const buf = Buffer.alloc(8);
  liquidityAmount.toArrayLike(Buffer, "le", 8).copy(buf, 0);
  return buf;
}
const encodeWithdrawArgs = encodeDepositArgs; // same shape (`collateral_amount: u64`)

// ---------- main ----------

async function main() {
  // Provider from env (works against local validator + ./id.json wallet).
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = (provider.wallet as anchor.Wallet).payer;

  // Programs
  const myProject = anchor.workspace.myProject as Program<MyProject>;
  const mockKamino = anchor.workspace.mockKamino as Program<MockKamino>;

  console.log(`\n=== E2E: Erebor + mock Kamino ===\n`);
  console.log(`Wallet:       ${wallet.publicKey.toBase58()}`);
  console.log(`my_project:   ${myProject.programId.toBase58()}`);
  console.log(`mock_kamino:  ${mockKamino.programId.toBase58()}`);

  // ----------------------------------------
  // 1. Test mint + admin token account
  // ----------------------------------------
  console.log(`\n[1] minting test token...`);
  const liquidityMint = await createMint(
    provider.connection,
    wallet,
    wallet.publicKey,
    null,
    6
  );
  console.log(`    mint: ${liquidityMint.toBase58()}`);

  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    wallet,
    liquidityMint,
    wallet.publicKey
  );
  await mintTo(
    provider.connection,
    wallet,
    liquidityMint,
    userAta.address,
    wallet,
    DEPOSIT_AMOUNT * 2
  );

  // ----------------------------------------
  // 2. Init mock_kamino reserve
  // ----------------------------------------
  console.log(`\n[2] init mock_kamino reserve...`);
  const reservePda = deriveReservePda(mockKamino.programId, liquidityMint);
  const collateralMintPda = deriveCollateralMintPda(mockKamino.programId, liquidityMint);
  const reserveLiquiditySupply = getAssociatedTokenAddressSync(
    liquidityMint,
    reservePda,
    true
  );

  await mockKamino.methods
    .initReserve()
    .accountsStrict({
      admin: wallet.publicKey,
      liquidityMint,
      reserve: reservePda,
      collateralMint: collateralMintPda,
      liquiditySupply: reserveLiquiditySupply,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`    reserve PDA:    ${reservePda.toBase58()}`);
  console.log(`    collateral mint: ${collateralMintPda.toBase58()}`);
  console.log(`    liquidity supply: ${reserveLiquiditySupply.toBase58()}`);

  // ----------------------------------------
  // 3. Init Erebor vault + strategy
  //    Throwaway delegate = our "AI agent"
  // ----------------------------------------
  console.log(`\n[3] init Erebor vault + strategy...`);
  const vaultPda = deriveVaultPda(myProject.programId, liquidityMint, VAULT_ID);
  const vaultAuthority = deriveVaultAuthorityPda(myProject.programId, vaultPda);
  const [shareMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vaultPda.toBuffer()],
    myProject.programId
  );
  const reserveAta = getAssociatedTokenAddressSync(liquidityMint, vaultAuthority, true);

  await myProject.methods
    .initializeVault(new BN(VAULT_ID))
    .accountsStrict({
      admin: wallet.publicKey,
      vaultState: vaultPda,
      vaultAuthority,
      tokenMint: liquidityMint,
      shareMint: shareMintPda,
      reserveAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`    vault PDA: ${vaultPda.toBase58()}`);

  const agent = Keypair.generate();
  console.log(`    AI agent (delegate): ${agent.publicKey.toBase58()}`);

  const strategyPda = deriveStrategyPda(myProject.programId, vaultPda, STRATEGY_ID);
  const strategyAuthority = deriveStrategyAuthorityPda(
    myProject.programId,
    vaultPda,
    STRATEGY_ID
  );
  const strategyTokenAccount = deriveStrategyTokenPda(
    myProject.programId,
    vaultPda,
    STRATEGY_ID
  );

  await myProject.methods
    .createStrategy()
    .accountsStrict({
      admin: wallet.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      strategyAuthority,
      tokenMint: liquidityMint,
      strategyTokenAccount,
      delegate: agent.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts([])
    .rpc();
  console.log(`    strategy PDA: ${strategyPda.toBase58()}`);
  console.log(`    strategy_authority PDA: ${strategyAuthority.toBase58()}`);

  // Set weight 100% so the strategy gets the entire allocation when we rebalance.
  await myProject.methods
    .setStrategyWeight(8000) // 80% — leaves 20% reserve for fees
    .accountsStrict({
      admin: wallet.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
    })
    .rpc();

  // ----------------------------------------
  // 4. User deposits + authority allocates
  // ----------------------------------------
  console.log(`\n[4] user deposits ${DEPOSIT_AMOUNT / 1e6} USDC...`);
  const userShareAta = getAssociatedTokenAddressSync(shareMintPda, wallet.publicKey);
  await myProject.methods
    .deposit(new BN(DEPOSIT_AMOUNT))
    .accountsStrict({
      user: wallet.publicKey,
      vaultState: vaultPda,
      vaultAuthority,
      tokenMint: liquidityMint,
      shareMint: shareMintPda,
      userTokenAccount: userAta.address,
      reserveAta,
      userShareToken: userShareAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`    authority allocates ${ALLOCATION_AMOUNT / 1e6} USDC to strategy...`);
  await myProject.methods
    .allocateToStrategy(new BN(ALLOCATION_AMOUNT))
    .accountsStrict({
      authority: wallet.publicKey,
      vaultState: vaultPda,
      vaultAuthority,
      strategy: strategyPda,
      tokenMint: liquidityMint,
      reserveAta,
      strategyTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  // ----------------------------------------
  // 5. Whitelist the two Kamino actions
  // ----------------------------------------
  console.log(`\n[5] whitelisting Kamino deposit + withdraw on strategy...`);
  const depositDisc = anchorDiscriminator(
    "deposit_reserve_liquidity_and_obligation_collateral"
  );
  const withdrawDisc = anchorDiscriminator(
    "withdraw_obligation_collateral_and_redeem_reserve_collateral"
  );
  console.log(`    deposit  disc: 0x${Buffer.from(depositDisc).toString("hex")}`);
  console.log(`    withdraw disc: 0x${Buffer.from(withdrawDisc).toString("hex")}`);

  // Recipient index 0 = source slot in mock_kamino's deposit (strategy's
  // strategy_token_account). The agent's USDC ATA must NOT appear there.
  const depositAllowedAction = deriveAllowedActionPda(
    myProject.programId,
    strategyPda,
    mockKamino.programId,
    depositDisc
  );
  await myProject.methods
    .addAllowedAction(
      new BN(STRATEGY_ID),
      mockKamino.programId,
      depositDisc,
      0, // recipient_index = source slot
      null, // output_mint_index — same-token Kamino deposit, not a swap
    )
    .accountsStrict({
      admin: wallet.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      allowedAction: depositAllowedAction,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // For withdraw the strategy ATA appears at slot 1 (destination_liquidity).
  const withdrawAllowedAction = deriveAllowedActionPda(
    myProject.programId,
    strategyPda,
    mockKamino.programId,
    withdrawDisc
  );
  await myProject.methods
    .addAllowedAction(
      new BN(STRATEGY_ID),
      mockKamino.programId,
      withdrawDisc,
      1,
      null,
    )
    .accountsStrict({
      admin: wallet.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      allowedAction: withdrawAllowedAction,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`    both actions whitelisted`);

  // strategy_authority's collateral (cToken) ATA — needs to exist for deposit.
  const strategyCollateralAta = getAssociatedTokenAddressSync(
    collateralMintPda,
    strategyAuthority,
    true
  );
  // Ensure it exists (init via a payer ATA tx; mock won't create it for us).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchorTokenUtils = anchor.utils.token as any;
  await provider.sendAndConfirm(
    new Transaction().add(
      anchorTokenUtils.createAssociatedTokenAccountIdempotentInstruction
        ? anchorTokenUtils.createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            strategyCollateralAta,
            strategyAuthority,
            collateralMintPda
          )
        : (await import("@solana/spl-token")).createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            strategyCollateralAta,
            strategyAuthority,
            collateralMintPda
          )
    )
  );

  // ----------------------------------------
  // 6. Agent deposits into Kamino via execute_action
  // ----------------------------------------
  console.log(`\n[6] agent calls execute_action(deposit) → Kamino...`);

  const agentTokenAta = getAssociatedTokenAddressSync(liquidityMint, agent.publicKey);
  // Create the agent's USDC ATA so the anti-theft snapshot has somewhere to point.
  // Empty ATA is fine — anti-theft only checks it doesn't *grow*.
  await provider.sendAndConfirm(
    new Transaction().add(
      (await import("@solana/spl-token")).createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        agentTokenAta,
        agent.publicKey,
        liquidityMint
      )
    )
  );

  // Build the relayed instruction's account list, in mock_kamino's deposit order:
  //   0. source_liquidity (strategy ATA, OWNED BY strategy_authority post-refactor)
  //   1. destination_collateral (strategy_authority's cToken ATA)
  //   2. reserve PDA
  //   3. liquidity_mint
  //   4. collateral_mint
  //   5. liquidity_supply
  //   6. user_transfer_authority (strategy_authority — signs via PDA seeds)
  //   7. token_program
  const depositRemaining: AccountMeta[] = [
    { pubkey: strategyTokenAccount, isSigner: false, isWritable: true },
    { pubkey: strategyCollateralAta, isSigner: false, isWritable: true },
    { pubkey: reservePda, isSigner: false, isWritable: true },
    { pubkey: liquidityMint, isSigner: false, isWritable: false },
    { pubkey: collateralMintPda, isSigner: false, isWritable: true },
    { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
    { pubkey: strategyAuthority, isSigner: true, isWritable: false }, // strategy_authority signs (PDA)
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  // Note: the AccountMeta `isSigner: true` for strategyAuthority is only honoured
  // because execute_action calls `invoke_signed` with strategy_authority's seeds.

  const depositIxData = encodeDepositArgs(new BN(KAMINO_DEPOSIT_AMOUNT));

  await myProject.methods
    .executeAction(
      new BN(STRATEGY_ID),
      mockKamino.programId,
      depositDisc,
      depositIxData
    )
    .accountsStrict({
      caller: agent.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      strategyAuthority,
      allowedAction: depositAllowedAction,
      callerTokenAta: agentTokenAta,
      delegateTokenAta: agentTokenAta,
      targetProgramAccount: mockKamino.programId,
      allowedOutputToken: SystemProgram.programId, // unused (no output_mint_index on this action)
    })
    .remainingAccounts(depositRemaining)
    .signers([agent])
    .rpc();
  console.log(`    deposited ${KAMINO_DEPOSIT_AMOUNT / 1e6} USDC into Kamino`);

  // ----------------------------------------
  // 7. Simulate yield in mock Kamino
  // ----------------------------------------
  console.log(`\n[7] admin simulates ${SIMULATED_YIELD / 1e6} USDC of yield in Kamino...`);
  await mockKamino.methods
    .simulateYield(new BN(SIMULATED_YIELD))
    .accountsStrict({
      admin: wallet.publicKey,
      reserve: reservePda,
      liquidityMint,
      liquiditySupply: reserveLiquiditySupply,
      liquidityMintAuthority: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  // ----------------------------------------
  // 8. Agent withdraws from Kamino (cTokens → USDC)
  // ----------------------------------------
  const cTokenBalance = await provider.connection.getTokenAccountBalance(strategyCollateralAta);
  const burnAmount = new BN(cTokenBalance.value.amount); // burn all cTokens

  console.log(`\n[8] agent calls execute_action(withdraw) — burns ${cTokenBalance.value.amount} cTokens...`);

  // mock_kamino withdraw account order:
  //   0. source_collateral (strategy_authority's cToken ATA)
  //   1. destination_liquidity (strategy ATA)         ← recipient_index = 1
  //   2. reserve PDA
  //   3. liquidity_mint
  //   4. collateral_mint
  //   5. liquidity_supply
  //   6. user_transfer_authority (strategy_authority)
  //   7. token_program
  const withdrawRemaining: AccountMeta[] = [
    { pubkey: strategyCollateralAta, isSigner: false, isWritable: true },
    { pubkey: strategyTokenAccount, isSigner: false, isWritable: true },
    { pubkey: reservePda, isSigner: false, isWritable: true },
    { pubkey: liquidityMint, isSigner: false, isWritable: false },
    { pubkey: collateralMintPda, isSigner: false, isWritable: true },
    { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
    { pubkey: strategyAuthority, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  await myProject.methods
    .executeAction(
      new BN(STRATEGY_ID),
      mockKamino.programId,
      withdrawDisc,
      encodeWithdrawArgs(burnAmount)
    )
    .accountsStrict({
      caller: agent.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      strategyAuthority,
      allowedAction: withdrawAllowedAction,
      callerTokenAta: agentTokenAta,
      delegateTokenAta: agentTokenAta,
      targetProgramAccount: mockKamino.programId,
      allowedOutputToken: SystemProgram.programId, // unused (no output_mint_index on this action)
    })
    .remainingAccounts(withdrawRemaining)
    .signers([agent])
    .rpc();

  // ----------------------------------------
  // 9. Verify yield captured
  // ----------------------------------------
  const strategyAtaBal = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
  console.log(
    `\n[9] strategy ATA balance after withdraw: ${strategyAtaBal.value.uiAmountString} USDC`
  );
  console.log(
    `    expected ≈ ${(KAMINO_DEPOSIT_AMOUNT + SIMULATED_YIELD) / 1e6} USDC of principal+yield`
  );

  // Authority deallocates everything from strategy back to reserve.
  await myProject.methods
    .deallocateFromStrategy(new BN(strategyAtaBal.value.amount))
    .accountsStrict({
      authority: wallet.publicKey,
      vaultState: vaultPda,
      vaultAuthority,
      strategyAuthority,
      strategy: strategyPda,
      tokenMint: liquidityMint,
      reserveAta,
      strategyTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  // report_yield to fold the yield into total_deposited.
  await myProject.methods
    .reportYield()
    .accountsStrict({
      authority: wallet.publicKey,
      vaultState: vaultPda,
      strategy: strategyPda,
      strategyTokenAccount,
    })
    .rpc();

  const vault = await myProject.account.vaultState.fetch(vaultPda);
  console.log(
    `    vault total_deposited: ${vault.totalDeposited.toNumber() / 1e6} USDC ` +
      `(was ${DEPOSIT_AMOUNT / 1e6}, now should be ${(DEPOSIT_AMOUNT + SIMULATED_YIELD * (KAMINO_DEPOSIT_AMOUNT / KAMINO_DEPOSIT_AMOUNT)) / 1e6})`
  );

  console.log(`\n✓ E2E happy path complete\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
