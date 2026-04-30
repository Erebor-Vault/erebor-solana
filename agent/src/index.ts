/**
 * Erebor AI agent entry point.
 *
 * Reads on-chain strategy state on a poll interval, asks an advisor
 * (rule-based by default; Claude-backed when ANTHROPIC_API_KEY is set)
 * what to do, then routes the decision to the strategy module.
 *
 * Status: harness only. The lend / withdraw paths are mocked because
 * the spec's `execute_action` whitelist gateway
 * (SOLANA_VAULT_SPEC.md §7.7) is not yet implemented — without it the
 * agent has no on-chain proof that an inner protocol call is
 * sandboxed. See MISMATCHES.md §2.3 for the gap.
 *
 * To run:
 *   cp agent/.env.example agent/.env  # fill in SOLANA_PRIVATE_KEY +
 *                                     # VAULT_TOKEN_MINT (+ optionally
 *                                     # ANTHROPIC_API_KEY)
 *   cd agent && bun install
 *   bun run start
 */
import { loadConfig } from "./config";
import { runMonitor } from "./monitor";
import { ClaudeAdvisor, RuleBasedAdvisor, withCooldown } from "./llm-advisor";

async function main() {
  const config = loadConfig();
  const baseline = new RuleBasedAdvisor(
    config.agent.publicKey.toBase58(),
    config.minLendAmount
  );
  const advisor = config.anthropicApiKey
    ? withCooldown(
        new ClaudeAdvisor(config.anthropicApiKey, baseline),
        config.llmCooldownSeconds,
        baseline
      )
    : baseline;

  if (!config.anthropicApiKey) {
    console.log(
      "[agent] no ANTHROPIC_API_KEY set — running with deterministic rule-based advisor"
    );
  }

  await runMonitor(config, advisor);
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
