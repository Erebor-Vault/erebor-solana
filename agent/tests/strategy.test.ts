// Tests for MockLuloProtocol.
// Verifies in-memory state tracking for the mock lending protocol
// used on devnet where real Lulo is not deployed.

import { describe, it, expect } from "vitest";
import { MockLuloProtocol } from "../src/strategy.js";

describe("MockLuloProtocol", () => {
  describe("initial state", () => {
    it("starts with zero lent balance", async () => {
      const protocol = new MockLuloProtocol();
      expect(await protocol.getLentBalance()).toBe(0);
    });

    it("returns a yield between 4% and 6%", async () => {
      const protocol = new MockLuloProtocol();
      const yieldRate = await protocol.getCurrentYield();
      // Base is 5% ± 0.5%
      expect(yieldRate).toBeGreaterThan(0.04);
      expect(yieldRate).toBeLessThan(0.06);
    });
  });

  describe("LEND action", () => {
    it("increases lent balance by the amount", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 5_000_000 });
      expect(await protocol.getLentBalance()).toBe(5_000_000);
    });

    it("accumulates across multiple lends", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 3_000_000 });
      await protocol.execute({ action: "LEND", amount: 2_000_000 });
      expect(await protocol.getLentBalance()).toBe(5_000_000);
    });

    it("returns a mock transaction signature", async () => {
      const protocol = new MockLuloProtocol();
      const sig = await protocol.execute({ action: "LEND", amount: 1_000_000 });
      expect(sig).toMatch(/^mock-tx-\d+$/);
    });
  });

  describe("WITHDRAW action", () => {
    it("decreases lent balance", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 5_000_000 });
      await protocol.execute({ action: "WITHDRAW", amount: 2_000_000 });
      expect(await protocol.getLentBalance()).toBe(3_000_000);
    });

    it("cannot withdraw more than lent — clamps to zero", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 1_000_000 });
      await protocol.execute({ action: "WITHDRAW", amount: 5_000_000 });
      expect(await protocol.getLentBalance()).toBe(0);
    });

    it("withdraw with zero lent does nothing", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "WITHDRAW", amount: 1_000_000 });
      expect(await protocol.getLentBalance()).toBe(0);
    });
  });

  describe("HOLD action", () => {
    it("does not change lent balance", async () => {
      const protocol = new MockLuloProtocol();
      await protocol.execute({ action: "LEND", amount: 3_000_000 });
      await protocol.execute({ action: "HOLD", reason: "waiting" });
      expect(await protocol.getLentBalance()).toBe(3_000_000);
    });
  });

  describe("full lifecycle", () => {
    it("lend → partial withdraw → lend more → full withdraw", async () => {
      const protocol = new MockLuloProtocol();

      await protocol.execute({ action: "LEND", amount: 10_000_000 }); // lent: 10M
      expect(await protocol.getLentBalance()).toBe(10_000_000);

      await protocol.execute({ action: "WITHDRAW", amount: 3_000_000 }); // lent: 7M
      expect(await protocol.getLentBalance()).toBe(7_000_000);

      await protocol.execute({ action: "LEND", amount: 5_000_000 }); // lent: 12M
      expect(await protocol.getLentBalance()).toBe(12_000_000);

      await protocol.execute({ action: "WITHDRAW", amount: 12_000_000 }); // lent: 0
      expect(await protocol.getLentBalance()).toBe(0);
    });
  });
});
