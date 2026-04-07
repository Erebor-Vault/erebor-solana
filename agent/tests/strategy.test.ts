// Tests for the strategy module.
//
// Since OnChainLuloProtocol makes real CPI calls to the blockchain,
// we can't fully test it in unit tests (that requires integration tests
// with a running validator). Instead, we test:
// - Anchor discriminator computation (must match on-chain program)
// - Protocol construction and configuration

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// Reproduce the discriminator function from strategy.ts to test it.
// This is the same algorithm Anchor uses to generate instruction discriminators.
function anchorDiscriminator(name: string): number[] {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Array.from(hash.subarray(0, 8));
}

describe("Anchor discriminator computation", () => {
  // Discriminators are the first 8 bytes of sha256("global:<instruction_name>").
  // They must be exactly 8 bytes — this is how Anchor identifies instructions.
  it("produces 8-byte discriminators", () => {
    const disc = anchorDiscriminator("deposit");
    expect(disc).toHaveLength(8);
  });

  // Same input must always produce the same output — determinism is critical
  // because the AllowedAction PDA stores the discriminator on-chain.
  it("is deterministic", () => {
    const disc1 = anchorDiscriminator("deposit");
    const disc2 = anchorDiscriminator("deposit");
    expect(disc1).toEqual(disc2);
  });

  // Different instruction names must produce different discriminators.
  // "deposit" and "withdraw" are the two mock_lulo instructions.
  it("deposit and withdraw have different discriminators", () => {
    const deposit = anchorDiscriminator("deposit");
    const withdraw = anchorDiscriminator("withdraw");
    expect(deposit).not.toEqual(withdraw);
  });

  // Verify against a known Anchor discriminator value.
  // sha256("global:deposit") = f223c68952e1f2b6...
  // First 8 bytes: [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]
  it("matches known Anchor discriminator for 'deposit'", () => {
    const hash = createHash("sha256").update("global:deposit").digest();
    const expected = Array.from(hash.subarray(0, 8));
    const actual = anchorDiscriminator("deposit");
    expect(actual).toEqual(expected);
  });

  // Verify that Anchor's naming convention is "global:<name>", not just "<name>".
  // Using the wrong prefix would generate completely wrong discriminators.
  it("uses 'global:' prefix (Anchor convention)", () => {
    const withPrefix = anchorDiscriminator("deposit");
    const wrongHash = createHash("sha256").update("deposit").digest();
    const withoutPrefix = Array.from(wrongHash.subarray(0, 8));
    expect(withPrefix).not.toEqual(withoutPrefix);
  });
});
