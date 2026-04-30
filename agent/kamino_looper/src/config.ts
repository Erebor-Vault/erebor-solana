// config.ts — Environment loading and validation for the Kamino looper agent.
//
// Loads .env, validates required vars, and exports a frozen Config object.
// Throws immediately on missing required vars (fail fast at startup).

import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// Erebor vault program ID — must match the declare_id! in lib.rs.
export const VAULT_PROGRAM_ID = new PublicKey(
  "B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z"
);

export interface KaminoLooperConfig {
  // Identity
  agentKeypair: Keypair;
  rpcUrl: string;

  // Vault
  vaultTokenMint: PublicKey;     // single mint for the strategy (e.g. USDC)
  vaultId: number;
  strategyId: number;

  // Protocols
  kaminoProgramId: PublicKey;

  // Strategy parameters
  evalIntervalMs: number;
  maxLeverage: number;
  targetLeverageMin: number;
  targetLeverageMax: number;
  minLoopNetApyPct: number;
  hfComfortable: number;
  hfWarning: number;

  // Agent's expected APY rates for the underlying mint. mock_kamino doesn't
  // expose APY on-chain — yield comes from admin-driven simulate_yield calls
  // that raise the reserve's redemption rate. These config values feed the
  // open-loop economics check; set them to match what the test harness
  // simulates. On real Kamino we'd read live rates from the protocol instead.
  usdcSupplyApyBps: number;
  usdcBorrowApyBps: number;

  // Operational
  dryRun: boolean;
}

export function loadConfig(): KaminoLooperConfig {
  const privateKeyBase58 = requireEnv("SOLANA_PRIVATE_KEY");
  const secretKey = bs58.decode(privateKeyBase58);
  const agentKeypair = Keypair.fromSecretKey(secretKey);

  return Object.freeze({
    agentKeypair,
    rpcUrl: optionalEnv("RPC_URL", "https://api.devnet.solana.com"),

    vaultTokenMint: new PublicKey(requireEnv("VAULT_TOKEN_MINT")),
    vaultId: Number(optionalEnv("VAULT_ID", "0")),
    strategyId: Number(optionalEnv("STRATEGY_ID", "0")),

    kaminoProgramId: new PublicKey(requireEnv("KAMINO_PROGRAM_ID")),

    evalIntervalMs: Number(optionalEnv("EVAL_INTERVAL_MS", "300000")),
    maxLeverage: Number(optionalEnv("MAX_LEVERAGE", "3.0")),
    targetLeverageMin: Number(optionalEnv("TARGET_LEVERAGE_MIN", "2.0")),
    targetLeverageMax: Number(optionalEnv("TARGET_LEVERAGE_MAX", "2.5")),
    minLoopNetApyPct: Number(optionalEnv("MIN_LOOP_NET_APY_PCT", "1.5")),
    hfComfortable: Number(optionalEnv("HF_COMFORTABLE", "1.8")),
    hfWarning: Number(optionalEnv("HF_WARNING", "1.3")),

    usdcSupplyApyBps: Number(optionalEnv("USDC_SUPPLY_APY_BPS", "600")),
    usdcBorrowApyBps: Number(optionalEnv("USDC_BORROW_APY_BPS", "400")),

    dryRun: optionalEnv("DRY_RUN", "false") === "true",
  });
}
