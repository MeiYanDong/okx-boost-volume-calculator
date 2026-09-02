# S49 Repository Quality Baseline Todo

- [x] Preserve the current dirty worktree on `codex/repository-quality-baseline`.
- [x] Exclude `.DS_Store`, `tmp/`, secrets, generated output, and local Vercel state.
- [x] Add the X Layer-only inactive-chain history regression test.
- [x] Add the OKX 429 retry and re-sign regression test.
- [x] Add the archive-save-before-Feishu regression test.
- [x] Add the administrator workspace and owner-email isolation regression test.
- [x] Add ESLint and a ratcheted Prettier formatting gate.
- [x] Upgrade the vulnerable Vite toolchain and make `npm audit --audit-level=high` pass.
- [x] Add the Node 24 GitHub Actions quality workflow.
- [x] Add the source-of-truth ADR and production smoke command.
- [ ] Push the review branch and open a pull request.
- [ ] Verify `Quality / quality` on GitHub.
- [ ] Configure the required `Quality / quality` branch check, or record the exact blocker.
- [ ] Confirm production remains in RPC-paused mode.
