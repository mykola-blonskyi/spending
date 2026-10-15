# Current Plan: Spending

Work is tracked in GitHub Issues of `mykola-blonskyi/spending` (`docs/agents/issue-tracker.md`);
this file is only a pointer and status. Decisions live in `docs/decisions.md`, the domain
contract in `knowledge/domain-model.md` and `knowledge/business-rules.md`.

## Workflow

One issue, one branch, one PR. PRs are squash-merged when CI is green.

## Status

The original build tickets (SPN-1..10: workspace, auth, workspaces, ledger, budgets, imports,
web app, PWA and deploy stack) are merged. Follow-up work (offline sync, conflicts, device
privacy) is tracked per issue.

## Definition of done

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`,
  `pnpm test:e2e`, `pnpm build` pass locally and in CI.
- `docs/architecture.md`, `docs/decisions.md`, `docs/operations.md` match the code.

## Owner actions outside the repository

- Production resources per the checklist in `docs/operations.md` (database role, OIDC client,
  Coolify resource, DNS, GitHub secrets). Off-host backup credentials are optional there.
- Automatic bank connection stays out of scope (ADR-005); CSV import is the delivered path.
