# S49 Repository Quality Baseline

## Goal

Reconcile the current X Layer and Feishu implementation into a reviewable Git branch, add business-result regression tests, and establish a release gate that matches the Vercel production path without changing production's paused RPC state.

## Scope

### Story 1: Reproducible Source

Acceptance criteria:

- The branch contains every production API handler required by `vercel.json`.
- Local QR codes, temporary files, machine metadata, and secrets are excluded.
- `git diff --check` passes and the work is delivered through a pull request, not directly to `main`.

### Story 2: Critical Regression Tests

Acceptance criteria:

- X Layer-only refresh preserves BSC transactions still inside the active window and drops expired BSC hashes.
- An OKX HTTP 429 retry waits and creates a fresh timestamp and signature.
- A failed archive save prevents Feishu synchronization.
- Feishu synchronization accepts only the exact administrator workspace and owner email.

### Story 3: Merge Gate

Acceptance criteria:

- GitHub Actions uses Node 24 and a locked `npm ci` install.
- CI runs formatting policy, ESLint, tests, dependency audit, type checking, frontend build, and server build.
- The workflow becomes a required check on `main` when repository permissions support branch protection.

### Story 4: Release Verification

Acceptance criteria:

- An ADR defines GitHub `main` and a green revision as the release source of truth.
- The Vercel runbook records commit-to-deployment traceability and post-deploy smoke commands.
- The smoke command verifies the homepage, Cron pause response, and RPC pause response without invoking an upstream RPC.

## Non-Goals

- No broad refactor of `App.tsx`, Supabase storage, or Feishu synchronization.
- No automatic merge to `main`.
- No production deployment or RPC unpause during this stage.
- No change to `docs/requirements.md` without user authorization.

## Status

- [x] Independent review branch created.
- [x] Critical behavior tests added and passing locally.
- [x] Local lint, type checking, dependency audit, and build gate added.
- [x] ADR and production smoke command added.
- [x] Pull request CI is green.
- [x] Required branch check is enabled or its permission blocker is recorded.

## Evidence

- Review: [PR #1](https://github.com/MeiYanDong/okx-boost-volume-calculator/pull/1), left open for manual merge.
- CI: [Quality run 33594264391](https://github.com/MeiYanDong/okx-boost-volume-calculator/actions/runs/33594264391), `quality` passed in 28 seconds.
- Branch policy: `main` requires a strict, current `quality` check and pull request; force pushes and deletion are disabled, including for administrators.
- Local: `npm run quality` passed with 13/13 tests and zero npm audit vulnerabilities.
- Runtime: `npm run smoke:production -- --expect-paused` returned homepage 200, Cron paused, and RPC 503.
