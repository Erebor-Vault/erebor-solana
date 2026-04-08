// Tests for config loading and validation.
//
// The loadConfig() function reads .env variables, validates that all required
// ones are present, parses them into typed values (Keypair, PublicKey, numbers),
// and returns a frozen AgentConfig object. These tests verify:
// - Correct parsing of all required + optional variables
// - Default values applied when optional vars are missing
// - Immediate throw on missing required vars (fail-fast at startup)
// - Config immutability (Object.freeze)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// We snapshot process.env before each test and restore it after.
// This prevents test pollution — each test starts with a clean environment.
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  process.env = originalEnv;
});

// Helper: sets ALL required env vars to valid values. Without these, loadConfig() throws.
// Returns the generated keypair so tests can verify the agent's public key.
function setMinimumEnv() {
  const keypair = Keypair.generate();
  const base58Key = bs58.encode(keypair.secretKey);
  process.env.SOLANA_PRIVATE_KEY = base58Key;
  process.env.ANTHROPIC_API_KEY = "test-api-key";
  process.env.VAULT_TOKEN_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  process.env.LULO_PROGRAM_ID = "ENccKNWkndfdG16WQY3xchEKGoF3MwXqF5SWueesThXE";
  process.env.LULO_TREASURY = "So11111111111111111111111111111111111111112";
  return { keypair, base58Key };
}

describe("loadConfig", () => {
  // Verifies that loadConfig() succeeds when all three required env vars are set,
  // and that the parsed values match what was provided.
  // The keypair is decoded from base58 → secretKey → Keypair, so we verify the
  // resulting public key matches the original generated keypair.
  it("loads successfully with all required env vars", async () => {
    const { keypair } = setMinimumEnv();

    // Dynamic import is used because dotenv/config runs on import.
    // Each test re-imports to pick up the modified process.env values.
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.agentKeypair.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58()
    );
    expect(config.anthropicApiKey).toBe("test-api-key");
    expect(config.vaultTokenMint.toBase58()).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
  });

  // Verifies that when optional env vars are NOT set, loadConfig() applies
  // sensible defaults: vault ID 0, strategy ID 0, 30s polling, 1 USDC minimum,
  // mock Lulo enabled, 3 retries with 2s delay.
  // These defaults are suitable for devnet testing out of the box.
  it("applies correct defaults for optional vars", async () => {
    setMinimumEnv();

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.vaultId).toBe(0);
    expect(config.strategyId).toBe(0);
    expect(config.pollIntervalMs).toBe(120000);       // 2 minutes
    expect(config.minLendAmount).toBe(1000000);       // 1 USDC (6 decimals)
    expect(config.luloProgramId.toBase58()).toBe("ENccKNWkndfdG16WQY3xchEKGoF3MwXqF5SWueesThXE");
    expect(config.luloTreasury.toBase58()).toBe("So11111111111111111111111111111111111111112");
    expect(config.maxRetries).toBe(3);
    expect(config.retryDelayMs).toBe(2000);           // 2 seconds
  });

  // Verifies that when optional env vars ARE set, loadConfig() reads them
  // instead of using defaults. This is how a user configures the agent
  // for a specific vault/strategy on mainnet.
  it("reads optional overrides from env", async () => {
    setMinimumEnv();
    process.env.VAULT_ID = "5";
    process.env.STRATEGY_ID = "3";
    process.env.POLL_INTERVAL_MS = "60000";
    process.env.MIN_LEND_AMOUNT = "5000000";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.vaultId).toBe(5);
    expect(config.strategyId).toBe(3);
    expect(config.pollIntervalMs).toBe(60000);        // 60 seconds
    expect(config.minLendAmount).toBe(5000000);       // 5 USDC
  });

  // Verifies fail-fast: if SOLANA_PRIVATE_KEY is missing, the agent should
  // throw immediately at startup rather than failing later when trying to
  // sign a transaction. The error message must name the missing variable.
  it("throws if SOLANA_PRIVATE_KEY is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.VAULT_TOKEN_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    delete process.env.SOLANA_PRIVATE_KEY;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("SOLANA_PRIVATE_KEY");
  });

  // Verifies fail-fast: if ANTHROPIC_API_KEY is missing, the agent should
  // throw immediately rather than failing on the first LLM call minutes later.
  it("throws if ANTHROPIC_API_KEY is missing", async () => {
    const keypair = Keypair.generate();
    process.env.SOLANA_PRIVATE_KEY = bs58.encode(keypair.secretKey);
    process.env.VAULT_TOKEN_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    delete process.env.ANTHROPIC_API_KEY;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("ANTHROPIC_API_KEY");
  });

  // Verifies fail-fast: if VAULT_TOKEN_MINT is missing, PDA derivation would
  // fail silently (producing wrong addresses), so we catch it at config time.
  it("throws if VAULT_TOKEN_MINT is missing", async () => {
    setMinimumEnv();
    delete process.env.VAULT_TOKEN_MINT;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("VAULT_TOKEN_MINT");
  });

  // Verifies fail-fast: if LULO_PROGRAM_ID is missing, the agent can't know
  // which protocol to target in execute_strategy_action calls.
  it("throws if LULO_PROGRAM_ID is missing", async () => {
    setMinimumEnv();
    delete process.env.LULO_PROGRAM_ID;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("LULO_PROGRAM_ID");
  });

  // Verifies fail-fast: if LULO_TREASURY is missing, the agent can't build
  // the remaining_accounts for deposit/withdraw CPI calls.
  it("throws if LULO_TREASURY is missing", async () => {
    setMinimumEnv();
    delete process.env.LULO_TREASURY;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("LULO_TREASURY");
  });

  // Verifies that the returned config object is frozen (Object.freeze).
  // This prevents accidental mutation of config values after startup,
  // which could cause subtle bugs in the monitoring loop.
  it("returns a frozen config object", async () => {
    setMinimumEnv();

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(Object.isFrozen(config)).toBe(true);
  });
});
