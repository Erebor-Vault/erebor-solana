# scripts/

Operator scripts for devnet/localnet bring-up, demo flows, and ad-hoc fixes.
Run from the repo root (e.g. `bun scripts/<name>.ts`); most expect `./id.json`
plus `RPC_URL` (or `ANCHOR_PROVIDER_URL`) in the environment.

## Deployment & vault bring-up

| Script | Purpose |
| --- | --- |
| `deploy.sh` | `anchor deploy` with balance checks + post-deploy init. |
| `setup-devnet.ts` / `setup-full.ts` | Full happy path: mint test token → init vault → create strategies → simulate yield. |
| `setup-multi-vaults.ts` | Bring up the 5-vault registry shipped with the dashboard. |
| `init-vault.ts` | Idempotent vault init for an existing token mint. |
| `init-protocol-config.ts` | Initialise the global `ProtocolConfig` (treasury, governance, protocol fee bps). |
| `init-allowed-token.ts` | Add a single mint to the protocol-level `AllowedToken` allow-list. |
| `seed-allowed-tokens.ts` / `seed-vault-allowed-tokens.ts` | Bulk-seed protocol / per-vault allow-lists. |
| `init-strategy-ctoken-ata.ts` | Pre-create the cToken ATA on `strategy_authority[i]` for protocols that need it. |
| `create-vault.ts` | Init + transfer admin/authority to a target wallet. |
| `create-strategies.ts` | Create N strategies, set weights, rebalance. |
| `transfer-vault-admin.ts` | Run the two-step admin/authority transfer end-to-end. |
| `dump-deployment.ts` | Print every PDA + on-chain field for a vault (useful for `docs/DEPLOYMENT.md`). |

## Token + faucet

| Script | Purpose |
| --- | --- |
| `mint-to-wallet.ts` | Create a fresh test mint, mint to a target wallet, init vault, hand over admin. |
| `mint-mvp-tokens.ts` / `mvp-token-list.ts` | Mint the curated demo token list (per `mvp-mints-devnet.json`). |
| `mint-defi-alpha.ts` | Mint the DeFi Alpha underlying (USDC) to a target wallet *and* into each strategy ATA, then verify TVL via `report_yield`. |
| `mint-wsol-defi-alpha.ts` | Wrap a small amount of native SOL into each DeFi Alpha strategy authority's wSOL ATA. Reports whether a `ValueSource` already references each ATA. |
| `setup-demo-faucet.ts` | Deploy / configure the demo faucet program. |
| `metaplex-metadata.ts` | Attach Metaplex token metadata (symbol/name/icon) to a mint. |

## Yield, NAV, and pricing keepers

| Script | Purpose |
| --- | --- |
| `simulate-yield.ts` | Mint underlying directly into strategy ATAs and call `report_yield` to advance share price. |
| `crank-yield.ts` | Loop variant of the above (`--loop INTERVAL_SECONDS`). |
| `init-mock-feeds.ts` | Initialise mock-Pyth feed PDAs for every mint in `PROTOCOL_REGISTRY[cluster].priceFeeds`. Idempotent. |
| `crank-mock-prices.ts` | Pull USD prices from CoinGecko and push them into the mock-Pyth feeds. Supports `--loop`. |
| `check-mock-feeds.ts` | Walk every protocol-allowed mint, derive its mock-Pyth feed PDA, report which are initialised. |
| `bootstrap-wsol-defi-alpha.ts` | One-shot wSOL bring-up for DeFi Alpha: init+price the mock-Pyth feed, build the per-strategy `ValueSource` add ixs (kind=0 + kind=2 with USDC-denominated scale), and either send them (if payer = vault admin) or print them for the admin to sign. |

## Strategy / adapter setup

| Script | Purpose |
| --- | --- |
| `setup-kamino-strategy.ts` | Bootstrap a Kamino loop strategy: derive obligation PDA, whitelist the 4 Kamino actions with the correct recipient indices, fund the strategy. |
| `setup-lulo-strategy.ts` | Bootstrap a Lulo lending strategy: whitelist `lend` / `withdraw`, fund the strategy. |
| `read-kamino-position.ts` | Inspect on-chain Kamino obligation + reserve state for a given strategy. |
| `unwind-kamino-position.ts` | Repay debt → withdraw collateral → return funds to reserve, all signed by the agent delegate. |

## End-to-end / regression scenarios

| Script | Purpose |
| --- | --- |
| `e2e-kamino.ts` | Long-form Kamino loop walkthrough used as a regression test. |
| `e2e-scenario-kamino-loop.ts` | Slimmer Kamino loop: deposit → borrow → settle → repay. |
| `e2e-scenario-allowed-token.ts` | Allow-listed-token round trip: add `VaultAllowedToken`, register a `ValueSource`, mint, settle. |
| `e2e-propose-admin.ts` / `e2e-accept-admin.ts` | Both legs of the two-step admin transfer. |
| `emit-test-event.ts` | Fire a synthetic on-chain event so the activity feed has something to render. |

## Conventions

- All scripts default to `https://api.devnet.solana.com` unless `RPC_URL` /
  `ANCHOR_PROVIDER_URL` is set.
- Most read `./id.json` as the payer; some accept `ANCHOR_WALLET=...`. Scripts
  that need the *vault admin* / *authority* will detect a mismatch and either
  skip the admin step or print unsigned ixs for the admin wallet to sign.
- Tests for a few scripts live under `scripts/__tests__/` and run via
  `bun test` from the repo root.
