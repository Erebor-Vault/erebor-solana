// Tests for the LLM response parser (parseDecision).
// The parser must handle all edge cases from Claude's output:
// valid JSON, markdown-wrapped JSON, garbage output, missing fields, etc.
// On any failure, it must return HOLD — never throw or return an invalid decision.

import { describe, it, expect } from "vitest";
import { parseDecision } from "../src/llm-advisor.js";

describe("parseDecision", () => {
  describe("valid LEND responses", () => {
    it("parses a clean LEND JSON", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 5000000, "reason": "Yield is good"}'
      );
      expect(result.action).toBe("LEND");
      expect("amount" in result && result.amount).toBe(5000000);
    });

    it("floors fractional amounts to whole micro-USDC", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 5000000.7, "reason": "test"}'
      );
      expect(result.action).toBe("LEND");
      expect("amount" in result && result.amount).toBe(5000000);
    });

    it("preserves the reason field", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 1000000, "reason": "5% APY is attractive"}'
      );
      expect("reason" in result && result.reason).toBe("5% APY is attractive");
    });
  });

  describe("valid WITHDRAW responses", () => {
    it("parses a clean WITHDRAW JSON", () => {
      const result = parseDecision(
        '{"action": "WITHDRAW", "amount": 3000000, "reason": "Low yield"}'
      );
      expect(result.action).toBe("WITHDRAW");
      expect("amount" in result && result.amount).toBe(3000000);
    });
  });

  describe("valid HOLD responses", () => {
    it("parses a HOLD with reason", () => {
      const result = parseDecision('{"action": "HOLD", "reason": "No change"}');
      expect(result.action).toBe("HOLD");
      expect(result.reason).toBe("No change");
    });

    it("handles HOLD without reason", () => {
      const result = parseDecision('{"action": "HOLD"}');
      expect(result.action).toBe("HOLD");
      expect(result.reason).toBe("No action needed");
    });
  });

  describe("markdown-wrapped responses", () => {
    it("strips ```json code fences", () => {
      const result = parseDecision(
        '```json\n{"action": "LEND", "amount": 1000000, "reason": "test"}\n```'
      );
      expect(result.action).toBe("LEND");
      expect("amount" in result && result.amount).toBe(1000000);
    });

    it("strips ``` code fences without json tag", () => {
      const result = parseDecision(
        '```\n{"action": "HOLD", "reason": "nothing to do"}\n```'
      );
      expect(result.action).toBe("HOLD");
    });
  });

  describe("invalid responses — must return HOLD", () => {
    it("returns HOLD for empty string", () => {
      const result = parseDecision("");
      expect(result.action).toBe("HOLD");
    });

    it("returns HOLD for non-JSON text", () => {
      const result = parseDecision("I think we should lend 5 USDC to Lulo.");
      expect(result.action).toBe("HOLD");
      expect(result.reason).toContain("Unparseable");
    });

    it("returns HOLD for LEND with zero amount", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 0, "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
      expect(result.reason).toBe("Invalid amount from LLM");
    });

    it("returns HOLD for LEND with negative amount", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": -100, "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
    });

    it("returns HOLD for LEND without amount field", () => {
      const result = parseDecision('{"action": "LEND", "reason": "test"}');
      expect(result.action).toBe("HOLD");
    });

    it("returns HOLD for LEND with string amount", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": "five million", "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
    });

    it("returns HOLD for unknown action", () => {
      const result = parseDecision(
        '{"action": "SWAP", "amount": 1000000, "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
    });

    it("returns HOLD for malformed JSON", () => {
      const result = parseDecision('{"action": "LEND", amount: 1000000}');
      expect(result.action).toBe("HOLD");
    });
  });
});
