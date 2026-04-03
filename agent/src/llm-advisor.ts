import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, AgentDecision, StrategySnapshot } from "./types.js";

export class LLMAdvisor {
  private client: Anthropic;
  private config: AgentConfig;
  private lastCallTime: number = 0;

  constructor(config: AgentConfig) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.config = config;
  }

  async getDecision(
    snapshot: StrategySnapshot,
    previousSnapshot: StrategySnapshot | null,
    yieldRate: number,
    lentBalance: number,
    useSmartModel: boolean
  ): Promise<AgentDecision> {
    // Rate limit: at most one call per 10 seconds
    const now = Date.now();
    if (now - this.lastCallTime < 10_000) {
      return { action: "HOLD", reason: "Rate limited — too soon since last LLM call" };
    }
    this.lastCallTime = now;

    const idleBalance = snapshot.tokenBalance - lentBalance;
    const delta = previousSnapshot
      ? snapshot.tokenBalance - previousSnapshot.tokenBalance
      : 0;

    const model = useSmartModel
      ? "claude-sonnet-4-20250514"
      : "claude-haiku-4-5-20251001";

    const systemPrompt = `You are an AI agent managing a DeFi lending strategy for the Erebor vault on Solana.

Your role: Decide whether to LEND, WITHDRAW, or HOLD tokens in a lending protocol (Lulo).

Context:
- You manage Strategy #${this.config.strategyId} of Vault #${this.config.vaultId}
- The strategy token account holds tokens allocated by the vault authority
- You can lend these tokens to Lulo to earn yield
- You can withdraw from Lulo back to the strategy token account
- You CANNOT move tokens outside the strategy — the vault program enforces this

Decision rules:
1. If idle balance >= minimum lend amount AND yield is positive, consider LEND
2. If yield has dropped below 1% APY, consider WITHDRAW to preserve capital
3. If balance decreased (authority deallocated), do NOT try to lend more than available
4. Always leave a small buffer (~5% of total) idle for withdrawal liquidity
5. Never lend more than the idle balance
6. Round amounts to whole USDC (multiples of 1000000 in micro-USDC)

Respond with EXACTLY one JSON object. No other text:
{"action": "LEND", "amount": <micro_usdc>, "reason": "<brief>"}
{"action": "WITHDRAW", "amount": <micro_usdc>, "reason": "<brief>"}
{"action": "HOLD", "reason": "<brief>"}`;

    const userMessage = `Current state:
- Strategy token balance: ${snapshot.tokenBalance} micro-USDC (${(snapshot.tokenBalance / 1e6).toFixed(2)} USDC)
- Currently lent to Lulo: ${lentBalance} micro-USDC (${(lentBalance / 1e6).toFixed(2)} USDC)
- Idle (available to lend): ${idleBalance} micro-USDC (${(idleBalance / 1e6).toFixed(2)} USDC)
- Current Lulo yield APY: ${(yieldRate * 100).toFixed(2)}%
- Minimum lend amount: ${this.config.minLendAmount} micro-USDC
- Balance change since last check: ${delta >= 0 ? "+" : ""}${delta} micro-USDC
- Total assets (lent + idle): ${snapshot.tokenBalance} micro-USDC

What should we do?`;

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      const decision = parseDecision(text);

      console.log(
        `  [LLM ${model.includes("haiku") ? "Haiku" : "Sonnet"}] → ${decision.action}${
          "amount" in decision ? ` ${(decision.amount / 1e6).toFixed(2)} USDC` : ""
        } — ${decision.reason || ""}`
      );

      return decision;
    } catch (error) {
      console.error("  [LLM] Error:", error);
      return { action: "HOLD", reason: "LLM call failed" };
    }
  }
}

function parseDecision(response: string): AgentDecision {
  const cleaned = response
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    if (parsed.action === "LEND" || parsed.action === "WITHDRAW") {
      if (typeof parsed.amount !== "number" || parsed.amount <= 0) {
        return { action: "HOLD", reason: "Invalid amount from LLM" };
      }
      return {
        action: parsed.action,
        amount: Math.floor(parsed.amount),
        reason: parsed.reason,
      };
    }

    return { action: "HOLD", reason: parsed.reason || "No action needed" };
  } catch {
    return { action: "HOLD", reason: `Unparseable LLM response: ${cleaned.slice(0, 100)}` };
  }
}
