# Tasks — top-level index

This file tracks the four-task program initiated in
[Phase-3 audit decisions](docs:phase-3-audit-decisions). Each task has a
dedicated plan document; this file is the entry point that ties them
together and shows current status.

| # | Task | Plan | Status |
|---|---|---|---|
| 1 | Security audit + fixes + per-strategy authority refactor | [REFACTOR_PLAN.md](REFACTOR_PLAN.md) | 🔧 in progress (concurrent session) |
| 2 | Comprehensive program tests (invariants + fuzz) | [TEST_PLAN.md](TEST_PLAN.md) | ⏳ planned |
| 3 | E2E test with mocked Kamino + simulated AI agent | [E2E_KAMINO.md](E2E_KAMINO.md) | 🟡 mock program + harness shipped, runs after task 1 |
| 4 | Playwright frontend E2E with mocked wallet | [PLAYWRIGHT_PLAN.md](PLAYWRIGHT_PLAN.md) | ⏳ planned |

Legend: 🔧 in progress · 🟡 partially shipped · ⏳ planned · ✅ done

## How to resume work

Each plan document is self-contained — open it in a fresh Claude session and
execute top-to-bottom. The plans cross-reference each other where needed.

### Dependencies

```
   Task 1 (REFACTOR_PLAN.md)
       │
       ├──► Task 2 (TEST_PLAN.md)         — depends on post-refactor IDL
       ├──► Task 3 (E2E_KAMINO.md)        — runs against post-refactor signer model
       └──► Task 4 (PLAYWRIGHT_PLAN.md)   — depends on post-refactor frontend hooks
```

Tasks 2/3/4 are **parallel** to each other but **all depend on task 1**.

If task 1 isn't done yet, the only safe parallel work is:
- writing/refining these plan docs
- writing brand-new files that don't conflict with task 1's edits (e.g. the mock_kamino program — already shipped in the same commit as this index)

## What lands per task

### Task 1 — refactor + audit fixes

After task 1's commit, the following are in `git log`:

- `programs/my_project/src/lib.rs` rewritten — every CPI signs as `vault_authority` or `strategy_authority[i]`, never `vault_state`
- New PDAs: `vault_authority`, `strategy_authority[i]`
- New instructions: `propose_admin`, `accept_admin`, `propose_authority`, `accept_authority`, `report_loss`
- `transfer_admin` and `set_authority` removed
- `expected_recipient_index` is now `u16` not `Option<u16>`
- u128 share math everywhere; `checked_*` arithmetic on accounting fields
- `total_active_weight_bps` cap enforced
- Token-2022 `TransferHook` + `PermanentDelegate` rejected at vault init
- `init_if_needed` for admin's ATA in `withdraw`
- Tests updated, devnet re-init'd round 5 on a fresh test mint
- `DEPLOYMENT.md`, `OVERVIEW.md`, `MISMATCHES.md`, `CLAUDE.md` refreshed
- One commit: `refactor: per-strategy authority PDAs + audit fixes (Phase-3)`

### Task 2 — tests

After task 2's commit:

- `tests/{invariants,fuzz,permissions,edges,allowed_actions}.ts` exist
- Per-instruction matrix (~120 tests) all pass
- `cargo llvm-cov` shows >90% on `lib.rs`
- 1 fuzz batch (100 random sequences) passes
- One commit: `test: invariant + fuzz + permission test suite (task 2)`

### Task 3 — E2E with mocked Kamino

Already partially shipped in the same commit as this index:

- `programs/mock_kamino/` — mock program shipped
- `Anchor.toml` — both programs registered
- `scripts/e2e-kamino.ts` — happy-path harness shipped
- `E2E_KAMINO.md` — documentation

Remaining work (after task 1):

- Six negative-path assertions inside `e2e-kamino.ts` (un-whitelisted disc, wrong target, recipient pin violation, cross-strategy injection, anti-theft direct siphon, authority emergency withdraw)
- Run end-to-end against post-refactor program
- One commit: `test(e2e): negative paths for execute_action gateway (task 3)`

### Task 4 — Playwright frontend E2E

After task 4's commit:

- `app/test/mock-wallet.ts` — wallet-standard mock with deterministic keypair
- `app/test/playwright.config.ts`
- `app/test/e2e/{happy-path,admin-actions,allowed-actions,pause,two-step-admin,visual}.spec.ts`
- `.github/workflows/playwright.yml` (CI)
- One commit: `test(e2e): playwright frontend e2e (task 4)`

## What goes where

The four plan documents do NOT overlap with the canonical-state docs.
Roles:

| Doc | Role |
|---|---|
| [OVERVIEW.md](OVERVIEW.md) | What Erebor is + how it works conceptually |
| [SOLANA_VAULT_SPEC.md](SOLANA_VAULT_SPEC.md) | Original spec (partly aspirational) |
| [MISMATCHES.md](MISMATCHES.md) | Where current code drifts from the spec |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Live devnet program + per-vault PDA derivations |
| [CLAUDE.md](CLAUDE.md) | Contributor guide (commands + invariants) |
| [FRONTEND.md](FRONTEND.md) | Current dashboard implementation |
| [FRONTEND_PLAN.md](FRONTEND_PLAN.md) | Forward-looking frontend roadmap |
| [AI_PLAN.md](AI_PLAN.md) | AI agent design |
| [REFACTOR_PLAN.md](REFACTOR_PLAN.md) | **Task 1** — Phase-3 refactor (this batch) |
| [TEST_PLAN.md](TEST_PLAN.md) | **Task 2** — comprehensive program tests |
| [E2E_KAMINO.md](E2E_KAMINO.md) | **Task 3** — E2E with mocked Kamino |
| [PLAYWRIGHT_PLAN.md](PLAYWRIGHT_PLAN.md) | **Task 4** — Playwright frontend E2E |
| **[TASKS.md](TASKS.md) (this file)** | **Top-level index, current task statuses** |

## Update protocol

When a task is done, edit this file:
- Move its status to ✅
- Add the commit SHA in a new "Done" column

When a task is partially done (like task 3 today):
- Status 🟡, with a one-line note linking to the plan doc's "remaining work" section

When a task starts:
- Status 🔧, with a note saying which session is active
