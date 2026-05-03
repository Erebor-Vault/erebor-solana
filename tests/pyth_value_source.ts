// End-to-end tests for the PythPriceFeed ValueSource (kind = 2).
//
// Vault IDs used: 800, 801, 802 — isolated from other test files.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert, expect } from "chai";

import { MyProject } from "../target/types/my_project";
import { MockPyth } from "../target/types/mock_pyth";
import { setupVault } from "./helpers/fixtures";
import { derivePriceFeedPda, initializeMockFeed, setMockPrice } from "./helpers/mock_pyth";

function deriveValueSource(
  programId: PublicKey,
  strategy: PublicKey,
  index: number,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("value_source"), strategy.toBuffer(), Buffer.from([index])],
    programId,
  );
  return pda;
}

describe("PythPriceFeed ValueSource (kind = 2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockPyth = anchor.workspace.mockPyth as Program<MockPyth>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  it("happy path: settleStrategyValue combines SplAtaBalance + PythPriceFeed correctly", async () => {
    // Set up vault with one strategy (vaultId 800).
    const fx = await setupVault({
      program,
      payer,
      vaultId: 800,
      strategyCount: 1,
      userMintAmount: 0,
    });
    const s0 = fx.strategies[0];

    // Create an external mint (represents the "position token" the strategy holds).
    const extMint = await createMint(connection, payer, payer.publicKey, null, 6);

    // Create an external ATA owned by a throwaway key to represent the external position.
    const extOwner = Keypair.generate();
    const extAta = await createAssociatedTokenAccount(
      connection,
      payer,
      extMint,
      extOwner.publicKey,
    );

    // Mint 1_000_000 external tokens into extAta.
    // VS0 (SplAtaBalance) will read this raw balance.
    await mintTo(connection, payer, extMint, extAta, payer, 1_000_000);

    // Initialise mock Pyth feed for extMint at price = 5_000_000_000 (i64), expo = -8.
    // Effective price = 5_000_000_000 × 10^(-8) = 50.00 USD (in 6-decimal underlying units).
    const feed = await initializeMockFeed(
      mockPyth,
      payer,
      extMint,
      new BN(5_000_000_000),
      -8,
    );

    // Register VS index 0 = SplAtaBalance (kind = 0) pointing at extAta.
    // scale 1/1 — the raw u64 balance is used directly.
    const vs0Pda = deriveValueSource(program.programId, s0.strategy, 0);
    await program.methods
      .addValueSource(
        new BN(0), // strategy_id
        0,         // index
        0,         // kind = SplAtaBalance
        extAta,
        0,         // offset (ignored)
        new BN(1), // scale_num
        new BN(1), // scale_den
        0,         // mint_balance_source_index (unused)
        0,         // max_staleness_secs (unused)
      )
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        valueSource: vs0Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Register VS index 1 = PythPriceFeed (kind = 2) pointing at the feed.
    //   mintBalanceSourceIndex = 0  → take quantity from VS0's raw read (1_000_000)
    //   maxStalenessSecs = 60
    //   scaleNum = 1, scaleDen = 1_000_000
    //
    // Contribution = quantity × price × 10^expo × (scaleNum / scaleDen)
    //             = 1_000_000 × 5_000_000_000 × 10^(-8) × (1 / 1_000_000)
    //             = 1_000_000 × 50.00 × 0.000001
    //             = 50
    //
    // Total settled value = strategy_ata_balance (0) + VS0 (1_000_000) + VS1 (50).
    // Since allocated_amount starts at 0, the net delta = 1_000_000 + 50 = 1_000_050.
    const vs1Pda = deriveValueSource(program.programId, s0.strategy, 1);
    await program.methods
      .addValueSource(
        new BN(0), // strategy_id
        1,         // index
        2,         // kind = PythPriceFeed
        feed,      // target_account = Pyth price feed PDA
        0,         // offset (not used by Pyth kind)
        new BN(1), // scale_num
        new BN(1_000_000), // scale_den
        0,         // mint_balance_source_index = 0 (reads quantity from VS0)
        60,        // max_staleness_secs
      )
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        valueSource: vs1Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stratBefore = await program.account.strategyAllocation.fetch(s0.strategy);
    const vaultBefore = await program.account.vaultState.fetch(fx.vault.vaultState);

    // settleStrategyValue with both VSs in remainingAccounts.
    // Order: [vsPda0, targetAccount0, vsPda1, targetAccount1]
    await program.methods
      .settleStrategyValue(new BN(0))
      .accountsStrict({
        authority: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        strategyTokenAccount: s0.strategyTokenAccount,
      })
      .remainingAccounts([
        { pubkey: vs0Pda, isSigner: false, isWritable: false },
        { pubkey: extAta, isSigner: false, isWritable: false },
        { pubkey: vs1Pda, isSigner: false, isWritable: false },
        { pubkey: feed, isSigner: false, isWritable: false },
      ])
      .rpc();

    const stratAfter = await program.account.strategyAllocation.fetch(s0.strategy);
    const vaultAfter = await program.account.vaultState.fetch(fx.vault.vaultState);

    // idle strategy ATA balance = 0 (no deposits were made)
    // VS0 = 1_000_000
    // VS1 = 50
    // expected allocatedAmount = 0 + 1_000_000 + 50 = 1_000_050
    assert.equal(stratAfter.allocatedAmount.toString(), "1000050");
    assert.equal(
      vaultAfter.totalDeposited.sub(vaultBefore.totalDeposited).toString(),
      "1000050",
    );
  });

  it("stale price: settleStrategyValue reverts with ValueSourcePythStale", async () => {
    const fx = await setupVault({
      program,
      payer,
      vaultId: 801,
      strategyCount: 1,
      userMintAmount: 0,
    });
    const s0 = fx.strategies[0];

    const extMint = await createMint(connection, payer, payer.publicKey, null, 6);
    const extOwner = Keypair.generate();
    const extAta = await createAssociatedTokenAccount(
      connection,
      payer,
      extMint,
      extOwner.publicKey,
    );
    await mintTo(connection, payer, extMint, extAta, payer, 1_000_000);

    const feed = await initializeMockFeed(
      mockPyth,
      payer,
      extMint,
      new BN(5_000_000_000),
      -8,
    );

    // VS0 = SplAtaBalance
    const vs0Pda = deriveValueSource(program.programId, s0.strategy, 0);
    await program.methods
      .addValueSource(new BN(0), 0, 0, extAta, 0, new BN(1), new BN(1), 0, 0)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        valueSource: vs0Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // VS1 = PythPriceFeed with maxStalenessSecs = 1 (will be stale after 3s)
    const vs1Pda = deriveValueSource(program.programId, s0.strategy, 1);
    await program.methods
      .addValueSource(
        new BN(0), 1, 2, feed, 0, new BN(1), new BN(1_000_000), 0, 1,
      )
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        valueSource: vs1Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Wait for the feed's publish_time to become stale (> 1 second ago).
    await new Promise((r) => setTimeout(r, 3000));

    try {
      await program.methods
        .settleStrategyValue(new BN(0))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          strategyTokenAccount: s0.strategyTokenAccount,
        })
        .remainingAccounts([
          { pubkey: vs0Pda, isSigner: false, isWritable: false },
          { pubkey: extAta, isSigner: false, isWritable: false },
          { pubkey: vs1Pda, isSigner: false, isWritable: false },
          { pubkey: feed, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("should have reverted with ValueSourcePythStale");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ValueSourcePythStale");
    }
  });

  it("negative price: settleStrategyValue reverts with ValueSourcePythNegativePrice", async () => {
    const fx = await setupVault({
      program,
      payer,
      vaultId: 802,
      strategyCount: 1,
      userMintAmount: 0,
    });
    const s0 = fx.strategies[0];

    const extMint = await createMint(connection, payer, payer.publicKey, null, 6);
    const extOwner = Keypair.generate();
    const extAta = await createAssociatedTokenAccount(
      connection,
      payer,
      extMint,
      extOwner.publicKey,
    );
    await mintTo(connection, payer, extMint, extAta, payer, 1_000_000);

    // Initialise feed with a valid price first.
    const feed = await initializeMockFeed(
      mockPyth,
      payer,
      extMint,
      new BN(5_000_000_000),
      -8,
    );

    // VS0 = SplAtaBalance
    const vs0Pda = deriveValueSource(program.programId, s0.strategy, 0);
    await program.methods
      .addValueSource(new BN(0), 0, 0, extAta, 0, new BN(1), new BN(1), 0, 0)
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        valueSource: vs0Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // VS1 = PythPriceFeed with generous staleness
    const vs1Pda = deriveValueSource(program.programId, s0.strategy, 1);
    await program.methods
      .addValueSource(
        new BN(0), 1, 2, feed, 0, new BN(1), new BN(1_000_000), 0, 3600,
      )
      .accountsStrict({
        admin: payer.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: s0.strategy,
        valueSource: vs1Pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Set price to -1 (negative).
    await setMockPrice(mockPyth, payer, extMint, new BN(-1), -8);

    try {
      await program.methods
        .settleStrategyValue(new BN(0))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          strategyTokenAccount: s0.strategyTokenAccount,
        })
        .remainingAccounts([
          { pubkey: vs0Pda, isSigner: false, isWritable: false },
          { pubkey: extAta, isSigner: false, isWritable: false },
          { pubkey: vs1Pda, isSigner: false, isWritable: false },
          { pubkey: feed, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("should have reverted with ValueSourcePythNegativePrice");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ValueSourcePythNegativePrice");
    }
  });
});
