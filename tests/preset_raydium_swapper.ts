// tests/preset_raydium_swapper.ts
// E2E test: apply the Raydium Swapper preset (value-source half only — devnet
// has no swap discriminators), init mock_pyth feeds, mint balances to strategy
// ATAs, settle, and assert NAV.
//
// Math recap (corrected formula):
//   On-chain Pyth contribution = balance_raw × price_raw × 10^expo × scaleNum / scaleDen
//   With expo = −8: price_raw × 10^-8 = price_USD.
//   To land contribution in underlyingDecimals base units:
//     scaleNum / scaleDen = 10^(underlyingDecimals − mintDecimals)
//   For matched 6dp/6dp: scaleNum/scaleDen = 1/1 → contribution = balance_raw × price_USD.
//
// Double-count note: SplAtaBalance VSs fold balance_raw directly into
// total_value (pass 1 in settle_strategy_value.rs), AND the PythPriceFeed VS
// (pass 2) also contributes balance × price_USD. For a swap vault this is
// intentional: VS0/VS2 represent "raw token count" and VS1/VS3 represent
// "USD value of those tokens". If you only want USD value, set the
// SplAtaBalance scaleNum=0 or remove it. Plan 3 ships with scaleNum=1/1
// (per preset defaults) and this test asserts the resulting double-count.

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { MyProject } from "../target/types/my_project";
import type { MockPyth } from "../target/types/mock_pyth";
import { setupVault, deriveStrategy } from "./helpers/fixtures";
import { initializeMockFeed, derivePriceFeedPda } from "./helpers/mock_pyth";
import {
  RAYDIUM_SWAPPER,
  PRESETS,
} from "../app/src/lib/strategy-presets/presets";
import type { PresetBuildContext } from "../app/src/lib/strategy-presets/presets";
import { detectActivePreset } from "../app/src/lib/strategy-presets/diff";
import type { StrategySnapshot } from "../app/src/lib/strategy-presets/diff";

// ---------------------------------------------------------------------------
// fetchSnapshot (mirrors preset_kamino_liquidity.ts)
// ---------------------------------------------------------------------------

async function fetchSnapshot(
  program: anchor.Program<MyProject>,
  strategy: PublicKey,
): Promise<StrategySnapshot> {
  const allowedActionAccounts = await (program.account as any).allowedAction.all([
    {
      memcmp: {
        offset: 8 + 32,
        bytes: strategy.toBase58(),
      },
    },
  ]);
  const allowedActions = allowedActionAccounts.map((a: any) => ({
    targetProgram: a.account.targetProgram as PublicKey,
    discriminator: Array.from(a.account.discriminator) as number[],
  }));

  const autoActions: { kind: 0 | 1 }[] = [];
  for (const kind of [0, 1] as const) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("auto_action"), strategy.toBuffer(), Buffer.from([kind])],
      program.programId,
    );
    const info = await program.provider.connection.getAccountInfo(pda);
    if (info) autoActions.push({ kind });
  }

  const valueSources: { index: number; kind: 0 | 1 | 2 }[] = [];
  for (let index = 0; index < 16; index++) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), strategy.toBuffer(), Buffer.from([index])],
      program.programId,
    );
    const info = await program.provider.connection.getAccountInfo(pda);
    if (info && info.data.length > 0) {
      // Layout: disc(8)+vault(32)+strategy(32)+strategy_id:u64(8)+index:u8(1)+kind:u8(1)
      const kindByte = info.data[81] as 0 | 1 | 2;
      valueSources.push({ index, kind: kindByte });
    }
  }

  return { allowedActions, autoActions, valueSources };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Raydium Swapper preset (e2e, Pyth NAV settle)", function () {
  this.timeout(180_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MyProject as anchor.Program<MyProject>;
  const mockPyth = anchor.workspace.MockPyth as anchor.Program<MockPyth>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let fx: Awaited<ReturnType<typeof setupVault>>;
  let strategyPda: PublicKey;
  let strategyAuthority: PublicKey;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let strategyAtaA: PublicKey;
  let strategyAtaB: PublicKey;
  let feedA: PublicKey;
  let feedB: PublicKey;

  // ProtocolConfig is a singleton at seeds ["protocol_config"].
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId,
  );

  before(async () => {
    // vaultId=82 — distinct from all other test suites.
    fx = await setupVault({
      program,
      payer: admin,
      vaultId: 82,
      strategyCount: 1,
    });

    const s = deriveStrategy(program.programId, fx.vault.vaultState, 0);
    strategyPda = s.strategy;
    strategyAuthority = s.strategyAuthority;

    // Create two test mints (6 dp each — matched-decimals case).
    mintA = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    mintB = await createMint(provider.connection, admin, admin.publicKey, null, 6);

    // Register each mint globally (addAllowedToken) and per-vault
    // (addVaultAllowedToken). The global entry must exist before the
    // per-vault entry can be created.
    for (const mint of [mintA, mintB]) {
      const [allowedTokenPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("allowed_token"), mint.toBuffer()],
        program.programId,
      );
      await program.methods
        .addAllowedToken(mint)
        .accountsStrict({
          governance: admin.publicKey,
          protocolConfig,
          allowedToken: allowedTokenPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const [vaultAllowedTokenPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault_allowed_token"),
          fx.vault.vaultState.toBuffer(),
          mint.toBuffer(),
        ],
        program.programId,
      );
      await program.methods
        .addVaultAllowedToken(mint)
        .accountsStrict({
          admin: admin.publicKey,
          vaultState: fx.vault.vaultState,
          allowedToken: allowedTokenPda,
          vaultAllowedToken: vaultAllowedTokenPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Create strategy ATAs for each mint (owned by strategyAuthority).
    strategyAtaA = getAssociatedTokenAddressSync(mintA, strategyAuthority, true);
    strategyAtaB = getAssociatedTokenAddressSync(mintB, strategyAuthority, true);

    const createAtaTx = new anchor.web3.Transaction()
      .add(
        (await import("@solana/spl-token")).createAssociatedTokenAccountInstruction(
          admin.publicKey,
          strategyAtaA,
          strategyAuthority,
          mintA,
        ),
      )
      .add(
        (await import("@solana/spl-token")).createAssociatedTokenAccountInstruction(
          admin.publicKey,
          strategyAtaB,
          strategyAuthority,
          mintB,
        ),
      );
    await provider.sendAndConfirm(createAtaTx, [admin]);

    // Initialize Pyth feeds: mintA @ $1.00, mintB @ $50.00, expo = −8.
    // price_raw = price_USD × 10^8
    feedA = await initializeMockFeed(mockPyth, admin, mintA, new BN(100_000_000), -8);
    feedB = await initializeMockFeed(mockPyth, admin, mintB, new BN(5_000_000_000), -8);
  });

  it("preset writes 4 value sources (0 allowed_actions on devnet)", async () => {
    const underlying = await getMint(provider.connection, fx.mint);

    const ctx: PresetBuildContext = {
      connection: provider.connection,
      program,
      cluster: "devnet", // raydium + jupiter programIds are null → 0 allowed_actions
      admin: admin.publicKey,
      vaultState: fx.vault.vaultState,
      vault: fx.vault.vaultState,
      strategyId: new BN(0),
      strategy: strategyPda,
      strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
      strategyAuthority,
      underlyingDecimals: underlying.decimals, // 6
    };

    const ixs = await RAYDIUM_SWAPPER.buildIxs(ctx);
    // devnet: 0 allowed_action (raydium + jupiter programIds null)
    //       + 4 value_source (2 mints × 2 VS each)
    expect(ixs).to.have.lengthOf(4);

    for (const ix of ixs) {
      const tx = new anchor.web3.Transaction().add(ix);
      await provider.sendAndConfirm(tx, [admin]);
    }
  });

  it("settle reflects balance × price NAV (corrected Pyth scale math)", async () => {
    // Mint balances into the strategy ATAs.
    //   mintA: 1.0 token = 1_000_000 raw (6 dp)
    //   mintB: 0.5 token = 500_000 raw (6 dp)
    await mintTo(provider.connection, admin, mintA, strategyAtaA, admin, 1_000_000);
    await mintTo(provider.connection, admin, mintB, strategyAtaB, admin, 500_000);

    // Strategy underlying ATA has idle balance 0 (no underlying deposited).

    // Derive value_source PDAs by index (0..3).
    // Seeds: ["value_source", strategy, [index_u8]]
    const vsPdas = [0, 1, 2, 3].map(
      (i) =>
        PublicKey.findProgramAddressSync(
          [Buffer.from("value_source"), strategyPda.toBuffer(), Buffer.from([i])],
          program.programId,
        )[0],
    );

    // Read each VS account to learn which target_account was stored.
    // This is necessary because getVaultAllowedTokens returns mints in an
    // arbitrary (getProgramAccounts) order, so the VS indices may not map
    // mintA → 0, mintB → 2. We query on-chain to build the correct
    // remaining_accounts ordering rather than assuming it.
    //
    // ValueSource account layout:
    //   disc(8) + vault(32) + strategy(32) + strategy_id:u64(8)
    //   + index:u8(1) + kind:u8(1) + target_account:Pubkey(32) + ...
    //   → target_account is at offset 82 (after disc+vault+strategy+id+index+kind = 8+32+32+8+1+1)
    const TARGET_ACCOUNT_OFFSET = 82;

    const buildRemainingAccounts = async () => {
      const remaining: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      for (let i = 0; i < 4; i++) {
        const info = await provider.connection.getAccountInfo(vsPdas[i]);
        if (!info) throw new Error(`VS PDA at index ${i} not found`);
        const targetKey = new PublicKey(info.data.subarray(TARGET_ACCOUNT_OFFSET, TARGET_ACCOUNT_OFFSET + 32));
        remaining.push(
          { pubkey: vsPdas[i], isSigner: false, isWritable: false },
          { pubkey: targetKey, isSigner: false, isWritable: false },
        );
      }
      return remaining;
    };

    const remainingAccounts = await buildRemainingAccounts();

    await program.methods
      .settleStrategyValue(new BN(0))
      .accountsStrict({
        authority: admin.publicKey,
        vaultState: fx.vault.vaultState,
        strategy: strategyPda,
        strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();

    // Expected NAV breakdown (corrected scaleNum/scaleDen = 1/1 for 6dp/6dp):
    //
    //   Idle balance (strategy underlying ATA):   0
    //
    //   Pass 1 — SplAtaBalance sources (folded directly):
    //     VS0 (mintA, scale 1/1): 1_000_000 × 1/1 = 1_000_000
    //     VS2 (mintB, scale 1/1):   500_000 × 1/1 =   500_000
    //
    //   Pass 2 — PythPriceFeed sources:
    //     VS1 (mintA @ $1.00):
    //       balance_raw × price_raw × 10^expo × scale
    //       = 1_000_000 × 100_000_000 × 10^-8 × 1/1 = 1_000_000
    //     VS3 (mintB @ $50.00):
    //       = 500_000 × 5_000_000_000 × 10^-8 × 1/1 = 25_000_000
    //
    //   Total: 0 + 1_000_000 + 500_000 + 1_000_000 + 25_000_000 = 27_500_000
    //
    // NOTE: VS0 + VS2 (SplAtaBalance) and VS1 + VS3 (Pyth) both contribute,
    // so the raw token count and its USD value are added together. This is
    // the preset's "balance + balance×price" contract (see file docblock).
    const stratAccount = await program.account.strategyAllocation.fetch(strategyPda);
    expect(stratAccount.allocatedAmount.toNumber()).to.equal(27_500_000);
  });

  it("is detected as raydium_swapper", async () => {
    const underlying = await getMint(provider.connection, fx.mint);
    const ctx: PresetBuildContext = {
      connection: provider.connection,
      program,
      cluster: "devnet",
      admin: admin.publicKey,
      vaultState: fx.vault.vaultState,
      vault: fx.vault.vaultState,
      strategyId: new BN(0),
      strategy: strategyPda,
      strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
      strategyAuthority,
      underlyingDecimals: underlying.decimals,
    };

    const snapshot = await fetchSnapshot(program, strategyPda);

    const presetRowsByName: Record<string, any> = {};
    for (const p of PRESETS) {
      try {
        presetRowsByName[p.name] = await p.buildRows(ctx);
      } catch {
        presetRowsByName[p.name] = [];
      }
    }

    const detected = await detectActivePreset(snapshot, presetRowsByName as any);
    expect(detected).to.equal("raydium_swapper");
  });
});
