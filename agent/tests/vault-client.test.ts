// Tests for PDA derivation functions.
// Verifies that the agent derives the exact same PDAs as the on-chain program
// by comparing against known seeds and ensuring consistency between calls.

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  deriveVaultPda,
  deriveStrategyPda,
  deriveStrategyTokenPda,
  deriveAllowedActionPda,
} from "../src/vault-client.js";
import { PROGRAM_ID } from "../src/config.js";
import BN from "bn.js";

// A fixed mint pubkey for deterministic tests
const TEST_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC mainnet

describe("PDA derivation", () => {
  describe("deriveVaultPda", () => {
    it("produces a valid PDA on the ed25519 curve", () => {
      const pda = deriveVaultPda(TEST_MINT, 0);
      // PDAs are off-curve points — PublicKey.isOnCurve should be false
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("is deterministic — same inputs always produce the same PDA", () => {
      const pda1 = deriveVaultPda(TEST_MINT, 0);
      const pda2 = deriveVaultPda(TEST_MINT, 0);
      expect(pda1.equals(pda2)).toBe(true);
    });

    it("different vault IDs produce different PDAs", () => {
      const pda0 = deriveVaultPda(TEST_MINT, 0);
      const pda1 = deriveVaultPda(TEST_MINT, 1);
      expect(pda0.equals(pda1)).toBe(false);
    });

    it("different mints produce different PDAs", () => {
      const otherMint = new PublicKey("So11111111111111111111111111111111111111112");
      const pdaUsdc = deriveVaultPda(TEST_MINT, 0);
      const pdaSol = deriveVaultPda(otherMint, 0);
      expect(pdaUsdc.equals(pdaSol)).toBe(false);
    });

    it("matches manual derivation with correct seeds", () => {
      const vaultId = 0;
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          TEST_MINT.toBuffer(),
          new BN(vaultId).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      const actual = deriveVaultPda(TEST_MINT, vaultId);
      expect(actual.equals(expected)).toBe(true);
    });
  });

  describe("deriveStrategyPda", () => {
    const vaultPda = deriveVaultPda(TEST_MINT, 0);

    it("produces a valid off-curve PDA", () => {
      const pda = deriveStrategyPda(vaultPda, 0);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    it("different strategy IDs produce different PDAs", () => {
      const pda0 = deriveStrategyPda(vaultPda, 0);
      const pda1 = deriveStrategyPda(vaultPda, 1);
      const pda2 = deriveStrategyPda(vaultPda, 2);
      expect(pda0.equals(pda1)).toBe(false);
      expect(pda1.equals(pda2)).toBe(false);
    });

    it("matches manual derivation with correct seeds", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy"),
          vaultPda.toBuffer(),
          new BN(0).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      expect(deriveStrategyPda(vaultPda, 0).equals(expected)).toBe(true);
    });
  });

  describe("deriveStrategyTokenPda", () => {
    const vaultPda = deriveVaultPda(TEST_MINT, 0);

    it("produces a different PDA than the strategy PDA for the same ID", () => {
      // strategy and strategy_token seeds differ ("strategy" vs "strategy_token")
      const strategyPda = deriveStrategyPda(vaultPda, 0);
      const tokenPda = deriveStrategyTokenPda(vaultPda, 0);
      expect(strategyPda.equals(tokenPda)).toBe(false);
    });

    it("matches manual derivation", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_token"),
          vaultPda.toBuffer(),
          new BN(0).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      expect(deriveStrategyTokenPda(vaultPda, 0).equals(expected)).toBe(true);
    });
  });

  describe("deriveAllowedActionPda", () => {
    const vaultPda = deriveVaultPda(TEST_MINT, 0);
    const strategyPda = deriveStrategyPda(vaultPda, 0);

    it("uses u16 LE for action ID (not u64)", () => {
      // The on-chain program uses action_count as u16 in the seed.
      // Verify our derivation matches u16 LE encoding.
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("allowed_action"),
          strategyPda.toBuffer(),
          new BN(0).toArrayLike(Buffer, "le", 2), // u16, not u64!
        ],
        PROGRAM_ID
      );
      expect(deriveAllowedActionPda(strategyPda, 0).equals(expected)).toBe(true);
    });

    it("different action IDs produce different PDAs", () => {
      const pda0 = deriveAllowedActionPda(strategyPda, 0);
      const pda1 = deriveAllowedActionPda(strategyPda, 1);
      expect(pda0.equals(pda1)).toBe(false);
    });

    it("action ID 256 works correctly with u16 encoding", () => {
      // 256 = 0x0100 in LE → [0x00, 0x01]
      // This would break if we accidentally used u8 encoding
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("allowed_action"),
          strategyPda.toBuffer(),
          new BN(256).toArrayLike(Buffer, "le", 2),
        ],
        PROGRAM_ID
      );
      expect(deriveAllowedActionPda(strategyPda, 256).equals(expected)).toBe(true);
    });
  });
});
