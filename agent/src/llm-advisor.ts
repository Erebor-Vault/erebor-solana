import Anthropic from "@anthropic-ai/sdk";
import type { Advisor, Decision, StrategySnapshot } from "./types";

/**
 * Deterministic baseline advisor. Always available, no LLM cost.
 *
 * Rules:
 *   - vault paused / strategy inactive → HOLD
 *   - delegate doesn't match the agent → HOLD with a warning (config drift)
 *   - strategy ATA balance < min_lend → HOLD (dust)
 *   - otherwise → LEND the full strategy ATA balance
 */
export class RuleBasedAdvisor implements Advisor {
  constructor(
    private readonly agentPubkey: string,
    private readonly minLendAmount: bigint
  ) {}

  async decide(s: StrategySnapshot): Promise<Decision> {
    if (s.vaultPaused) {
      return { kind: "hold", reason: "vault is paused — admin gate" };
    }
    if (!s.isActive) {
      return { kind: "hold", reason: "strategy is inactive (deactivated)" };
    }
    if (s.delegate.toBase58() !== this.agentPubkey) {
      return {
        kind: "hold",
        reason: `delegate mismatch — on-chain says ${s.delegate.toBase58()}, agent is ${this.agentPubkey}`,
      };
    }
    if (s.strategyTokenBalance < this.minLendAmount) {
      return {
        kind: "hold",
        reason: `balance ${s.strategyTokenBalance} below MIN_LEND_AMOUNT (${this.minLendAmount})`,
      };
    }
    return {
      kind: "lend",
      amount: s.strategyTokenBalance,
      reason: `auto-lend full strategy ATA balance (${s.strategyTokenBalance})`,
    };
  }
}

/**
 * Claude-backed advisor. Falls back to the rule-based path if no API key is
 * configured. Designed to be used through `withCooldown()` so we don't burn
 * tokens on every poll cycle.
 */
export class ClaudeAdvisor implements Advisor {
  private readonly client: Anthropic;
  private readonly fallback: Advisor;

  constructor(
    apiKey: string,
    fallback: Advisor,
    private readonly model: string = "claude-haiku-4-5-20251001"
  ) {
    this.client = new Anthropic({ apiKey });
    this.fallback = fallback;
  }

  async decide(s: StrategySnapshot): Promise<Decision> {
    const prompt = `You are an autonomous Solana lending agent for an
ERC-4626-style vault. You can act on this strategy slot only.

Current snapshot (BigInt amounts in raw token units, decimals fixed by mint):
  vault                : ${s.vault.toBase58()}
  vault paused         : ${s.vaultPaused}
  total_deposited      : ${s.totalDeposited}
  strategy             : ${s.strategy.toBase58()} (id ${s.strategyId})
  strategy active      : ${s.isActive}
  target_weight_bps    : ${s.targetWeightBps}
  allocated_amount     : ${s.allocatedAmount}
  strategy ATA balance : ${s.strategyTokenBalance}
  agent ATA balance    : ${s.agentTokenBalance}

Reply with ONE line of JSON, no prose, of shape:
  {"kind":"hold","reason":"..."}
  {"kind":"lend","amount":"<bigint>","reason":"..."}
  {"kind":"withdraw","amount":"<bigint>","reason":"..."}
  {"kind":"rebalance","reason":"..."}
`;

    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      });
      const text = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      const parsed = JSON.parse(text) as {
        kind: Decision["kind"];
        amount?: string;
        reason: string;
      };
      switch (parsed.kind) {
        case "hold":
          return { kind: "hold", reason: parsed.reason };
        case "lend":
          return {
            kind: "lend",
            amount: BigInt(parsed.amount ?? "0"),
            reason: parsed.reason,
          };
        case "withdraw":
          return {
            kind: "withdraw",
            amount: BigInt(parsed.amount ?? "0"),
            reason: parsed.reason,
          };
        case "rebalance":
          return { kind: "rebalance", reason: parsed.reason };
        default:
          throw new Error(`unknown kind: ${parsed.kind}`);
      }
    } catch (err) {
      console.warn(`[advisor] Claude failed, falling back to rules: ${err}`);
      return this.fallback.decide(s);
    }
  }
}

/**
 * Wrap an advisor so it only runs when the snapshot has materially changed
 * (or after a cooldown). Keeps LLM token spend predictable.
 */
export function withCooldown(
  inner: Advisor,
  cooldownSeconds: number,
  fallback: Advisor
): Advisor {
  let lastCallAt = 0;
  let lastSnapKey = "";
  return {
    async decide(s: StrategySnapshot): Promise<Decision> {
      const key = `${s.strategyTokenBalance}|${s.allocatedAmount}|${s.vaultPaused ? 1 : 0}|${s.isActive ? 1 : 0}|${s.targetWeightBps}`;
      const now = Date.now();
      if (key === lastSnapKey && now - lastCallAt < cooldownSeconds * 1000) {
        return fallback.decide(s);
      }
      lastSnapKey = key;
      lastCallAt = now;
      return inner.decide(s);
    },
  };
}
