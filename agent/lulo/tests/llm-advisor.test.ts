// Tests for the LLM response parser (parseDecision).
//
// parseDecision takes Claude's raw text response and converts it into a typed
// AgentDecision. It must handle all the ways Claude might format its answer:
// - Clean JSON: {"action": "LEND", "amount": 5000000, "reason": "..."}
// - Markdown-wrapped: ```json\n{...}\n```
// - Garbage/hallucination: "I think we should lend..."
// - Missing or invalid fields: negative amounts, string amounts, no amount
//
// The critical safety property: on ANY parse failure, return HOLD (do nothing).
// A broken parser that returns LEND or WITHDRAW could cause unintended trades.

import { describe, it, expect } from "vitest";
import { parseDecision } from "../src/llm-advisor.js";

describe("parseDecision", () => {
  describe("valid LEND responses", () => {
    // The happy path: Claude returns well-formed JSON with action, amount, and reason.
    // Amount should be preserved exactly as provided (5M micro-USDC = 5 USDC).
    it("parses a clean LEND JSON", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 5000000, "reason": "Yield is good"}'
      );
      expect(result.action).toBe("LEND");
      expect("amount" in result && result.amount).toBe(5000000);
    });

    // Claude sometimes returns fractional amounts (e.g., 5000000.7).
    // Solana tokens use integer amounts — we floor to prevent rounding up
    // which could cause insufficient balance errors on-chain.
    it("floors fractional amounts to whole micro-USDC", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 5000000.7, "reason": "test"}'
      );
      expect(result.action).toBe("LEND");
      expect("amount" in result && result.amount).toBe(5000000);
    });

    // The reason field is passed through for logging/debugging.
    // It helps operators understand why the agent made a particular decision.
    it("preserves the reason field", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 1000000, "reason": "5% APY is attractive"}'
      );
      expect("reason" in result && result.reason).toBe("5% APY is attractive");
    });
  });

  describe("valid WITHDRAW responses", () => {
    // Same structure as LEND but with "WITHDRAW" action.
    // The agent will pull funds from Lulo back to the strategy token account.
    it("parses a clean WITHDRAW JSON", () => {
      const result = parseDecision(
        '{"action": "WITHDRAW", "amount": 3000000, "reason": "Low yield"}'
      );
      expect(result.action).toBe("WITHDRAW");
      expect("amount" in result && result.amount).toBe(3000000);
    });
  });

  describe("valid HOLD responses", () => {
    // HOLD is the "do nothing" action. It only has a reason, no amount.
    it("parses a HOLD with reason", () => {
      const result = parseDecision('{"action": "HOLD", "reason": "No change"}');
      expect(result.action).toBe("HOLD");
      expect(result.reason).toBe("No change");
    });

    // If Claude returns HOLD without a reason, we provide a default.
    // This handles the case where the LLM omits the optional field.
    it("handles HOLD without reason", () => {
      const result = parseDecision('{"action": "HOLD"}');
      expect(result.action).toBe("HOLD");
      expect(result.reason).toBe("No action needed");
    });
  });

  describe("markdown-wrapped responses", () => {
    // Claude often wraps JSON in markdown code fences: ```json\n...\n```
    // The parser strips these before parsing. This is the most common
    // "non-clean" format Claude uses.
    it("strips ```json code fences", () => {
      const result = parseDecision(
        '```json\n{"action": "LEND", "amount": 1000000, "reason": "test"}\n```'
      );
      expect(result.action).toBe("LEND");
      expect("amount" in result && result.amount).toBe(1000000);
    });

    // Sometimes Claude uses bare ``` without the "json" language tag.
    it("strips ``` code fences without json tag", () => {
      const result = parseDecision(
        '```\n{"action": "HOLD", "reason": "nothing to do"}\n```'
      );
      expect(result.action).toBe("HOLD");
    });
  });

  describe("invalid responses — must return HOLD", () => {
    // Empty response — should never happen but must be handled safely.
    it("returns HOLD for empty string", () => {
      const result = parseDecision("");
      expect(result.action).toBe("HOLD");
    });

    // Claude ignored the "respond with ONLY JSON" instruction and wrote prose.
    // The parser must not crash — just return HOLD.
    it("returns HOLD for non-JSON text", () => {
      const result = parseDecision("I think we should lend 5 USDC to Lulo.");
      expect(result.action).toBe("HOLD");
      expect(result.reason).toContain("Unparseable");
    });

    // Amount of zero is invalid — can't lend 0 tokens.
    // Treated as a malformed decision → HOLD.
    it("returns HOLD for LEND with zero amount", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": 0, "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
      expect(result.reason).toBe("Invalid amount from LLM");
    });

    // Negative amount makes no sense for LEND (can't lend -100 tokens).
    // Must be caught and converted to HOLD.
    it("returns HOLD for LEND with negative amount", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": -100, "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
    });

    // Claude returned a LEND action but forgot the amount field entirely.
    // `parsed.amount` is undefined, which fails the typeof check → HOLD.
    it("returns HOLD for LEND without amount field", () => {
      const result = parseDecision('{"action": "LEND", "reason": "test"}');
      expect(result.action).toBe("HOLD");
    });

    // Claude hallucinated the amount as a string instead of a number.
    // typeof "five million" !== "number" → HOLD.
    it("returns HOLD for LEND with string amount", () => {
      const result = parseDecision(
        '{"action": "LEND", "amount": "five million", "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
    });

    // Claude invented a new action type that doesn't exist in our system.
    // Any action other than LEND/WITHDRAW is treated as HOLD.
    it("returns HOLD for unknown action", () => {
      const result = parseDecision(
        '{"action": "SWAP", "amount": 1000000, "reason": "test"}'
      );
      expect(result.action).toBe("HOLD");
    });

    // Syntactically invalid JSON (missing quotes around key).
    // JSON.parse throws → caught → HOLD.
    it("returns HOLD for malformed JSON", () => {
      const result = parseDecision('{"action": "LEND", amount: 1000000}');
      expect(result.action).toBe("HOLD");
    });
  });
});
