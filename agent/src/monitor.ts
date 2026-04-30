import { Connection } from "@solana/web3.js";
import type { AgentConfig } from "./config";
import type { Advisor, StrategySnapshot } from "./types";
import { readSnapshot } from "./vault-client";
import { lend, withdraw } from "./strategy";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarizeSnapshot(s: StrategySnapshot): string {
  return [
    `vault=${s.vault.toBase58().slice(0, 6)}…`,
    `paused=${s.vaultPaused}`,
    `total=${s.totalDeposited}`,
    `id=${s.strategyId}`,
    `active=${s.isActive}`,
    `weight=${s.targetWeightBps}bps`,
    `allocated=${s.allocatedAmount}`,
    `strategyATA=${s.strategyTokenBalance}`,
    `agentATA=${s.agentTokenBalance}`,
  ].join(" ");
}

/**
 * Polling monitor — pulls a fresh snapshot every `pollIntervalMs`,
 * asks the advisor what to do, and dispatches to the strategy module.
 * Today the strategy actions are mock; the harness exists so that
 * (1) anyone can run `bun run start` and see the loop work end-to-end,
 * and (2) when the spec's `execute_action` lands the dispatch points
 * have somewhere to plug in.
 */
export async function runMonitor(
  config: AgentConfig,
  advisor: Advisor
): Promise<never> {
  const connection = new Connection(config.rpcUrl, "confirmed");
  const agent = config.agent.publicKey;
  console.log(
    `[agent] starting monitor — agent=${agent.toBase58()} vault_id=${config.vaultId} strategy_id=${config.strategyId} interval=${config.pollIntervalMs}ms mock_lulo=${config.useMockLulo}`
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let snap: StrategySnapshot | null = null;
    try {
      snap = await readSnapshot(connection, {
        programId: config.programId,
        tokenMint: config.tokenMint,
        vaultId: config.vaultId,
        strategyId: config.strategyId,
        agent,
      });
    } catch (err) {
      console.warn(`[agent] snapshot read failed: ${err}`);
    }

    if (snap) {
      console.log(`[agent] snapshot: ${summarizeSnapshot(snap)}`);
      try {
        const decision = await advisor.decide(snap);
        console.log(
          `[agent] decision=${decision.kind} reason="${decision.reason}"${
            "amount" in decision ? ` amount=${decision.amount}` : ""
          }`
        );
        switch (decision.kind) {
          case "lend": {
            const out = await lend(decision, snap, { useMockLulo: config.useMockLulo });
            console.log(
              `[agent] ${out.note}${out.signature ? ` sig=${out.signature}` : ""}`
            );
            break;
          }
          case "withdraw": {
            const out = await withdraw(decision, snap, {
              useMockLulo: config.useMockLulo,
            });
            console.log(
              `[agent] ${out.note}${out.signature ? ` sig=${out.signature}` : ""}`
            );
            break;
          }
          case "rebalance":
          case "hold":
            break;
        }
      } catch (err) {
        console.warn(`[agent] advisor failed: ${err}`);
      }
    }

    await sleep(config.pollIntervalMs);
  }
}
