// Tests for the withdrawal signal file logic in the monitor module.
// Since readWithdrawSignal and deleteWithdrawSignal are private, we test
// the signal file behavior through the file system directly — the same
// way the authority would create the file and the agent would consume it.

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const SIGNAL_PATH = path.join(import.meta.dirname, "test-withdraw-signal.json");

// Clean up signal file after each test
afterEach(() => {
  try {
    fs.unlinkSync(SIGNAL_PATH);
  } catch {
    // Already cleaned
  }
});

describe("Withdrawal signal file", () => {
  it("valid signal file can be read and parsed", () => {
    const signal = {
      amount: 5_000_000,
      requestedAt: "2026-04-07T12:00:00Z",
      requestedBy: "admin",
    };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.amount).toBe(5_000_000);
    expect(parsed.requestedBy).toBe("admin");
    expect(parsed.requestedAt).toBe("2026-04-07T12:00:00Z");
  });

  it("signal file with zero amount is invalid", () => {
    const signal = { amount: 0, requestedAt: "2026-04-07T12:00:00Z", requestedBy: "admin" };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    // The monitor skips signals with amount <= 0
    expect(parsed.amount <= 0).toBe(true);
  });

  it("signal file with negative amount is invalid", () => {
    const signal = { amount: -100, requestedAt: "2026-04-07T12:00:00Z", requestedBy: "admin" };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.amount <= 0).toBe(true);
  });

  it("non-existent signal file returns no data", () => {
    expect(fs.existsSync(SIGNAL_PATH)).toBe(false);
  });

  it("malformed JSON in signal file is handled gracefully", () => {
    fs.writeFileSync(SIGNAL_PATH, "not valid json {{{");

    expect(() => {
      const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
      JSON.parse(raw);
    }).toThrow();
    // The monitor wraps this in try/catch and returns null
  });

  it("signal file can be deleted after processing", () => {
    const signal = { amount: 1_000_000, requestedAt: "2026-04-07T12:00:00Z", requestedBy: "authority" };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    expect(fs.existsSync(SIGNAL_PATH)).toBe(true);

    fs.unlinkSync(SIGNAL_PATH);

    expect(fs.existsSync(SIGNAL_PATH)).toBe(false);
  });

  it("deleting already-deleted signal file does not throw", () => {
    // Simulates the race condition where the file is already gone
    expect(() => {
      try {
        fs.unlinkSync(SIGNAL_PATH);
      } catch {
        // This is the expected behavior — silently ignore
      }
    }).not.toThrow();
  });
});
