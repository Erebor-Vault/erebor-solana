// Tests for MockLuloProtocol.
//
// MockLuloProtocol simulates the Lulo lending protocol entirely in memory.
// It's used on devnet where real Lulo is not deployed. These tests verify:
// - Initial state is zero (no funds lent)
// - LEND increases the lent balance by the exact amount
// - WITHDRAW decreases it, clamped to zero (can't go negative)
// - HOLD has no side effects
// - Full lifecycle works correctly across multiple operations

import { describe, it, expect } from "vitest";
import { MockLuloProtocol } from "../src/strategy.js";

describe("MockLuloProtocol", () => {
  describe("initial state", () => {
    // A freshly created protocol instance should have nothing lent.
    // This matches the real scenario where a new strategy has no Lulo position.
    it("starts with zero lent balance", async () => {
      const protocol = new MockLuloProtocol();
      expect(await protocol.getLentBalance()).toBe(0);
    });

    // The mock yield simulates ~5% APY with ±0.5% randomization.
    // Verify it stays within the expected range.
    it("returns a yield between 4% and 6%", async () => {
      const protocol = new MockLuloProtocol();
      const yieldRate = await protocol.getCurrentYield();
      expect(yieldRate).toBeGreaterThan(0.04);
      expect(yieldRate).toBeLessThan(0.06);
    });
  });

  describe("LEND action", () => {
    // After lending 5 USDC (5M micro-USDC), the balance should be exactly 5M.
    // This verifies the basic deposit tracking.
    it("increases lent balance by the amount", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 5_000_000 });
      expect(await protocol.getLentBalance()).toBe(5_000_000);
    });

    // Multiple LEND calls should accumulate — lending 3 + 2 = 5 USDC total.
    // This matches real Lulo behavior where you can deposit incrementally.
    it("accumulates across multiple lends", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 3_000_000 });
      await protocol.execute({ action: "LEND", amount: 2_000_000 });
      expect(await protocol.getLentBalance()).toBe(5_000_000);
    });

    // Every execute() call returns a transaction signature.
    // In mock mode, it's a fake sig with the format "mock-tx-{timestamp}".
    // The monitor loop logs this for debugging.
    it("returns a mock transaction signature", async () => {
      const protocol = new MockLuloProtocol();
      const sig = await protocol.execute({ action: "LEND", amount: 1_000_000 });
      expect(sig).toMatch(/^mock-tx-\d+$/);
    });
  });

  describe("WITHDRAW action", () => {
    // After lending 5M then withdrawing 2M, balance should be 3M.
    // Basic arithmetic check on the withdrawal tracking.
    it("decreases lent balance", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 5_000_000 });
      await protocol.execute({ action: "WITHDRAW", amount: 2_000_000 });
      expect(await protocol.getLentBalance()).toBe(3_000_000);
    });

    // Edge case: withdrawing more than what's lent should clamp to zero,
    // not go negative. In real Lulo, you can't withdraw more than your deposit.
    // The mock uses Math.min(requested, lentAmount) to enforce this.
    it("cannot withdraw more than lent — clamps to zero", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 1_000_000 });
      await protocol.execute({ action: "WITHDRAW", amount: 5_000_000 });
      expect(await protocol.getLentBalance()).toBe(0);
    });

    // Withdrawing when nothing is lent should be a no-op — balance stays at 0.
    it("withdraw with zero lent does nothing", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "WITHDRAW", amount: 1_000_000 });
      expect(await protocol.getLentBalance()).toBe(0);
    });
  });

  describe("HOLD action", () => {
    // HOLD means "do nothing this cycle." The lent balance must not change.
    // This verifies that the HOLD code path has no side effects on state.
    it("does not change lent balance", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 3_000_000 });
      await protocol.execute({ action: "HOLD", reason: "waiting" });
      expect(await protocol.getLentBalance()).toBe(3_000_000);
    });
  });

  describe("full lifecycle", () => {
    // Simulates a realistic sequence of agent decisions over time:
    // 1. Lend 10 USDC (initial deployment)
    // 2. Partial withdraw 3 USDC (yield dropped, reduce exposure)
    // 3. Lend 5 more USDC (new funds allocated by authority)
    // 4. Full withdraw 12 USDC (strategy being wound down)
    // Each step checks the running balance.
    it("lend → partial withdraw → lend more → full withdraw", async () => {
      const protocol = new MockLuloProtocol();

      await protocol.execute({ action: "LEND", amount: 10_000_000 });
      expect(await protocol.getLentBalance()).toBe(10_000_000);

      await protocol.execute({ action: "WITHDRAW", amount: 3_000_000 });
      expect(await protocol.getLentBalance()).toBe(7_000_000);

      await protocol.execute({ action: "LEND", amount: 5_000_000 });
      expect(await protocol.getLentBalance()).toBe(12_000_000);

      await protocol.execute({ action: "WITHDRAW", amount: 12_000_000 });
      expect(await protocol.getLentBalance()).toBe(0);
    });
  });
});
