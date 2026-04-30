// Tests for PDA derivation functions.
//
// PDAs (Program Derived Addresses) are deterministic Solana addresses computed
// from seeds + a program ID. The agent must derive the EXACT same PDAs as the
// on-chain Rust program, or account lookups will fail with "account not found."
//
// These tests verify:
// - Determinism: same inputs always produce the same address
// - Uniqueness: different inputs produce different addresses
// - Seed format correctness: u64 LE for vault/strategy IDs, u16 LE for action IDs
// - Off-curve: PDAs must not be valid ed25519 public keys (Solana requirement)

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  deriveVaultPda,
  deriveStrategyPda,
  deriveStrategyTokenPda,
  deriveAllowedActionPda,
} from "../../shared/vault-client.js";
import { PROGRAM_ID } from "../src/config.js";
import BN from "bn.js";

// USDC mainnet mint — used as a fixed, real-world pubkey for deterministic tests
const TEST_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

describe("PDA derivation", () => {
  describe("deriveVaultPda", () => {
    // PDAs are "off-curve" — they are NOT valid ed25519 public keys.
    // This is a Solana invariant: PDAs can only be used by programs, not wallets.
    // If isOnCurve returns true, the PDA derivation has a bug.
    it("produces a valid PDA on the ed25519 curve", () => {
      const pda = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    // Calling deriveVaultPda with the same inputs must always return the same address.
    // This is fundamental — if PDAs were non-deterministic, the agent couldn't
    // find the vault account it's supposed to manage.
    it("is deterministic — same inputs always produce the same PDA", () => {
      const pda1 = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);
      const pda2 = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);
      expect(pda1.equals(pda2)).toBe(true);
    });

    // The vault_id is part of the PDA seeds, so different IDs must produce
    // different addresses. This enables multiple vaults per token mint.
    it("different vault IDs produce different PDAs", () => {
      const pda0 = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);
      const pda1 = deriveVaultPda(TEST_MINT, 1, PROGRAM_ID);
      expect(pda0.equals(pda1)).toBe(false);
    });

    // The token_mint is part of the PDA seeds, so different mints must produce
    // different addresses. A USDC vault and a SOL vault are completely separate.
    it("different mints produce different PDAs", () => {
      const otherMint = new PublicKey("So11111111111111111111111111111111111111112");
      const pdaUsdc = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);
      const pdaSol = deriveVaultPda(otherMint, 0, PROGRAM_ID);
      expect(pdaUsdc.equals(pdaSol)).toBe(false);
    });

    // Cross-check: manually compute the PDA using raw findProgramAddressSync
    // with the exact seeds ["vault", mint, vault_id_u64_LE] and compare
    // against our helper function. This catches seed encoding bugs.
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
      const actual = deriveVaultPda(TEST_MINT, vaultId, PROGRAM_ID);
      expect(actual.equals(expected)).toBe(true);
    });
  });

  describe("deriveStrategyPda", () => {
    // Pre-derive the vault PDA so strategy tests use a realistic parent address.
    const vaultPda = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);

    // Same off-curve check as vault PDA.
    it("produces a valid off-curve PDA", () => {
      const pda = deriveStrategyPda(vaultPda, 0, PROGRAM_ID);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    });

    // Each strategy in a vault gets a unique sequential ID (0, 1, 2, ...).
    // Different IDs must produce different PDAs — no collisions.
    it("different strategy IDs produce different PDAs", () => {
      const pda0 = deriveStrategyPda(vaultPda, 0, PROGRAM_ID);
      const pda1 = deriveStrategyPda(vaultPda, 1, PROGRAM_ID);
      const pda2 = deriveStrategyPda(vaultPda, 2, PROGRAM_ID);
      expect(pda0.equals(pda1)).toBe(false);
      expect(pda1.equals(pda2)).toBe(false);
    });

    // Cross-check against manual derivation with seeds ["strategy", vault, id_u64_LE].
    it("matches manual derivation with correct seeds", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy"),
          vaultPda.toBuffer(),
          new BN(0).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      expect(deriveStrategyPda(vaultPda, 0, PROGRAM_ID).equals(expected)).toBe(true);
    });
  });

  describe("deriveStrategyTokenPda", () => {
    const vaultPda = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);

    // The strategy PDA and its token account PDA share the same vault + ID,
    // but differ in the seed prefix ("strategy" vs "strategy_token").
    // They MUST be different — one holds metadata, the other holds tokens.
    it("produces a different PDA than the strategy PDA for the same ID", () => {
      const strategyPda = deriveStrategyPda(vaultPda, 0, PROGRAM_ID);
      const tokenPda = deriveStrategyTokenPda(vaultPda, 0, PROGRAM_ID);
      expect(strategyPda.equals(tokenPda)).toBe(false);
    });

    // Cross-check against manual derivation with seeds ["strategy_token", vault, id_u64_LE].
    it("matches manual derivation", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_token"),
          vaultPda.toBuffer(),
          new BN(0).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      expect(deriveStrategyTokenPda(vaultPda, 0, PROGRAM_ID).equals(expected)).toBe(true);
    });
  });

  describe("deriveAllowedActionPda", () => {
    const vaultPda = deriveVaultPda(TEST_MINT, 0, PROGRAM_ID);
    const strategyPda = deriveStrategyPda(vaultPda, 0, PROGRAM_ID);

    // CRITICAL: AllowedAction uses u16 LE (2 bytes) for the action_id seed,
    // NOT u64 LE (8 bytes) like vault/strategy IDs. This matches the on-chain
    // Rust code where action_count is a u16. Using the wrong width would
    // derive completely different (wrong) PDAs.
    it("uses u16 LE for action ID (not u64)", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("allowed_action"),
          strategyPda.toBuffer(),
          new BN(0).toArrayLike(Buffer, "le", 2), // u16, not u64!
        ],
        PROGRAM_ID
      );
      expect(deriveAllowedActionPda(strategyPda, 0, PROGRAM_ID).equals(expected)).toBe(true);
    });

    // Same uniqueness check — different action IDs must produce different PDAs.
    it("different action IDs produce different PDAs", () => {
      const pda0 = deriveAllowedActionPda(strategyPda, 0, PROGRAM_ID);
      const pda1 = deriveAllowedActionPda(strategyPda, 1, PROGRAM_ID);
      expect(pda0.equals(pda1)).toBe(false);
    });

    // Edge case: action ID 256 = 0x0100. In u16 LE this is [0x00, 0x01].
    // If we accidentally used u8 (1 byte), 256 would overflow to 0x00 and
    // collide with action ID 0. This test catches that specific bug.
    it("action ID 256 works correctly with u16 encoding", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("allowed_action"),
          strategyPda.toBuffer(),
          new BN(256).toArrayLike(Buffer, "le", 2),
        ],
        PROGRAM_ID
      );
      expect(deriveAllowedActionPda(strategyPda, 256, PROGRAM_ID).equals(expected)).toBe(true);
    });
  });
});
