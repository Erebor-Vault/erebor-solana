import { config as loadDotenv } from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

loadDotenv();

function readEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function parseKeypair(envName: string): Keypair {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `Missing ${envName}. Provide a base58-encoded secret key or a JSON byte array.`
    );
  }
  // JSON byte-array form (matches `solana-keygen`)
  if (raw.trim().startsWith("[")) {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  // base58 form
  return Keypair.fromSecretKey(bs58.decode(raw.trim()));
}

export interface AgentConfig {
  rpcUrl: string;
  anthropicApiKey: string | null;
  agent: Keypair;
  programId: PublicKey;
  tokenMint: PublicKey;
  vaultId: number;
  strategyId: number;
  pollIntervalMs: number;
  minLendAmount: bigint;
  useMockLulo: boolean;
  /** Seconds between LLM calls when the snapshot hasn't changed materially. */
  llmCooldownSeconds: number;
}

export function loadConfig(): AgentConfig {
  const programId = new PublicKey(
    readEnv("PROGRAM_ID", "DXcUni7VCBiLA8MEa2cB4nektLT33Dth62skuiyuwm5B")
  );
  return {
    rpcUrl: readEnv("RPC_URL", "https://api.devnet.solana.com"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    agent: parseKeypair("SOLANA_PRIVATE_KEY"),
    programId,
    tokenMint: new PublicKey(readEnv("VAULT_TOKEN_MINT")),
    vaultId: Number(readEnv("VAULT_ID", "0")),
    strategyId: Number(readEnv("STRATEGY_ID", "0")),
    pollIntervalMs: Number(readEnv("POLL_INTERVAL_MS", "30000")),
    minLendAmount: BigInt(readEnv("MIN_LEND_AMOUNT", "1000000")),
    useMockLulo: readEnv("USE_MOCK_LULO", "true").toLowerCase() === "true",
    llmCooldownSeconds: Number(readEnv("LLM_COOLDOWN_SECONDS", "300")),
  };
}
