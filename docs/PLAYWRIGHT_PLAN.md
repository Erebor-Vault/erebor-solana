# Task 4 — Playwright frontend E2E

> **Status.** Plan only. Resume in a fresh session **after**
> [REFACTOR_PLAN.md](REFACTOR_PLAN.md) lands and the new round-5
> devnet vaults are live. This plan is independent of
> [TEST_PLAN.md](TEST_PLAN.md) and [E2E_KAMINO.md](E2E_KAMINO.md).

## Goals

Verify the full user-facing surface via Playwright with a mocked
wallet adapter, against either:

- A local validator with one known funded vault, OR
- The live devnet round-5 vaults at known addresses

The MCP-Playwright shipped with Claude Code already verified read-only
flows in earlier sessions (see screenshots `01-…` through
`17-…` in [app/](app/)). This plan extends to **mutation** paths
(deposit / withdraw / admin actions) which require wallet signing.

## What's new vs the manual MCP-Playwright runs

Earlier sessions used the MCP-Playwright extension to drive the
browser without a wallet — covered:

- ✅ home page renders with all 5 vault cards + aggregate stats
- ✅ vault list rows are clickable + copyable
- ✅ per-vault detail page renders deposit/withdraw forms
- ✅ allocation pie + activity feed populate
- ✅ AdminGuard blocks admin route without wallet
- ✅ vault selector navigates between vaults
- ⚠️ withdraw form preview shows fee math correctly

What's NOT yet covered (and is the scope of task 4):

- 🔲 deposit flow with wallet signing
- 🔲 withdraw flow with wallet signing → admin's ATA receives fee
- 🔲 admin actions: create strategy / set weight / deactivate / pause toggle / set fee bps
- 🔲 authority actions: allocate / deallocate / rebalance / report yield / report loss
- 🔲 two-step admin transfer flow
- 🔲 add/remove allowed action via the editor
- 🔲 error paths: insufficient balance, paused vault, weight cap exceeded
- 🔲 visual regression baseline

## Wallet mocking strategy

Real Phantom/Solflare can't run headlessly in CI. Three viable approaches:

### Option A — wallet-standard injection (recommended)

Use `@wallet-standard/wallet` to register a custom wallet that wraps a deterministic `Keypair`. The `@solana/wallet-adapter-react` ecosystem auto-discovers wallet-standard wallets, so the existing app code requires no changes. The mock wallet:

1. Reads from `localStorage` to know which test keypair to act as (admin / authority / regular user)
2. Auto-approves all signing requests
3. Reports `connected: true` immediately

Files needed:

```
app/test/
├── mock-wallet.ts             # WalletStandardWallet implementation
├── inject-wallet.ts           # init script run before page load to register
├── playwright.config.ts       # baseURL, projects (chromium only initially)
└── e2e/
    ├── happy-path.spec.ts     # deposit → withdraw → verify fee
    ├── admin-actions.spec.ts  # create strategy → weight → deactivate
    ├── allowed-actions.spec.ts # whitelist editor add/remove
    ├── pause.spec.ts          # admin pauses → user blocked from deposit
    ├── two-step-admin.spec.ts # propose → accept → re-verify
    └── visual.spec.ts         # screenshot comparison vs baseline
```

The `inject-wallet.ts` is added to `playwright.config.ts` as a `globalSetup` or per-spec `await page.addInitScript(...)`.

### Option B — Anchor provider override via env var

Set `NEXT_PUBLIC_TEST_KEYPAIR=<base58>` in `.env.test`. App code reads this and bypasses the wallet adapter when present. **Drawback:** test code paths in production bundle. Acceptable if the env var is hard-coded false in `next.config.ts` for the production build.

### Option C — playwright-msw style RPC mocking

Mock the Solana RPC at the network layer (intercept `POST /` requests, respond with canned account states). **Drawback:** can't actually exercise the program — only verifies the frontend's request shape. Not enough.

**Recommendation: A.** Option A is the standard approach (what wagmi/RainbowKit communities use for EVM); minimal app-code changes; deterministic.

## Test environment

Two viable backends:

### Backend 1 — local validator (preferred for CI)

```bash
# in CI: GitHub Actions, devnet validator on port 8899
solana-test-validator -r --quiet &
anchor build
anchor deploy --provider.cluster localnet
bun scripts/setup-multi-vaults.ts --cluster localnet
```

`setup-multi-vaults.ts` outputs the new mint + 5 vault addresses.
Test config reads them and sets up `mock-wallet.ts` test keypairs:

- `admin` — funded with 100 SOL + 10000 USDC, registered as admin/authority on vaults 0–3
- `user` — funded with 1 SOL + 1000 USDC
- `defi-alpha-admin` — admin/authority on vault 4

### Backend 2 — live devnet (preferred for visual regression)

Reuses the deployed vaults. Tests skip mutation flows that would
spend devnet SOL. Useful for the visual-regression spec.

## Spec-by-spec plan

### `happy-path.spec.ts`

```ts
test('user deposits, withdraws, sees fee', async ({ page }) => {
  await connectMockWallet(page, 'user');
  await page.goto(`/vault/${VAULT_PDA}`);
  await expect(page.getByText('AT trader agent')).toBeVisible();

  // Deposit 100 USDC
  await page.fill('input[placeholder*="amount"]', '100');
  await page.click('button:has-text("Deposit")');
  await waitForTxConfirmed(page);
  await expect(page.getByText('Total Value Locked')).toContainText(/\d+ USDC/);

  // Switch to withdraw, redeem half
  await page.click('button:has-text("Withdraw")');
  // ... pull share balance, type half
  await page.click('button:has-text("Withdraw")');
  await waitForTxConfirmed(page);

  // Verify fee was deducted (check admin's ATA balance via RPC, or just assert
  // the "you receive" preview said net < gross)
});
```

### `admin-actions.spec.ts`

- Connect as `admin` (vaults 0–3)
- Navigate to per-vault admin
- Pause toggle → assert `vault.paused == true` via RPC
- Performance fee slider: 5% → 10%, save, assert on-chain
- Create strategy with delegate address: `AAA…`
- Set weight on the new strategy
- Deactivate (must drain first — verify the UI prompts)

### `allowed-actions.spec.ts`

- Per-strategy admin route
- Pick "Kamino · deposit" preset → form auto-fills target program + disc + recipient
- Submit → assert AllowedAction PDA exists on-chain
- Pick "Kamino · withdraw" → submit
- Remove first entry → assert PDA gone
- Pair-warning banner is visible

### `pause.spec.ts`

- Admin pauses vault
- Switch to user wallet, attempt deposit → button reports "vault paused" or tx reverts and toast surfaces the error
- Withdraw still works (verify)
- Admin unpauses, deposit succeeds again

### `two-step-admin.spec.ts`

- Connect as current admin
- `propose_admin(8qKt…)` via the AdminTransferFlow UI
- Verify pending shown
- Switch to mock wallet `8qKt…`
- `accept_admin` button visible (pending → accept)
- Click accept → admin transferred
- Original admin sees "no longer admin" UI

### `visual.spec.ts`

- For each major route (`/`, `/vault/[addr]`, `/vault/[addr]/admin`, `/vault/[addr]/admin/strategy/0`), capture a screenshot
- Compare to baseline (per browser-version) using Playwright's `toHaveScreenshot`
- Fail on > 5% pixel diff
- Maintained in `app/test/visual-baseline/` directory

## CI integration

```yaml
# .github/workflows/playwright.yml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: PATH="$HOME/.cargo/bin:$PATH" anchor build
      - run: solana-test-validator -r --quiet &
      - run: sleep 5
      - run: anchor deploy --provider.cluster localnet
      - run: bun scripts/setup-multi-vaults.ts --cluster localnet
      - working-directory: app
        run: |
          bun install
          bunx playwright install chromium
          bun run test:e2e
```

`bun run test:e2e` is `playwright test --config app/test/playwright.config.ts`.

## Risks & known fragilities

1. **Tx timing.** Solana tx confirmation is ~1–2 seconds on local validator, longer on devnet. Tests need a `waitForTxConfirmed(page)` helper that polls the page for either a success toast or an error message. Avoid `page.waitForTimeout` — flaky.
2. **State leakage.** Each spec must run on a fresh vault (different `vault_id` or fresh mint). Local validator restart between specs is the cleanest isolation; ~5s overhead per spec is acceptable.
3. **Visual regression noise.** Recharts and dynamic data (block heights, timestamps) introduce diff noise. Mask those via `page.locator(...).hide()` or use `toMatchSnapshot` with `maxDiffPixelRatio: 0.05`.
4. **Mock wallet keypair collisions.** Hard-code keypairs in `app/test/keypairs.ts` (DO NOT mainnet-fund). Print a warning on import.
5. **Network errors.** Local validator can transiently fail; wrap RPC reads in `expect(...).toEventually(...)` patterns.

## Out of scope

- Browser permutation (Firefox / Safari / mobile). Add later.
- Wallet-multi-button UX details (loading states, etc). Manual MCP-Playwright covered enough.
- Performance / accessibility audits. Separate concerns.

## Acceptance

Done when:
- `app/test/mock-wallet.ts` exists, registers via wallet-standard
- 6 spec files pass on local validator
- 1 visual-regression spec passes on devnet (with stored baseline)
- `bun run test:e2e` is green in CI
- One commit: `test(e2e): playwright frontend e2e (task 4)`

## Related

- [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — task 1, must land first
- [TEST_PLAN.md](TEST_PLAN.md) — task 2 (program tests)
- [E2E_KAMINO.md](E2E_KAMINO.md) — task 3 (program-level E2E)
- [TASKS.md](TASKS.md) — top-level status
