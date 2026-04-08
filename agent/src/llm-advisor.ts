// llm-advisor.ts — Claude LLM-powered decision engine.
//
// This module wraps the Anthropic Claude API to make autonomous lending decisions.
// The agent calls getDecision() with the current on-chain state and yield data,
// and Claude responds with exactly one action: LEND, WITHDRAW, or HOLD.
//
// Model selection (cost optimization):
// - Claude Haiku: used for routine checks when nothing has changed (~$0.001/call)
// - Claude Sonnet: used when state changes are detected (~$0.01/call)
//
// Safety: if the LLM call fails or returns unparseable output, the agent
// defaults to HOLD (do nothing). This prevents bad trades from LLM errors.

import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, AgentDecision, StrategySnapshot, YieldInfo } from "./types.js";

export class LLMAdvisor {
  private client: Anthropic;
  private config: AgentConfig;
  // Tracks when the last LLM call was made to enforce rate limiting.
  private lastCallTime: number = 0;

  constructor(config: AgentConfig) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.config = config;
  }

  // Asks Claude to decide what to do with the strategy's funds.
  //
  // Parameters:
  // - snapshot: current on-chain state (balance, allocated amount, active status)
  // - previousSnapshot: last cycle's state (for detecting balance changes)
  // - yieldRate: current Lulo APY as a decimal (0.05 = 5%)
  // - lentBalance: micro-USDC currently lent to Lulo
  // - useSmartModel: true = use Sonnet (state changed), false = use Haiku (routine)
  //
  // Returns an AgentDecision: LEND(amount), WITHDRAW(amount), or HOLD(reason).
  async getDecision(
    snapshot: StrategySnapshot,
    previousSnapshot: StrategySnapshot | null,
    yieldInfo: YieldInfo,
    lentBalance: number,
    useSmartModel: boolean
  ): Promise<AgentDecision> {
    // Rate limit: at most one LLM call per 10 seconds to prevent runaway costs.
    const now = Date.now();
    if (now - this.lastCallTime < 10_000) {
      return { action: "HOLD", reason: "Rate limited — too soon since last LLM call" };
    }
    this.lastCallTime = now;

    // Calculate derived metrics for the prompt.
    // idleBalance = tokens sitting in the strategy token account, not yet lent.
    // delta = balance change since last cycle (positive = new funds allocated).
    const idleBalance = snapshot.tokenBalance - lentBalance;
    const delta = previousSnapshot
      ? snapshot.tokenBalance - previousSnapshot.tokenBalance
      : 0;

    // Select the Claude model based on whether a state change was detected.
    // Sonnet is more capable (better for nuanced decisions after balance changes).
    // Haiku is faster and cheaper (fine for routine "everything looks the same" checks).
    const model = useSmartModel
      ? "claude-sonnet-4-20250514"
      : "claude-haiku-4-5-20251001";

    // System prompt: defines the agent's role, context, and decision rules.
    // This prompt is stable across calls — only the user message changes.
    // The rules enforce safety: never lend more than idle balance, keep a 5% buffer, etc.
    const systemPrompt = `You are an AI agent managing a DeFi lending strategy for the Erebor vault on Solana.

Your role: Decide whether to LEND, WITHDRAW, or HOLD tokens in a lending protocol (Lulo).

Context:
- You manage Strategy #${this.config.strategyId} of Vault #${this.config.vaultId}
- The strategy token account holds tokens allocated by the vault authority
- You can lend these tokens to Lulo to earn yield
- You can withdraw from Lulo back to the strategy token account
- You CANNOT move tokens outside the strategy — the vault program enforces this

Decision rules:
1. If idle balance >= minimum lend amount AND no funds are currently lent, consider LEND
2. If yield_status is "awaiting" it means funds were JUST deposited and yield hasn't had time to accrue yet — this is NORMAL, do NOT withdraw. HOLD and wait for yield to appear.
3. If yield_status is "accruing" with a positive rate, the protocol is working — HOLD or LEND more if idle funds are available
4. If yield_status is "none" and funds have been lent for many cycles with no yield, consider WITHDRAW
5. If balance decreased (authority deallocated), do NOT try to lend more than available
6. Always leave a small buffer (~5% of total assets) idle for withdrawal liquidity
7. Never lend more than the idle balance
8. Round amounts to whole USDC (multiples of 1000000 in micro-USDC)
9. Once funds are lent and yield_status is "awaiting", prefer HOLD — do not repeatedly lend and withdraw

Respond with EXACTLY one JSON object. No other text:
{"action": "LEND", "amount": <micro_usdc>, "reason": "<brief>"}
{"action": "WITHDRAW", "amount": <micro_usdc>, "reason": "<brief>"}
{"action": "HOLD", "reason": "<brief>"}`;

    // User message: provides the real-time numerical data.
    // Amounts shown in both micro-USDC (for machine precision) and USDC (for readability).
    // Yield status tells the LLM whether yield has actually been observed:
    // - "accruing": real yield detected in treasury (rate > 0)
    // - "awaiting": funds are lent but no yield yet (just deposited, crank hasn't run)
    // - "none": nothing is lent
    const yieldStatus = lentBalance > 0
      ? (yieldInfo.hasAccrued ? "accruing" : "awaiting")
      : "none";
    const totalAssets = snapshot.tokenBalance + lentBalance;

    const userMessage = `Current state:
- Strategy token balance: ${snapshot.tokenBalance} micro-USDC (${(snapshot.tokenBalance / 1e6).toFixed(2)} USDC)
- Currently lent to Lulo: ${lentBalance} micro-USDC (${(lentBalance / 1e6).toFixed(2)} USDC)
- Idle (available to lend): ${idleBalance} micro-USDC (${(idleBalance / 1e6).toFixed(2)} USDC)
- Total assets (lent + idle): ${totalAssets} micro-USDC (${(totalAssets / 1e6).toFixed(2)} USDC)
- Yield status: ${yieldStatus}${yieldInfo.hasAccrued ? ` (observed rate: ${(yieldInfo.rate * 100).toFixed(4)}%)` : ""}
- Minimum lend amount: ${this.config.minLendAmount} micro-USDC
- Balance change since last check: ${delta >= 0 ? "+" : ""}${delta} micro-USDC

What should we do?`;

    try {
      // Call the Anthropic Messages API with the system prompt and user message.
      // max_tokens=200 is sufficient for a single JSON response.
      const response = await this.client.messages.create({
        model,
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      // Extract the text from Claude's response.
      // Claude returns an array of content blocks; we take the first text block.
      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Parse the JSON response into a typed AgentDecision.
      const decision = parseDecision(text);

      console.log(
        `  [LLM ${model.includes("haiku") ? "Haiku" : "Sonnet"}] → ${decision.action}${
          "amount" in decision ? ` ${(decision.amount / 1e6).toFixed(2)} USDC` : ""
        } — ${decision.reason || ""}`
      );

      return decision;
    } catch (error) {
      // On any LLM error (network, rate limit, API issue), default to HOLD.
      // This is the safest action — never make a trade when the LLM is unavailable.
      console.error("  [LLM] Error:", error);
      return { action: "HOLD", reason: "LLM call failed" };
    }
  }
}

// Parses Claude's raw text response into a typed AgentDecision.
// Handles edge cases: markdown code blocks, malformed JSON, invalid amounts.
// Always returns a valid AgentDecision — never throws.
// Exported for testing.
export function parseDecision(response: string): AgentDecision {
  // Strip markdown code fences (```json ... ```) that Claude sometimes adds
  const cleaned = response
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    // Validate LEND/WITHDRAW decisions have a positive numeric amount
    if (parsed.action === "LEND" || parsed.action === "WITHDRAW") {
      if (typeof parsed.amount !== "number" || parsed.amount <= 0) {
        return { action: "HOLD", reason: "Invalid amount from LLM" };
      }
      // Floor the amount to ensure whole micro-USDC (no fractional units)
      return {
        action: parsed.action,
        amount: Math.floor(parsed.amount),
        reason: parsed.reason,
      };
    }

    // Any other action (including valid HOLD) is treated as HOLD
    return { action: "HOLD", reason: parsed.reason || "No action needed" };
  } catch {
    // JSON parse failed — Claude returned something unexpected
    return { action: "HOLD", reason: `Unparseable LLM response: ${cleaned.slice(0, 100)}` };
  }
}
