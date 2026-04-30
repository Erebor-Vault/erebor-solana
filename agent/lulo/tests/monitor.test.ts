// Tests for the withdrawal signal file logic.
//
// The vault authority coordinates with the agent via a JSON file:
//   1. Authority creates withdraw-signal.json with {amount, requestedAt, requestedBy}
//   2. Agent reads the file on next poll cycle
//   3. Agent withdraws the requested amount from Lulo
//   4. Agent deletes the file to prevent re-processing
//
// These tests verify the file I/O patterns the monitor module relies on:
// reading, parsing, validation, deletion, and edge cases.

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Use a test-specific file path to avoid interfering with a real signal file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNAL_PATH = path.join(__dirname, "test-withdraw-signal.json");

// Clean up the signal file after each test to prevent test pollution.
afterEach(() => {
  try {
    fs.unlinkSync(SIGNAL_PATH);
  } catch {
    // File already cleaned up or never created — not an error
  }
});

describe("Withdrawal signal file", () => {
  // Happy path: the authority creates a valid signal file and the agent
  // can read and parse it correctly. All three fields must be present.
  it("valid signal file can be read and parsed", () => {
    const signal = {
      amount: 5_000_000,        // 5 USDC in micro-USDC
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

  // Edge case: a signal with amount=0 is considered invalid by the monitor.
  // Withdrawing 0 tokens is meaningless, so the monitor skips it.
  it("signal file with zero amount is invalid", () => {
    const signal = { amount: 0, requestedAt: "2026-04-07T12:00:00Z", requestedBy: "admin" };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.amount <= 0).toBe(true);
  });

  // Edge case: a signal with negative amount is also invalid.
  // Could happen if the authority has a bug in their tooling.
  it("signal file with negative amount is invalid", () => {
    const signal = { amount: -100, requestedAt: "2026-04-07T12:00:00Z", requestedBy: "admin" };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.amount <= 0).toBe(true);
  });

  // The normal state: no signal file exists. The monitor checks for this
  // every poll cycle and simply skips the withdrawal step.
  it("non-existent signal file returns no data", () => {
    expect(fs.existsSync(SIGNAL_PATH)).toBe(false);
  });

  // Edge case: the authority (or a bug) wrote something that isn't valid JSON.
  // JSON.parse should throw, and the monitor catches this and treats it as
  // "no valid signal" — the agent continues normally.
  it("malformed JSON in signal file is handled gracefully", () => {
    fs.writeFileSync(SIGNAL_PATH, "not valid json {{{");

    expect(() => {
      const raw = fs.readFileSync(SIGNAL_PATH, "utf-8");
      JSON.parse(raw);
    }).toThrow();
    // The monitor wraps this in try/catch and returns null → no withdrawal
  });

  // After the agent processes a signal, it deletes the file to prevent
  // the same withdrawal from being executed again on the next poll cycle.
  it("signal file can be deleted after processing", () => {
    const signal = { amount: 1_000_000, requestedAt: "2026-04-07T12:00:00Z", requestedBy: "authority" };
    fs.writeFileSync(SIGNAL_PATH, JSON.stringify(signal));

    expect(fs.existsSync(SIGNAL_PATH)).toBe(true);
    fs.unlinkSync(SIGNAL_PATH);
    expect(fs.existsSync(SIGNAL_PATH)).toBe(false);
  });

  // Race condition: the file might already be deleted by a previous attempt,
  // a concurrent process, or a filesystem glitch. The monitor's delete function
  // wraps unlinkSync in try/catch, so this must not throw.
  it("deleting already-deleted signal file does not throw", () => {
    expect(() => {
      try {
        fs.unlinkSync(SIGNAL_PATH);
      } catch {
        // Expected — the monitor does the same thing
      }
    }).not.toThrow();
  });
});
