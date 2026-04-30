// Tests for the chain/vault.ts builders. Pure offline checks — no RPC.
//
// Verifies the four kamino discriminators match Anchor's
// sha256("global:<method_name>")[..8] convention, the AllowedAction PDA
// derivation is deterministic and seed-correct, and the recipient indices
// match the documented per-action remaining_accounts ordering.

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import {
  KAMINO_DEPOSIT_DISCRIMINATOR,
  KAMINO_DEPOSIT_IX_NAME,
  KAMINO_WITHDRAW_DISCRIMINATOR,
  KAMINO_WITHDRAW_IX_NAME,
  KAMINO_BORROW_DISCRIMINATOR,
  KAMINO_BORROW_IX_NAME,
  KAMINO_REPAY_DISCRIMINATOR,
  KAMINO_REPAY_IX_NAME,
  KAMINO_RECIPIENT_INDEX,
  anchorDiscriminator,
} from "../src/chain/vault.js";
import { deriveAllowedActionPda } from "../../shared/vault-client.js";

function expectedDisc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

describe("anchorDiscriminator", () => {
  // The four kamino instruction names must hash to exactly the bytes the
  // looper precomputes. If these drift, every execute_action call against
  // the corresponding AllowedAction PDA will revert with ActionNotAllowed.
  it("matches Anchor's global-namespace SHA-256 prefix", () => {
    expect(KAMINO_DEPOSIT_DISCRIMINATOR.equals(expectedDisc(KAMINO_DEPOSIT_IX_NAME))).toBe(true);
    expect(KAMINO_WITHDRAW_DISCRIMINATOR.equals(expectedDisc(KAMINO_WITHDRAW_IX_NAME))).toBe(true);
    expect(KAMINO_BORROW_DISCRIMINATOR.equals(expectedDisc(KAMINO_BORROW_IX_NAME))).toBe(true);
    expect(KAMINO_REPAY_DISCRIMINATOR.equals(expectedDisc(KAMINO_REPAY_IX_NAME))).toBe(true);
  });

  // Discriminators are 8 bytes — the AllowedAction PDA seeds rely on this.
  it("returns 8 bytes", () => {
    expect(anchorDiscriminator("anything").length).toBe(8);
  });
});

describe("deriveAllowedActionPda", () => {
  // Synthetic but valid pubkeys. The PDA is deterministic in the seed
  // tuple, so identical inputs must produce identical outputs.
  const strategy = new PublicKey("11111111111111111111111111111112");
  const kaminoProgram = new PublicKey("HLDVeTCx7mJeHApCpDptwbHd78iLCPYrFnVAymjrANp2");
  const vaultProgram = new PublicKey("DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B");

  it("is deterministic for identical inputs", () => {
    const a = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_DEPOSIT_DISCRIMINATOR, vaultProgram);
    const b = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_DEPOSIT_DISCRIMINATOR, vaultProgram);
    expect(a.equals(b)).toBe(true);
  });

  // Each instruction name yields a distinct PDA.
  it("yields distinct PDAs for distinct discriminators", () => {
    const dep = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_DEPOSIT_DISCRIMINATOR, vaultProgram);
    const wit = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_WITHDRAW_DISCRIMINATOR, vaultProgram);
    const bor = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_BORROW_DISCRIMINATOR, vaultProgram);
    const rep = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_REPAY_DISCRIMINATOR, vaultProgram);
    const set = new Set([dep, wit, bor, rep].map((k) => k.toBase58()));
    expect(set.size).toBe(4);
  });

  it("rejects non-8-byte discriminators", () => {
    expect(() =>
      deriveAllowedActionPda(strategy, kaminoProgram, [1, 2, 3], vaultProgram)
    ).toThrow();
  });

  // Accepts both number[] and Uint8Array forms — the helper widens them.
  it("accepts number[] and Uint8Array forms equivalently", () => {
    const arr = Array.from(KAMINO_DEPOSIT_DISCRIMINATOR);
    const a = deriveAllowedActionPda(strategy, kaminoProgram, arr, vaultProgram);
    const b = deriveAllowedActionPda(strategy, kaminoProgram, KAMINO_DEPOSIT_DISCRIMINATOR, vaultProgram);
    expect(a.equals(b)).toBe(true);
  });
});

describe("KAMINO_RECIPIENT_INDEX", () => {
  // The recipient index is what add_allowed_action(...) is called with at
  // setup time and is enforced by the vault on every execute_action — so the
  // builder's per-action remaining_accounts must keep strategy.token_account
  // at exactly these slots:
  //   deposit:  source_liquidity at slot 0
  //   withdraw: destination_liquidity at slot 1
  //   borrow:   destination_liquidity at slot 4
  //   repay:    source_liquidity at slot 4
  it("documents the per-action strategy-ATA slot", () => {
    expect(KAMINO_RECIPIENT_INDEX.deposit).toBe(0);
    expect(KAMINO_RECIPIENT_INDEX.withdraw).toBe(1);
    expect(KAMINO_RECIPIENT_INDEX.borrow).toBe(4);
    expect(KAMINO_RECIPIENT_INDEX.repay).toBe(4);
  });
});
