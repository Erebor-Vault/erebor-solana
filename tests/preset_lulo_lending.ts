// tests/preset_lulo_lending.ts
// E2E test: apply the Lulo Lending preset to a fresh strategy on a local
// validator and verify that detectActivePreset correctly labels the result.

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import type { MyProject } from "../target/types/my_project";
import {
  setupVault,
} from "./helpers/fixtures";
import {
  LULO_LENDING,
  PRESETS,
} from "../app/src/lib/strategy-presets/presets";
import type { PresetBuildContext } from "../app/src/lib/strategy-presets/presets";
import {
  detectActivePreset,
} from "../app/src/lib/strategy-presets/diff";
import type { StrategySnapshot } from "../app/src/lib/strategy-presets/diff";

// ---------------------------------------------------------------------------
// fetchSnapshot — hand-rolled (no React hooks)
// ---------------------------------------------------------------------------

async function fetchSnapshot(
  program: anchor.Program<MyProject>,
  strategy: PublicKey
): Promise<StrategySnapshot> {
  // Allowed actions: filter by strategy at offset 8+32 (after disc + vault)
  const allowedActionAccounts = await (program.account as any).allowedAction.all([
    {
      memcmp: {
        offset: 8 + 32, // skip discriminator(8) + vault(32) → land on strategy
        bytes: strategy.toBase58(),
      },
    },
  ]);
  const allowedActions = allowedActionAccounts.map((a: any) => ({
    targetProgram: a.account.targetProgram as PublicKey,
    discriminator: Array.from(a.account.discriminator) as number[],
  }));

  // Auto-action configs: kind 0 and 1
  const autoActions: { kind: 0 | 1 }[] = [];
  for (const kind of [0, 1] as const) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("auto_action"), strategy.toBuffer(), Buffer.from([kind])],
      program.programId
    );
    const info = await program.provider.connection.getAccountInfo(pda);
    if (info) autoActions.push({ kind });
  }

  // Value sources: slots 0..15
  const valueSources: { index: number; kind: 0 | 1 | 2 }[] = [];
  for (let index = 0; index < 16; index++) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("value_source"), strategy.toBuffer(), Buffer.from([index])],
      program.programId
    );
    const info = await program.provider.connection.getAccountInfo(pda);
    if (info && info.data.length > 0) {
      // Layout: disc(8) + vault(32) + strategy(32) + strategy_id:u64(8) + index:u8(1) + kind:u8(1)
      // offset of kind = 8 + 32 + 32 + 8 + 1 = 81
      const kindByte = info.data[81] as 0 | 1 | 2;
      valueSources.push({ index, kind: kindByte });
    }
  }

  return { allowedActions, autoActions, valueSources };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Lulo Lending preset (e2e)", function () {
  this.timeout(120_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MyProject as anchor.Program<MyProject>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let fx: Awaited<ReturnType<typeof setupVault>>;
  let strategyPda: PublicKey;
  let strategyId: BN;

  before(async () => {
    // vaultId=81 — distinct from all other test suites
    fx = await setupVault({
      program,
      payer: admin,
      vaultId: 81,
      strategyCount: 1,
    });
    strategyId = new BN(0);
    strategyPda = fx.strategies[0].strategy;
  });

  it("applies the preset and is detected as lulo_lending", async () => {
    const underlying = await getMint(provider.connection, fx.mint);

    const ctx: PresetBuildContext = {
      connection: provider.connection,
      program,
      cluster: "devnet", // picks PROTOCOL_REGISTRY.devnet → mock_lulo
      admin: admin.publicKey,
      vaultState: fx.vault.vaultState,
      vault: fx.vault.vaultState,
      strategyId,
      strategy: strategyPda,
      strategyTokenAccount: fx.strategies[0].strategyTokenAccount,
      strategyAuthority: fx.strategies[0].strategyAuthority,
      underlyingDecimals: underlying.decimals,
      // kaminoObligation not needed for Lulo
    };

    const ixs = await LULO_LENDING.buildIxs(ctx);
    // 2 allowed_action + 2 auto_action_config + 0 value_source = 4
    expect(ixs).to.have.lengthOf(4);

    // Submit each ix as its own tx (mirrors useAdminActions / Stage C1)
    for (const ix of ixs) {
      const tx = new anchor.web3.Transaction().add(ix);
      await provider.sendAndConfirm(tx, [admin]);
    }

    // Build snapshot from on-chain state
    const snapshot = await fetchSnapshot(program, strategyPda);

    // Build presetRowsByName for detectActivePreset
    const presetRowsByName: Record<string, any> = {};
    for (const p of PRESETS) {
      try {
        presetRowsByName[p.name] = await p.buildRows(ctx);
      } catch {
        presetRowsByName[p.name] = [];
      }
    }

    const detected = await detectActivePreset(snapshot, presetRowsByName as any);
    expect(detected).to.equal("lulo_lending");
  });
});
