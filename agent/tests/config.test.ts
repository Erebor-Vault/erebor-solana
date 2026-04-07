// Tests for config loading and validation.
// Verifies that loadConfig correctly reads env vars, applies defaults,
// and throws on missing required variables.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Store original env vars and restore after each test
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  process.env = originalEnv;
});

// Helper: set the minimum required env vars for loadConfig to succeed
function setMinimumEnv() {
  const keypair = Keypair.generate();
  const base58Key = bs58.encode(keypair.secretKey);
  process.env.SOLANA_PRIVATE_KEY = base58Key;
  process.env.ANTHROPIC_API_KEY = "test-api-key";
  process.env.VAULT_TOKEN_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  return { keypair, base58Key };
}

describe("loadConfig", () => {
  it("loads successfully with all required env vars", async () => {
    const { keypair } = setMinimumEnv();

    // Dynamic import to pick up the modified env
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

  it("applies correct defaults for optional vars", async () => {
    setMinimumEnv();

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.vaultId).toBe(0);
    expect(config.strategyId).toBe(0);
    expect(config.pollIntervalMs).toBe(30000);
    expect(config.minLendAmount).toBe(1000000);
    expect(config.useMockLulo).toBe(true);
    expect(config.maxRetries).toBe(3);
    expect(config.retryDelayMs).toBe(2000);
  });

  it("reads optional overrides from env", async () => {
    setMinimumEnv();
    process.env.VAULT_ID = "5";
    process.env.STRATEGY_ID = "3";
    process.env.POLL_INTERVAL_MS = "60000";
    process.env.MIN_LEND_AMOUNT = "5000000";
    process.env.USE_MOCK_LULO = "false";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.vaultId).toBe(5);
    expect(config.strategyId).toBe(3);
    expect(config.pollIntervalMs).toBe(60000);
    expect(config.minLendAmount).toBe(5000000);
    expect(config.useMockLulo).toBe(false);
  });

  it("throws if SOLANA_PRIVATE_KEY is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.VAULT_TOKEN_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    delete process.env.SOLANA_PRIVATE_KEY;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("SOLANA_PRIVATE_KEY");
  });

  it("throws if ANTHROPIC_API_KEY is missing", async () => {
    const keypair = Keypair.generate();
    process.env.SOLANA_PRIVATE_KEY = bs58.encode(keypair.secretKey);
    process.env.VAULT_TOKEN_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    delete process.env.ANTHROPIC_API_KEY;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("ANTHROPIC_API_KEY");
  });

  it("throws if VAULT_TOKEN_MINT is missing", async () => {
    const keypair = Keypair.generate();
    process.env.SOLANA_PRIVATE_KEY = bs58.encode(keypair.secretKey);
    process.env.ANTHROPIC_API_KEY = "test";
    delete process.env.VAULT_TOKEN_MINT;

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("VAULT_TOKEN_MINT");
  });

  it("returns a frozen config object", async () => {
    setMinimumEnv();

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(Object.isFrozen(config)).toBe(true);
  });
});
