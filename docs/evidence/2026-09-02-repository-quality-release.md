# S49 Merge And Production Release Evidence

- Date: 2026-09-02
- Pull request: [#1](https://github.com/MeiYanDong/okx-boost-volume-calculator/pull/1)
- GitHub `main`: `4ab56f9d53e3ad9fb3842554cd7700e614e97d88`
- Main CI: [Quality run 33595551744](https://github.com/MeiYanDong/okx-boost-volume-calculator/actions/runs/33595551744)
- Vercel deployment: `dpl_3mXKdXGkpVHmqUsvyRN4VC2ZqUCA`
- Stable alias: `https://okx-boost-volume-calculator.vercel.app`

## Merge Receipt

PR #1 was rebase-merged after `Quality / quality`, Vercel Preview, and Vercel Preview Comments succeeded. GitHub `main` advanced from `0d0ad37` to `4ab56f9`; the protected branch kept strict required checks, pull-request enforcement, linear history, conversation resolution, and force-push/deletion protection.

The push-triggered main workflow completed successfully for the exact `4ab56f9` SHA.

## Deployment Receipt

Vercel Git integration created Production deployment `dpl_3mXKdXGkpVHmqUsvyRN4VC2ZqUCA`. Its build log reports:

```text
Cloning github.com/MeiYanDong/okx-boost-volume-calculator
Branch: main
Commit: 4ab56f9
Node: 24.x
Build: npm run build
Vite: 7.3.6
```

The deployment reached `READY` and received these aliases:

- `okx-boost-volume-calculator.vercel.app`
- `okx-boost-volume-calculator-myandongs-projects.vercel.app`
- `okx-boost-volume-calculator-git-main-myandongs-projects.vercel.app`

## Runtime Readback

After the production alias moved, `npm run smoke:production -- --expect-paused` returned:

- homepage: HTTP 200
- `/api/cron/daily-refresh`: HTTP 200 with `paused: true`
- `/api/rpc?chain=xlayer`: HTTP 503 with the RPC pause message

This proves the release is deployed and the cost kill switch remains active. It does not prove a real wallet scan, current wear calculation, archive mutation, or Feishu write; those paths intentionally remained disabled.
