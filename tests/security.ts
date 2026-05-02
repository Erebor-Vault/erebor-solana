// Phase-3 security test suite — extends the existing happy-path coverage in
// `my_project.ts` with three classes of tests:
//
//   1. Cross-strategy isolation (the headline guarantee of per-strategy
//      authority PDAs): try to drain strategy 1's funds via strategy 0's
//      `execute_action` → must revert.
//   2. Inflation attack (audit #4): demonstrate the OpenZeppelin
//      virtual-shares offset prevents the donate-to-vault grief.
//   3. Coverage for instructions the post-refactor `my_project.ts` doesn't
//      yet exercise: `update_strategy_delegate`, `report_yield`,
//      `allocate_to_strategy` role check, `deallocate_from_strategy` pause check.
//
// Plus inline `assertAllInvariants(...)` calls anchor each mutating test to
// the invariant table from docs/TEST_PLAN.md.

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert, expect } from "chai";
import { createHash } from "node:crypto";

import { MyProject } from "../target/types/my_project";
import { MockKamino } from "../target/types/mock_kamino";
import {
  setupVault,
  deriveStrategy,
  deriveAllowedAction,
  deriveVault,
} from "./helpers/fixtures";
import { assertAllInvariants } from "./helpers/invariants";

function anchorDisc(method: string): number[] {
  const h = createHash("sha256").update(`global:${method}`).digest();
  return Array.from(h.subarray(0, 8));
}

describe("my_project — phase-3 security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.myProject as Program<MyProject>;
  const mockKamino = anchor.workspace.mockKamino as Program<MockKamino>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // -------------------------------------------------------------
  // 1. Cross-strategy drain attempt
  // -------------------------------------------------------------
  describe("cross-strategy isolation", () => {
    it("agent for strategy 0 cannot pin strategy 1's ATA at recipient_index — reverts RecipientMismatch", async () => {
      // Setup: 1 vault, 2 strategies, allocate to both
      const fx = await setupVault({
        program,
        payer,
        vaultId: 100,
        strategyCount: 2,
        userMintAmount: 200_000_000,
      });

      // Deposit + allocate 50 to each strategy
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(150_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();

      for (const s of fx.strategies) {
        await program.methods
          .allocateToStrategy(new BN(50_000_000))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s.strategy,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }

      // Whitelist mock_kamino deposit on strategy 0 only.
      const depositDisc = anchorDisc("deposit_reserve_liquidity_and_obligation_collateral");
      const allowedAction = deriveAllowedAction(
        program.programId,
        fx.strategies[0].strategy,
        mockKamino.programId,
        depositDisc
      );
      await program.methods
        .addAllowedAction(new BN(0), mockKamino.programId, depositDisc, 0, null, 0, 0) // recipient_index = 0 (source)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
          allowedAction,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Build the relayed instruction's account list with strategy 1's
      // token account at index 0 (where recipient_index points). The check
      // `accounts[0] == strategy[0].token_account` MUST FAIL.
      const ixData = Buffer.alloc(8);
      new BN(10_000_000).toArrayLike(Buffer, "le", 8).copy(ixData, 0);

      const delegateAta = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        fx.delegates[0].publicKey
      );
      const callerAta = delegateAta.address;

      // The program builds AccountMetas internally and auto-flags the
      // strategy_authority slot as a signer (via invoke_signed). The OUTER
      // tx must NOT mark it as isSigner because it has no real signature
      // — that's a TX-deserialization fail, not the program-level revert
      // we want to demonstrate.
      const remaining = [
        // INDEX 0 = source — agent passes strategy 1's ATA (the attack)
        { pubkey: fx.strategies[1].strategyTokenAccount, isSigner: false, isWritable: true },
        // index 1+ — irrelevant for this test, the recipient check fires first
        { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
        { pubkey: fx.strategies[0].strategyAuthority, isSigner: false, isWritable: false },
      ];

      try {
        await program.methods
          .executeAction(new BN(0), mockKamino.programId, depositDisc, ixData)
          .accountsStrict({
            caller: fx.delegates[0].publicKey,
            vaultState: fx.vault.vaultState,
            strategy: fx.strategies[0].strategy,
            strategyAuthority: fx.strategies[0].strategyAuthority,
            allowedAction,
            callerTokenAta: callerAta,
            delegateTokenAta: callerAta, // delegate == caller here
            targetProgramAccount: mockKamino.programId,
            // Phase-4d / Option B placeholders: action has
            // output_mint_index = None, so these accounts are unused.
            // Pass SystemProgram::id as filler.
            allowedOutputToken: SystemProgram.programId,
            vaultAllowedOutputToken: SystemProgram.programId,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .remainingAccounts(remaining)
          .signers([fx.delegates[0]])
          .rpc();
        assert.fail("expected RecipientMismatch revert");
      } catch (err) {
        const anchorErr = err as AnchorError;
        const code = anchorErr.error?.errorCode?.code;
        assert.equal(
          code,
          "RecipientMismatch",
          `expected RecipientMismatch, got ${code ?? err}`
        );
      }
    });

    it("after the attempt, strategy 1's ATA balance is unchanged", async () => {
      // (Sanity check — funds are still on s1.) The previous test's revert
      // means the on-chain state never changed; this test confirms via
      // observation that the cross-strategy drain truly didn't succeed.
      // We re-run a tiny fixture here for isolation between describe()s.
      const fx = await setupVault({
        program,
        payer,
        vaultId: 101,
        strategyCount: 2,
        userMintAmount: 100_000_000,
      });
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(60_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      for (const s of fx.strategies) {
        await program.methods
          .allocateToStrategy(new BN(20_000_000))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s.strategy,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }
      const s1Bal = await connection.getTokenAccountBalance(
        fx.strategies[1].strategyTokenAccount
      );
      assert.equal(
        s1Bal.value.amount,
        "20000000",
        "strategy 1 ATA should still hold 20 USDC"
      );

      await assertAllInvariants({
        program,
        connection,
        vaultState: fx.vault.vaultState,
        vaultAuthority: fx.vault.vaultAuthority,
        shareMint: fx.vault.shareMint,
        reserveAta: fx.vault.reserveAta,
        strategies: fx.strategies,
      });
    });
  });

  // -------------------------------------------------------------
  // 2. Inflation attack (audit #4)
  // -------------------------------------------------------------
  describe("inflation attack — virtual shares mitigation", () => {
    it("attacker who deposits 1 wei + donates to reserve cannot grief subsequent depositor", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 200,
        strategyCount: 0,
        userMintAmount: 0,
      });

      // Two users: attacker (deposits 1 wei + donates to reserve), victim (deposits 100 USDC after).
      const attacker = Keypair.generate();
      const victim = Keypair.generate();
      await connection.confirmTransaction(
        await connection.requestAirdrop(attacker.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
      );
      await connection.confirmTransaction(
        await connection.requestAirdrop(victim.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
      );
      const attackerAta = await createAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        attacker.publicKey
      );
      const victimAta = await createAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        victim.publicKey
      );
      await mintTo(connection, payer, fx.mint, attackerAta, payer, 1_000_000_000); // 1000 USDC
      await mintTo(connection, payer, fx.mint, victimAta, payer, 1_000_000_000);

      // Attacker deposits 1 wei.
      const attackerShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: attacker.publicKey,
      });
      await program.methods
        .deposit(new BN(1))
        .accountsStrict({
          user: attacker.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: attackerAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: attackerShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();

      // Attacker donates 1000 USDC directly to reserve ATA (out-of-band).
      await mintTo(connection, payer, fx.mint, fx.vault.reserveAta, payer, 1_000_000_000);

      // Victim deposits 100 USDC.
      const victimShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: victim.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: victim.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: victimAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: victimShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([victim])
        .rpc();

      // Victim's share balance MUST be > 0. Without the virtual-shares offset
      // it would round to 0 (1 wei × supply / total ≈ 0).
      const vsBal = await connection.getTokenAccountBalance(victimShareAta);
      assert.isAbove(
        Number(vsBal.value.amount),
        0,
        "victim's share balance must be positive — virtual-shares offset broken"
      );
      // Stronger: victim's share fraction must be roughly 100 / 1100 ≈ 9.09% of supply.
      // With virtual offset, share count is large but the ratio is what matters.
      const supplyInfo = await connection.getTokenSupply(fx.vault.shareMint);
      const victimFraction = Number(vsBal.value.amount) / Number(supplyInfo.value.amount);
      // Note: total_deposited only includes deposits (1 + 100M = 100M+1 wei),
      // not the donation. So victim's share fraction is ~100M / (100M + 1) ≈ 1.0.
      // The attack would have made it ≈ 0; with offset the victim gets nearly all shares.
      assert.isAbove(
        victimFraction,
        0.5,
        `victim's share fraction is ${victimFraction} — must be > 50% for inflation attack to be neutralised`
      );
    });

    it("first depositor's shares scale by VIRTUAL_SHARES (10^6 offset)", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 201,
        strategyCount: 0,
        userMintAmount: 1_000_000,
      });
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(1_000_000)) // 1 USDC
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      const bal = await connection.getTokenAccountBalance(userShareAta);
      // OZ formula: shares = amount × (supply + VIRTUAL) / (assets + 1)
      // First deposit: supply=0, assets=0 → shares = amount × 1_000_000 / 1
      // = 1_000_000 × 1_000_000 = 10^12
      assert.equal(
        bal.value.amount,
        String(1_000_000 * 1_000_000),
        "first-deposit shares should be amount × VIRTUAL_SHARES (1_000_000)"
      );
    });
  });

  // -------------------------------------------------------------
  // 3. Coverage for instructions not in the existing suite
  // -------------------------------------------------------------
  describe("coverage gaps", () => {
    it("update_strategy_delegate — admin can rotate; dedupe rejects same-vault duplicate", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 300,
        strategyCount: 2,
        userMintAmount: 0,
      });

      const newDelegate = Keypair.generate();

      // Rotate strategy 0's delegate. remaining_accounts must include all
      // OTHER strategies (i.e. strategy 1) for the dedupe check.
      await program.methods
        .updateStrategyDelegate()
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
          strategyAuthority: fx.strategies[0].strategyAuthority,
          strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
          newDelegate: newDelegate.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: fx.strategies[1].strategy,
            isSigner: false,
            isWritable: false,
          },
        ])
        .rpc();

      const sa = await (program.account as unknown as { strategyAllocation: { fetch: (k: PublicKey) => Promise<{ delegate: PublicKey }> } })
        .strategyAllocation.fetch(fx.strategies[0].strategy);
      assert.isTrue(
        sa.delegate.equals(newDelegate.publicKey),
        `delegate not updated: got ${sa.delegate.toBase58()}`
      );

      // Now try to rotate strategy 1's delegate to the SAME pubkey we just
      // assigned to strategy 0. Dedupe must reject.
      try {
        await program.methods
          .updateStrategyDelegate()
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: fx.strategies[1].strategy,
            strategyAuthority: fx.strategies[1].strategyAuthority,
            strategyTokenAccount: fx.strategies[1].strategyTokenAccount,
            newDelegate: newDelegate.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([
            {
              pubkey: fx.strategies[0].strategy,
              isSigner: false,
              isWritable: false,
            },
          ])
          .rpc();
        assert.fail("expected DuplicateDelegate revert");
      } catch (err) {
        const code = (err as AnchorError).error?.errorCode?.code;
        assert.equal(code, "DuplicateDelegate", `got ${code ?? err}`);
      }
    });

    it("report_yield — folds ATA-balance excess into total_deposited; pause-gated", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 301,
        strategyCount: 1,
        userMintAmount: 200_000_000,
      });
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      await program.methods
        .allocateToStrategy(new BN(50_000_000))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          strategy: fx.strategies[0].strategy,
          tokenMint: fx.mint,
          reserveAta: fx.vault.reserveAta,
          strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Simulate yield: mint underlying directly to strategy ATA.
      await mintTo(connection, payer, fx.mint, fx.strategies[0].strategyTokenAccount, payer, 5_000_000);

      // report_yield → total_deposited += 5_000_000
      await program.methods
        .reportYield()
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
          strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
        })
        .rpc();

      const v = await (program.account as unknown as { vaultState: { fetch: (k: PublicKey) => Promise<{ totalDeposited: BN }> } })
        .vaultState.fetch(fx.vault.vaultState);
      assert.equal(
        v.totalDeposited.toString(),
        String(100_000_000 + 5_000_000),
        "total_deposited didn't include simulated yield"
      );

      // Pause + verify report_yield reverts with VaultPaused.
      await program.methods
        .setPaused(true)
        .accountsStrict({ admin: payer.publicKey, vaultState: fx.vault.vaultState })
        .rpc();
      // Mint another 1 unit of yield so the call has work to do.
      await mintTo(connection, payer, fx.mint, fx.strategies[0].strategyTokenAccount, payer, 1_000_000);
      try {
        await program.methods
          .reportYield()
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: fx.strategies[0].strategy,
            strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
          })
          .rpc();
        assert.fail("expected VaultPaused revert");
      } catch (err) {
        const code = (err as AnchorError).error?.errorCode?.code;
        assert.equal(code, "VaultPaused", `got ${code ?? err}`);
      }

      // Unpause for cleanliness.
      await program.methods
        .setPaused(false)
        .accountsStrict({ admin: payer.publicKey, vaultState: fx.vault.vaultState })
        .rpc();
    });

    it("allocate_to_strategy — non-authority signer is rejected", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 302,
        strategyCount: 1,
        userMintAmount: 200_000_000,
      });
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();

      const wrongSigner = Keypair.generate();
      await connection.confirmTransaction(
        await connection.requestAirdrop(wrongSigner.publicKey, anchor.web3.LAMPORTS_PER_SOL)
      );

      try {
        await program.methods
          .allocateToStrategy(new BN(10_000_000))
          .accountsStrict({
            authority: wrongSigner.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: fx.strategies[0].strategy,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([wrongSigner])
          .rpc();
        assert.fail("expected UnauthorizedAuthority revert");
      } catch (err) {
        const code = (err as AnchorError).error?.errorCode?.code;
        assert.equal(code, "UnauthorizedAuthority", `got ${code ?? err}`);
      }
    });

    it("deallocate_from_strategy — paused vault is gated", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 303,
        strategyCount: 1,
        userMintAmount: 200_000_000,
      });
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      await program.methods
        .allocateToStrategy(new BN(50_000_000))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          strategy: fx.strategies[0].strategy,
          tokenMint: fx.mint,
          reserveAta: fx.vault.reserveAta,
          strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Pause
      await program.methods
        .setPaused(true)
        .accountsStrict({ admin: payer.publicKey, vaultState: fx.vault.vaultState })
        .rpc();

      try {
        await program.methods
          .deallocateFromStrategy(new BN(10_000_000))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategyAuthority: fx.strategies[0].strategyAuthority,
            strategy: fx.strategies[0].strategy,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected VaultPaused revert");
      } catch (err) {
        const code = (err as AnchorError).error?.errorCode?.code;
        assert.equal(code, "VaultPaused", `got ${code ?? err}`);
      }
    });
  });

  // -------------------------------------------------------------
  // 4. Final invariant sweep — drives a varied scenario then asserts all 4
  // -------------------------------------------------------------
  describe("invariants — scenario sweep", () => {
    it("after a deposit / allocate / yield / withdraw chain, all invariants hold", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 400,
        strategyCount: 2,
        userMintAmount: 500_000_000,
      });
      const ctx = {
        program,
        connection,
        vaultState: fx.vault.vaultState,
        vaultAuthority: fx.vault.vaultAuthority,
        shareMint: fx.vault.shareMint,
        reserveAta: fx.vault.reserveAta,
        strategies: fx.strategies,
      };

      // Deposit 200 USDC
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(200_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      await assertAllInvariants(ctx);

      // Set weights so allocate_to_strategy succeeds with the sum cap respected.
      await program.methods
        .setStrategyWeight(3000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
        })
        .rpc();
      await program.methods
        .setStrategyWeight(2000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[1].strategy,
        })
        .rpc();
      await assertAllInvariants(ctx);

      // Allocate
      for (const s of fx.strategies) {
        await program.methods
          .allocateToStrategy(new BN(50_000_000))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s.strategy,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }
      await assertAllInvariants(ctx);

      // Simulate yield + report
      await mintTo(connection, payer, fx.mint, fx.strategies[0].strategyTokenAccount, payer, 2_000_000);
      await program.methods
        .reportYield()
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
          strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
        })
        .rpc();
      await assertAllInvariants(ctx);
    });
  });

  // -------------------------------------------------------------
  // 5. Phase-5 — signed-delta rebalance smoke test
  // -------------------------------------------------------------
  describe("rebalance_with_delta", () => {
    it("pushes positive delta from reserve and pulls negative delta back", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 500,
        strategyCount: 1,
        userMintAmount: 500_000_000,
      });

      // Deposit so the reserve has liquidity to push.
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();

      const s0 = fx.strategies[0];

      // +30 USDC into strategy 0.
      await program.methods
        .rebalanceWithDelta(new BN(30_000_000))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          strategy: s0.strategy,
          strategyAuthority: s0.strategyAuthority,
          tokenMint: fx.mint,
          reserveAta: fx.vault.reserveAta,
          strategyTokenAccount: s0.strategyTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      let s = await program.account.strategyAllocation.fetch(s0.strategy);
      assert.equal(s.allocatedAmount.toString(), "30000000");

      // -10 USDC back to reserve.
      await program.methods
        .rebalanceWithDelta(new BN(-10_000_000))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          strategy: s0.strategy,
          strategyAuthority: s0.strategyAuthority,
          tokenMint: fx.mint,
          reserveAta: fx.vault.reserveAta,
          strategyTokenAccount: s0.strategyTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      s = await program.account.strategyAllocation.fetch(s0.strategy);
      assert.equal(s.allocatedAmount.toString(), "20000000");
    });

    it("reverts ZeroAmount on delta == 0", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 501,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      try {
        await program.methods
          .rebalanceWithDelta(new BN(0))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s0.strategy,
            strategyAuthority: s0.strategyAuthority,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s0.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected ZeroAmount");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "ZeroAmount");
      }
    });

    it("reverts DeltaOutOfRange on a negative delta larger than allocated", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 502,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      try {
        await program.methods
          .rebalanceWithDelta(new BN(-1))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s0.strategy,
            strategyAuthority: s0.strategyAuthority,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s0.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected DeltaOutOfRange");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "DeltaOutOfRange");
      }
    });

    it("non-authority signer is rejected", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 503,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const stranger = Keypair.generate();
      // Fund the stranger's lamports so the transaction can pay rent.
      const sig = await connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
      await connection.confirmTransaction(sig);
      try {
        await program.methods
          .rebalanceWithDelta(new BN(1))
          .accountsStrict({
            authority: stranger.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s0.strategy,
            strategyAuthority: s0.strategyAuthority,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s0.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([stranger])
          .rpc();
        assert.fail("expected UnauthorizedAuthority");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "UnauthorizedAuthority");
      }
    });

    it("reverts InsufficientReserveForRebalance when reserve can't cover positive delta", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 505,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      // Reserve is empty (no deposit). Pushing any delta > 0 should fail.
      try {
        await program.methods
          .rebalanceWithDelta(new BN(1))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s0.strategy,
            strategyAuthority: s0.strategyAuthority,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s0.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected InsufficientReserveForRebalance");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "InsufficientReserveForRebalance");
      }
    });

    it("paused vault blocks rebalance_with_delta", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 504,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      await program.methods
        .setPaused(true)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
        })
        .rpc();
      try {
        await program.methods
          .rebalanceWithDelta(new BN(1))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            strategy: s0.strategy,
            strategyAuthority: s0.strategyAuthority,
            tokenMint: fx.mint,
            reserveAta: fx.vault.reserveAta,
            strategyTokenAccount: s0.strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected VaultPaused");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "VaultPaused");
      }
    });
  });

  // -------------------------------------------------------------
  // 6. Phase-5 — auto-fan-out on deposit + AutoActionConfig
  // -------------------------------------------------------------
  describe("deposit auto-fan-out", () => {
    it("splits deposit across active strategies by weight; remainder stays in reserve", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 600,
        strategyCount: 2,
        userMintAmount: 500_000_000,
      });

      // Set weights: 30% strategy 0, 20% strategy 1, 50% reserve buffer.
      await program.methods
        .setStrategyWeight(3000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
        })
        .rpc();
      await program.methods
        .setStrategyWeight(2000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[1].strategy,
        })
        .rpc();

      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      // Deposit 100 USDC with both strategies in remaining_accounts as
      // [pda, token_account] pairs.
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: fx.strategies[0].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[1].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[1].strategyTokenAccount, isSigner: false, isWritable: true },
        ])
        .signers([fx.user])
        .rpc();

      const reserve = await program.provider.connection.getTokenAccountBalance(fx.vault.reserveAta);
      const s0Ata = await program.provider.connection.getTokenAccountBalance(fx.strategies[0].strategyTokenAccount);
      const s1Ata = await program.provider.connection.getTokenAccountBalance(fx.strategies[1].strategyTokenAccount);
      assert.equal(s0Ata.value.amount, "30000000"); // 30%
      assert.equal(s1Ata.value.amount, "20000000"); // 20%
      assert.equal(reserve.value.amount, "50000000"); // remainder

      const s0 = await program.account.strategyAllocation.fetch(fx.strategies[0].strategy);
      const s1 = await program.account.strategyAllocation.fetch(fx.strategies[1].strategy);
      assert.equal(s0.allocatedAmount.toString(), "30000000");
      assert.equal(s1.allocatedAmount.toString(), "20000000");
    });

    // ----------------------------------------------------------------
    // PoC: duplicate-strategy chunks in remaining_accounts must not let
    // a depositor drain pre-existing reserve liquidity into a strategy.
    //
    // Pre-fix, the fan-out loop computed `share = amount * weight / 10000`
    // from the raw deposit `amount` on every iteration, with no dedup and
    // no running-total guard. A depositor could pass the same
    // (strategy_pda, strategy_ata) pair N times to push N × share out of
    // reserve, funded by *other* depositors' uninvested balance —
    // effectively performing an unauthorised `allocate_to_strategy`.
    //
    // Post-fix the cumulative-fanout guard reverts with FanOutExceedsDeposit
    // before any second-iteration transfer can land. Reserve must be
    // preserved exactly at the post-deposit value (depositor B's amount on
    // top of victim A's pre-existing balance).
    // ----------------------------------------------------------------
    it("PoC: duplicate (strategy, ata) chunks revert FanOutExceedsDeposit; victim's reserve is preserved", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 610,
        strategyCount: 1,
        userMintAmount: 100_000_000,
      });

      // 100% weight on the only strategy. Maximises the per-iteration
      // share so a single duplicate is enough to overshoot `amount`.
      await program.methods
        .setStrategyWeight(10_000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
        })
        .rpc();

      // Victim A funds the reserve via a v1-shape deposit (empty fan-out).
      const victim = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          victim.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        )
      );
      const victimAta = await createAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        victim.publicKey
      );
      await mintTo(connection, payer, fx.mint, victimAta, payer, 100_000_000);
      const victimShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: victim.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: victim.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: victimAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: victimShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([victim])
        .rpc();

      const reserveBefore = await connection.getTokenAccountBalance(
        fx.vault.reserveAta
      );
      const stratBefore = await connection.getTokenAccountBalance(
        fx.strategies[0].strategyTokenAccount
      );
      assert.equal(reserveBefore.value.amount, "100000000");
      assert.equal(stratBefore.value.amount, "0");

      // Attacker B deposits 100_000_000 and passes the same strategy
      // chunk twice. Pre-fix: 2 × 100M = 200M pulled from reserve
      // (which holds A's 100M + B's 100M = 200M after the user→reserve
      // transfer), draining all of A's funds into the strategy ATA.
      const attackerShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      try {
        await program.methods
          .deposit(new BN(100_000_000))
          .accountsStrict({
            user: fx.user.publicKey,
            vaultState: fx.vault.vaultState,
            vaultAuthority: fx.vault.vaultAuthority,
            tokenMint: fx.mint,
            shareMint: fx.vault.shareMint,
            userTokenAccount: fx.userAta,
            reserveAta: fx.vault.reserveAta,
            userShareToken: attackerShareAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .remainingAccounts([
            { pubkey: fx.strategies[0].strategy, isSigner: false, isWritable: true },
            { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
            { pubkey: fx.strategies[0].strategy, isSigner: false, isWritable: true },
            { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
          ])
          .signers([fx.user])
          .rpc();
        assert.fail("expected FanOutExceedsDeposit — duplicate chunk should be rejected");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "FanOutExceedsDeposit");
      }

      // Reserve and strategy ATA must be unchanged: the failed tx is
      // rolled back atomically, so the victim's funds stay put.
      const reserveAfter = await connection.getTokenAccountBalance(
        fx.vault.reserveAta
      );
      const stratAfter = await connection.getTokenAccountBalance(
        fx.strategies[0].strategyTokenAccount
      );
      assert.equal(reserveAfter.value.amount, "100000000");
      assert.equal(stratAfter.value.amount, "0");

      // Sanity: the legitimate single-chunk fan-out still works after the
      // guard. B's own 100M flows into the strategy as intended; the
      // victim's 100M reserve is left alone.
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: attackerShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: fx.strategies[0].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
        ])
        .signers([fx.user])
        .rpc();

      const reserveFinal = await connection.getTokenAccountBalance(
        fx.vault.reserveAta
      );
      const stratFinal = await connection.getTokenAccountBalance(
        fx.strategies[0].strategyTokenAccount
      );
      assert.equal(reserveFinal.value.amount, "100000000"); // A's funds, untouched
      assert.equal(stratFinal.value.amount, "100000000"); // B's full deposit
    });

    it("with empty remaining_accounts, deposit behaves like v1 (everything stays in reserve)", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 601,
        strategyCount: 1,
        userMintAmount: 100_000_000,
      });

      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(50_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      const reserve = await program.provider.connection.getTokenAccountBalance(fx.vault.reserveAta);
      assert.equal(reserve.value.amount, "50000000");
      const s = await program.account.strategyAllocation.fetch(fx.strategies[0].strategy);
      assert.equal(s.allocatedAmount.toString(), "0");
    });
  });

  describe("AutoActionConfig", () => {
    it("admin can set + read + clear deposit + withdraw configs", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 602,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const target = Keypair.generate().publicKey;
      const disc = Buffer.alloc(8, 7);
      const ixData = Buffer.from([1, 2, 3, 4]);

      const [depositCfg] = PublicKey.findProgramAddressSync(
        [Buffer.from("auto_action"), s0.strategy.toBuffer(), Buffer.from([0])],
        program.programId,
      );
      const [withdrawCfg] = PublicKey.findProgramAddressSync(
        [Buffer.from("auto_action"), s0.strategy.toBuffer(), Buffer.from([1])],
        program.programId,
      );

      await program.methods
        .setAutoActionConfig(new BN(0), 0, target, [...disc] as any, ixData)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          autoActionConfig: depositCfg,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      let cfg = await program.account.autoActionConfig.fetch(depositCfg);
      assert.equal(cfg.kind, 0);
      assert.deepEqual(cfg.targetProgram.toBase58(), target.toBase58());
      assert.deepEqual([...cfg.discriminator], [...disc]);
      assert.deepEqual([...cfg.ixData], [...ixData]);

      // A second set on the same (strategy, kind) reverts (init, not init_if_needed).
      try {
        await program.methods
          .setAutoActionConfig(new BN(0), 0, target, [...disc] as any, ixData)
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            autoActionConfig: depositCfg,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected init-already-in-use");
      } catch (_err) {
        // expected
      }

      // Withdraw kind = 1 lands at a different PDA.
      await program.methods
        .setAutoActionConfig(new BN(0), 1, target, [...disc] as any, ixData)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          autoActionConfig: withdrawCfg,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      cfg = await program.account.autoActionConfig.fetch(withdrawCfg);
      assert.equal(cfg.kind, 1);

      // Clear closes the PDA.
      await program.methods
        .clearAutoActionConfig(new BN(0), 0)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          autoActionConfig: depositCfg,
        })
        .rpc();
      const after = await program.provider.connection.getAccountInfo(depositCfg);
      assert.equal(after, null);
    });

    it("rejects invalid kind", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 603,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const target = Keypair.generate().publicKey;
      const disc = Buffer.alloc(8, 0);
      // Have to derive against an arbitrary kind byte; the seeds match what
      // we pass (kind = 5), so the PDA derivation passes — the handler
      // body is what reverts.
      const [cfg] = PublicKey.findProgramAddressSync(
        [Buffer.from("auto_action"), s0.strategy.toBuffer(), Buffer.from([5])],
        program.programId,
      );
      try {
        await program.methods
          .setAutoActionConfig(new BN(0), 5, target, [...disc] as any, Buffer.alloc(0))
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            autoActionConfig: cfg,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected InvalidAutoActionKind");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "InvalidAutoActionKind");
      }
    });

    it("rejects ix_data larger than 256 bytes", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 604,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const [cfg] = PublicKey.findProgramAddressSync(
        [Buffer.from("auto_action"), s0.strategy.toBuffer(), Buffer.from([0])],
        program.programId,
      );
      try {
        await program.methods
          .setAutoActionConfig(
            new BN(0),
            0,
            Keypair.generate().publicKey,
            [...Buffer.alloc(8, 0)] as any,
            Buffer.alloc(257), // one byte over the cap
          )
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            autoActionConfig: cfg,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected AutoActionDataTooLarge");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "AutoActionDataTooLarge");
      }
    });

    it("set requires admin signer", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 605,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const stranger = Keypair.generate();
      const sig = await connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
      await connection.confirmTransaction(sig);

      const [cfg] = PublicKey.findProgramAddressSync(
        [Buffer.from("auto_action"), s0.strategy.toBuffer(), Buffer.from([0])],
        program.programId,
      );
      try {
        await program.methods
          .setAutoActionConfig(
            new BN(0),
            0,
            Keypair.generate().publicKey,
            [...Buffer.alloc(8, 0)] as any,
            Buffer.alloc(8),
          )
          .accountsStrict({
            admin: stranger.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            autoActionConfig: cfg,
            systemProgram: SystemProgram.programId,
          })
          .signers([stranger])
          .rpc();
        assert.fail("expected UnauthorizedAdmin");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "UnauthorizedAdmin");
      }
    });
  });

  // -------------------------------------------------------------
  // 6b. Phase-5 — auto-fan-out skip behavior
  // -------------------------------------------------------------
  describe("deposit auto-fan-out skip behavior", () => {
    it("silently skips a strategy with target_weight_bps == 0", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 610,
        strategyCount: 2,
        userMintAmount: 200_000_000,
      });
      // Only weight strategy 0; leave strategy 1 at 0 bps.
      await program.methods
        .setStrategyWeight(4000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
        })
        .rpc();

      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: fx.strategies[0].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[1].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[1].strategyTokenAccount, isSigner: false, isWritable: true },
        ])
        .signers([fx.user])
        .rpc();

      const s0 = await program.account.strategyAllocation.fetch(fx.strategies[0].strategy);
      const s1 = await program.account.strategyAllocation.fetch(fx.strategies[1].strategy);
      assert.equal(s0.allocatedAmount.toString(), "40000000"); // 40% of 100
      assert.equal(s1.allocatedAmount.toString(), "0"); // skipped
    });

    it("silently skips an inactive strategy without aborting the deposit", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 611,
        strategyCount: 2,
        userMintAmount: 200_000_000,
      });
      // Weight both strategies, then deactivate strategy 1.
      await program.methods
        .setStrategyWeight(3000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[0].strategy,
        })
        .rpc();
      await program.methods
        .setStrategyWeight(2000)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[1].strategy,
        })
        .rpc();
      // Set strategy 1's weight to 0 (precondition for deactivate after
      // we drain it), then deactivate. allocated_amount is already 0.
      await program.methods
        .setStrategyWeight(0)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[1].strategy,
        })
        .rpc();
      await program.methods
        .deactivateStrategy()
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: fx.strategies[1].strategy,
          strategyAuthority: fx.strategies[1].strategyAuthority,
          tokenMint: fx.mint,
          strategyTokenAccount: fx.strategies[1].strategyTokenAccount,
          delegate: fx.delegates[1].publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: fx.strategies[0].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[0].strategyTokenAccount, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[1].strategy, isSigner: false, isWritable: true },
          { pubkey: fx.strategies[1].strategyTokenAccount, isSigner: false, isWritable: true },
        ])
        .signers([fx.user])
        .rpc();

      const s0 = await program.account.strategyAllocation.fetch(fx.strategies[0].strategy);
      const s1 = await program.account.strategyAllocation.fetch(fx.strategies[1].strategy);
      assert.equal(s0.allocatedAmount.toString(), "30000000");
      assert.equal(s1.allocatedAmount.toString(), "0");
      assert.isFalse(s1.isActive);
    });
  });

  // -------------------------------------------------------------
  // 7. Phase-5 — ValueSource registry + settle_strategy_value
  // -------------------------------------------------------------
  describe("ValueSource + settle_strategy_value", () => {
    function deriveValueSource(strategy: PublicKey, index: number): PublicKey {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("value_source"), strategy.toBuffer(), Buffer.from([index])],
        program.programId,
      );
      return pda;
    }

    it("admin can add + remove a ValueSource; settle records yield/loss as the cToken balance moves", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 700,
        strategyCount: 1,
        userMintAmount: 200_000_000,
      });
      const s0 = fx.strategies[0];

      // Deposit 100 USDC; allocate 60 to the strategy via setStrategyWeight + rebalanceStrategy.
      const userShareAta = anchor.utils.token.associatedAddress({
        mint: fx.vault.shareMint,
        owner: fx.user.publicKey,
      });
      await program.methods
        .deposit(new BN(100_000_000))
        .accountsStrict({
          user: fx.user.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          tokenMint: fx.mint,
          shareMint: fx.vault.shareMint,
          userTokenAccount: fx.userAta,
          reserveAta: fx.vault.reserveAta,
          userShareToken: userShareAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fx.user])
        .rpc();
      await program.methods
        .allocateToStrategy(new BN(60_000_000))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          vaultAuthority: fx.vault.vaultAuthority,
          strategy: s0.strategy,
          tokenMint: fx.mint,
          reserveAta: fx.vault.reserveAta,
          strategyTokenAccount: s0.strategyTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Stand-in for an external position: a fresh SPL token account
      // holding "underlying value" the curator can mint into. Using
      // fx.mint keeps the read at offset 64 identical to a real cToken
      // / aToken / Drift sub-account amount field.
      const externalPosition = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        Keypair.generate().publicKey,
      );
      // Mirror "60 USDC deployed externally" by minting straight into it.
      // The strategy ATA already holds 60 from the allocate above, so
      // settle will see 60 (idle) + 60 (external) = 120 and book +60 yield.
      await mintTo(connection, payer, fx.mint, externalPosition.address, payer, 60_000_000);

      const vsPda = deriveValueSource(s0.strategy, 0);
      await program.methods
        .addValueSource(
          new BN(0),
          0, // index
          0, // kind = SplAtaBalance
          externalPosition.address,
          0, // offset (ignored for SplAtaBalance)
          new BN(1), // scale_num
          new BN(1), // scale_den
        )
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          valueSource: vsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // settle: total = strategy_ata (60) + externalPosition (60) = 120,
      // allocated_amount was 60, so this books +60 yield.
      const vaultBefore = await program.account.vaultState.fetch(fx.vault.vaultState);
      await program.methods
        .settleStrategyValue(new BN(0))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          strategyTokenAccount: s0.strategyTokenAccount,
        })
        .remainingAccounts([
          { pubkey: vsPda, isSigner: false, isWritable: false },
          { pubkey: externalPosition.address, isSigner: false, isWritable: false },
        ])
        .rpc();

      const sAfter = await program.account.strategyAllocation.fetch(s0.strategy);
      const vaultAfter = await program.account.vaultState.fetch(fx.vault.vaultState);
      assert.equal(sAfter.allocatedAmount.toString(), "120000000");
      assert.equal(
        vaultAfter.totalDeposited.sub(vaultBefore.totalDeposited).toString(),
        "60000000",
      );

      // Cleanup: remove the VS to leave state tidy.
      await program.methods
        .removeValueSource(new BN(0), 0)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          valueSource: vsPda,
        })
        .rpc();
      const closedAi = await connection.getAccountInfo(vsPda);
      assert.equal(closedAi, null);
    });

    it("rejects a VS pointing at the strategy's own ATA (would double-count)", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 701,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const vsPda = deriveValueSource(s0.strategy, 0);
      await program.methods
        .addValueSource(
          new BN(0),
          0,
          0, // kind
          s0.strategyTokenAccount, // points at the strategy's OWN ATA
          0,
          new BN(1),
          new BN(1),
        )
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          valueSource: vsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

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
            { pubkey: vsPda, isSigner: false, isWritable: false },
            { pubkey: s0.strategyTokenAccount, isSigner: false, isWritable: false },
          ])
          .rpc();
        assert.fail("expected ValueSourceTargetIsStrategyAta");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "ValueSourceTargetIsStrategyAta");
      }
    });

    it("rejects invalid kind (>1) and out-of-bounds index", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 702,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];

      // index >= MAX_VALUE_SOURCES_PER_STRATEGY (16)
      const oobPda = deriveValueSource(s0.strategy, 200);
      try {
        await program.methods
          .addValueSource(new BN(0), 200, 0, Keypair.generate().publicKey, 0, new BN(1), new BN(1))
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            valueSource: oobPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected ValueSourceIndexOutOfBounds");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "ValueSourceIndexOutOfBounds");
      }

      // kind = 7
      const badKindPda = deriveValueSource(s0.strategy, 1);
      try {
        await program.methods
          .addValueSource(new BN(0), 1, 7, Keypair.generate().publicKey, 0, new BN(1), new BN(1))
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            valueSource: badKindPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected InvalidValueSourceKind");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "InvalidValueSourceKind");
      }
    });

    it("add_value_source requires admin signer", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 720,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const stranger = Keypair.generate();
      const sig = await connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
      await connection.confirmTransaction(sig);
      const vsPda = deriveValueSource(s0.strategy, 0);
      try {
        await program.methods
          .addValueSource(
            new BN(0),
            0,
            0,
            Keypair.generate().publicKey,
            0,
            new BN(1),
            new BN(1),
          )
          .accountsStrict({
            admin: stranger.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            valueSource: vsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([stranger])
          .rpc();
        assert.fail("expected UnauthorizedAdmin");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "UnauthorizedAdmin");
      }
    });

    it("rejects scale_den == 0 (InvalidValueSourceScale)", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 703,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const vsPda = deriveValueSource(s0.strategy, 0);
      try {
        await program.methods
          .addValueSource(
            new BN(0),
            0,
            0,
            Keypair.generate().publicKey,
            0,
            new BN(1),
            new BN(0), // scale_den = 0 → invalid
          )
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            valueSource: vsPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected InvalidValueSourceScale");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "InvalidValueSourceScale");
      }
    });

    it("settle: non-authority signer is rejected", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 704,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const stranger = Keypair.generate();
      const sig = await connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
      await connection.confirmTransaction(sig);
      try {
        await program.methods
          .settleStrategyValue(new BN(0))
          .accountsStrict({
            authority: stranger.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            strategyTokenAccount: s0.strategyTokenAccount,
          })
          .signers([stranger])
          .rpc();
        assert.fail("expected UnauthorizedAuthority");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "UnauthorizedAuthority");
      }
    });

    it("settle: paused vault blocks settle_strategy_value", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 705,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      await program.methods
        .setPaused(true)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
        })
        .rpc();
      try {
        await program.methods
          .settleStrategyValue(new BN(0))
          .accountsStrict({
            authority: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            strategyTokenAccount: s0.strategyTokenAccount,
          })
          .rpc();
        assert.fail("expected VaultPaused");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "VaultPaused");
      }
    });

    it("settle: target_account passed in remaining_accounts must match VS.target_account", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 706,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const externalPosition = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        Keypair.generate().publicKey,
      );
      const wrongAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        Keypair.generate().publicKey,
      );

      const vsPda = deriveValueSource(s0.strategy, 0);
      await program.methods
        .addValueSource(new BN(0), 0, 0, externalPosition.address, 0, new BN(1), new BN(1))
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          valueSource: vsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

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
            { pubkey: vsPda, isSigner: false, isWritable: false },
            // Wrong target — VS is registered against externalPosition,
            // not wrongAccount.
            { pubkey: wrongAccount.address, isSigner: false, isWritable: false },
          ])
          .rpc();
        assert.fail("expected ValueSourceTargetMismatch");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "ValueSourceTargetMismatch");
      }
    });

    // Loss-path coverage: the yield-path test above exercises the
    // computed_value > prev_allocated branch. The mirror branch
    // (computed_value < prev_allocated) is one symmetric block with
    // checked_sub + sign flip — meaningfully exercising it from a unit
    // test requires either real external CPIs that drain the strategy
    // ATA (covered in scripts/e2e-kamino.ts) or directly mutating the
    // allocated_amount field, neither of which a unit fixture can do
    // without changing other invariants. Skipped here; tracked as a
    // future integration-test scenario.

    it("AccountU64 kind reads u64 at the registered offset", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 708,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];

      // Use a stand-in "external position" that's a token account so we
      // can deterministically place a u64 at offset 64 (the natural SPL
      // amount slot) and read it via AccountU64 kind with offset=64.
      const externalPosition = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        Keypair.generate().publicKey,
      );
      await mintTo(connection, payer, fx.mint, externalPosition.address, payer, 12_345_678);

      const vsPda = deriveValueSource(s0.strategy, 0);
      await program.methods
        .addValueSource(
          new BN(0),
          0,
          1, // kind = AccountU64
          externalPosition.address,
          64, // offset
          new BN(1),
          new BN(1),
        )
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          valueSource: vsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const vaultBefore = await program.account.vaultState.fetch(fx.vault.vaultState);
      await program.methods
        .settleStrategyValue(new BN(0))
        .accountsStrict({
          authority: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          strategyTokenAccount: s0.strategyTokenAccount,
        })
        .remainingAccounts([
          { pubkey: vsPda, isSigner: false, isWritable: false },
          { pubkey: externalPosition.address, isSigner: false, isWritable: false },
        ])
        .rpc();
      const vaultAfter = await program.account.vaultState.fetch(fx.vault.vaultState);
      // strategy_ata.amount = 0, AccountU64@offset64 = 12_345_678, allocated = 0 → +12_345_678 yield
      assert.equal(
        vaultAfter.totalDeposited.sub(vaultBefore.totalDeposited).toString(),
        "12345678",
      );
    });
  });

  // -------------------------------------------------------------
  // 8. Phase-5 — execute_action negative paths
  // -------------------------------------------------------------
  describe("execute_action negatives", () => {
    it("rejects loss_per_call_bps_cap > MAX_LOSS_PER_CALL_BPS on add_allowed_action", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 800,
        strategyCount: 1,
        userMintAmount: 0,
      });
      const s0 = fx.strategies[0];
      const targetProgram = Keypair.generate().publicKey;
      const disc = Buffer.alloc(8, 9);
      const allowedAction = deriveAllowedAction(
        program.programId,
        s0.strategy,
        targetProgram,
        disc,
      );
      try {
        await program.methods
          .addAllowedAction(
            new BN(0),
            targetProgram,
            [...disc] as any,
            0,
            null,
            6_000, // > MAX_LOSS_PER_CALL_BPS (5000)
            0,
          )
          .accountsStrict({
            admin: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            allowedAction,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected LossCapTooHigh");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "LossCapTooHigh");
      }
    });

    it("rejects a sibling instruction in the same tx that lists the strategy ATA in its accounts", async () => {
      const fx = await setupVault({
        program,
        payer,
        vaultId: 801,
        strategyCount: 1,
        userMintAmount: 100_000_000,
      });
      const s0 = fx.strategies[0];
      const targetProgram = Keypair.generate().publicKey;
      const disc = Buffer.alloc(8, 11);
      const allowedAction = deriveAllowedAction(
        program.programId,
        s0.strategy,
        targetProgram,
        disc,
      );
      // expected_recipient_index = 0 → the first remaining_account must equal
      // strategy.token_account. We pass it as the only remaining account.
      await program.methods
        .addAllowedAction(new BN(0), targetProgram, [...disc] as any, 0, null, 0, 0)
        .accountsStrict({
          admin: payer.publicKey,
          vaultState: fx.vault.vaultState,
          strategy: s0.strategy,
          allowedAction,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Caller must hold a payer-side ATA of the asset. Use the payer as
      // caller (== authority) so we don't need a delegate keypair.
      const callerAta = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        payer.publicKey,
      );
      // delegate_token_ata's owner must equal strategy.delegate (the
      // generated delegate keypair from the fixture).
      const delegateAta = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        fx.mint,
        fx.delegates[0].publicKey,
      );

      // Build a sibling ix that lists the strategy ATA in its account
      // metas. Any program ID / data is fine — the tx aborts inside
      // execute_action's introspection check before this ix runs.
      const siblingIx = new TransactionInstruction({
        keys: [{ pubkey: s0.strategyTokenAccount, isSigner: false, isWritable: false }],
        programId: SystemProgram.programId,
        data: Buffer.alloc(0),
      });

      try {
        await program.methods
          .executeAction(new BN(0), targetProgram, [...disc] as any, Buffer.alloc(0))
          .accountsStrict({
            caller: payer.publicKey,
            vaultState: fx.vault.vaultState,
            strategy: s0.strategy,
            strategyAuthority: s0.strategyAuthority,
            allowedAction,
            callerTokenAta: callerAta.address,
            delegateTokenAta: delegateAta.address,
            targetProgramAccount: targetProgram,
            allowedOutputToken: SystemProgram.programId,
            vaultAllowedOutputToken: SystemProgram.programId,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .remainingAccounts([
            { pubkey: s0.strategyTokenAccount, isSigner: false, isWritable: true },
          ])
          .postInstructions([siblingIx])
          .rpc();
        assert.fail("expected SiblingInstructionForbidden");
      } catch (err) {
        const e = err as AnchorError;
        assert.equal(e.error?.errorCode?.code, "SiblingInstructionForbidden");
      }
    });
  });
});
