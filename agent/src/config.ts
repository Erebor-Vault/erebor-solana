import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { AgentConfig } from "./types.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const PROGRAM_ID = new PublicKey(
  "DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B"
);

export function loadConfig(): AgentConfig {
  const privateKeyBase58 = requireEnv("SOLANA_PRIVATE_KEY");
  const secretKey = bs58.decode(privateKeyBase58);
  const agentKeypair = Keypair.fromSecretKey(secretKey);

  return Object.freeze({
    agentKeypair,
    rpcUrl: optionalEnv("RPC_URL", "https://api.devnet.solana.com"),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    vaultTokenMint: new PublicKey(requireEnv("VAULT_TOKEN_MINT")),
    vaultId: Number(optionalEnv("VAULT_ID", "0")),
    strategyId: Number(optionalEnv("STRATEGY_ID", "0")),
    pollIntervalMs: Number(optionalEnv("POLL_INTERVAL_MS", "30000")),
    minLendAmount: Number(optionalEnv("MIN_LEND_AMOUNT", "1000000")),
    useMockLulo: optionalEnv("USE_MOCK_LULO", "true") === "true",
    withdrawSignalPath: optionalEnv(
      "WITHDRAW_SIGNAL_PATH",
      "./withdraw-signal.json"
    ),
    maxRetries: Number(optionalEnv("MAX_RETRIES", "3")),
    retryDelayMs: Number(optionalEnv("RETRY_DELAY_MS", "2000")),
  });
}
