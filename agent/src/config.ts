// config.ts — Environment loading and validation.
//
// Reads .env file via dotenv, validates all required variables exist,
// parses them into typed values, and exports a frozen AgentConfig object.
// Called once at startup by index.ts. Throws immediately if any required
// variable is missing, so misconfiguration is caught before the agent
// connects to any external service.

import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { AgentConfig } from "./types.js";

// Throws if the env var is missing or empty.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Returns the env var value, or the fallback if missing.
function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// The Erebor vault program ID — must match the declare_id! in lib.rs.
// This is used for all PDA derivations and program interactions.
export const PROGRAM_ID = new PublicKey(
  "DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B"
);

// Loads and validates all environment variables, returning a frozen config object.
// The agent keypair is decoded from base58 (same format as Solana CLI's id.json export).
export function loadConfig(): AgentConfig {
  // Decode the agent's private key from base58 into a Keypair.
  // This keypair must match the `delegate` field of the strategy on-chain.
  const privateKeyBase58 = requireEnv("SOLANA_PRIVATE_KEY");
  const secretKey = bs58.decode(privateKeyBase58);
  const agentKeypair = Keypair.fromSecretKey(secretKey);

  // Object.freeze prevents accidental mutation of config after startup.
  return Object.freeze({
    agentKeypair,
    rpcUrl: optionalEnv("RPC_URL", "https://api.devnet.solana.com"),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    vaultTokenMint: new PublicKey(requireEnv("VAULT_TOKEN_MINT")),
    vaultId: Number(optionalEnv("VAULT_ID", "0")),
    strategyId: Number(optionalEnv("STRATEGY_ID", "0")),
    pollIntervalMs: Number(optionalEnv("POLL_INTERVAL_MS", "30000")),
    minLendAmount: Number(optionalEnv("MIN_LEND_AMOUNT", "1000000")), // 1 USDC
    useMockLulo: optionalEnv("USE_MOCK_LULO", "true") === "true",
    withdrawSignalPath: optionalEnv(
      "WITHDRAW_SIGNAL_PATH",
      "./withdraw-signal.json"
    ),
    maxRetries: Number(optionalEnv("MAX_RETRIES", "3")),
    retryDelayMs: Number(optionalEnv("RETRY_DELAY_MS", "2000")),
  });
}
