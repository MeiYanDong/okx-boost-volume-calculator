# ADR 0001: Repository And Release Source Of Truth

- Status: Accepted
- Date: 2026-09-02

## Context

The production Vercel deployment contained API handlers that were absent from GitHub `main`. Local changes also carried the only current implementation of X Layer scanning and Feishu Base synchronization. A successful Vercel build therefore did not prove that the public repository could reproduce production.

## Decision

1. GitHub `main` is the canonical source for application code, API handlers, tests, migrations, and release documentation.
2. Changes reach `main` through a pull request whose `Quality / quality` check passes.
3. Production is deployed only from a commit reachable from `main`; the release record must include the commit SHA and Vercel deployment ID.
4. A production deployment is complete only after the runtime smoke check passes for the intended operating mode.
5. Secrets, local authentication artifacts, `.DS_Store`, `tmp/`, and generated build output never enter Git.
6. `RPC_USAGE_PAUSED=true` remains an independent operational kill switch. Passing CI does not authorize unpausing or deploying.

## Consequences

- Vercel dashboard edits or local-only production fixes are not accepted as the final state; the change must be reconciled into GitHub.
- CI verifies formatting policy, lint, regression tests, dependency audit, type checking, and both frontend and server builds.
- Existing formatting debt is recorded by content hash. An unchanged legacy file may pass, but a modified legacy file must be formatted or its new baseline must be explicitly reviewed.
- Runtime state, data correctness, and external service writes still require post-deploy readback; CI is not evidence of those outcomes.
