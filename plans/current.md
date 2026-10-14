# Current Plan: Spending (complete product)

Source of truth: the product specification and implementation plan in the owner's notes
(`spending/expense-tracker-spec.md`, `spending/expense-tracker-plan.md`). Decisions that refine
them live in `docs/decisions.md`. Domain contract: `knowledge/domain-model.md` and
`knowledge/business-rules.md`.

Tickets are engineering units, not product versions. Each ticket is one branch and one PR.
PRs are stacked: each branch starts from the previous ticket's branch because no PR is merged
without the owner's permission. Branch names are `spn-<n>-<slug>`.

## Tickets

| ID     | Scope                                                                                                                          | Depends on  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| SPN-1  | pnpm workspace, TypeScript/ESLint/Prettier, NestJS and Vite skeletons, dev Postgres, health endpoint, CI workflow, docs        | none        |
| SPN-2  | Drizzle schema and migrations, money/currency/date primitives, DB test harness                                                 | SPN-1       |
| SPN-3  | Auth: OIDC BFF client, server sessions, CSRF, CORS, rate limits, `users` profile                                               | SPN-2       |
| SPN-4  | Workspaces: personal workspace, family mode, invitations, membership, access policy                                            | SPN-3       |
| SPN-5  | Ledger: accounts, categories, transactions read API, sync push/pull, conflicts, FX rates                                       | SPN-4       |
| SPN-6  | Budgets, recurring generation, analytics, export, account deletion                                                             | SPN-5       |
| SPN-7  | CSV imports: preview contract, mapping, dedupe, auto-categorization, family review queue, undo                                 | SPN-5       |
| SPN-8  | Web foundation: layers and boundaries, i18n (en/uk/ru/es), themes, shell, OpenAPI client, auth screens, offline store and sync | SPN-3       |
| SPN-9  | Web features: history, entry, dashboard and charts, accounts, categories, budgets, recurring, family, imports, settings        | SPN-6, 7, 8 |
| SPN-10 | PWA install/offline polish, Playwright E2E, Dockerfiles, compose stack, CSP, deploy workflow, operations runbook               | SPN-9       |

## Definition of done (whole product)

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`,
  `pnpm test:e2e`, `pnpm build` all pass locally and in CI.
- The acceptance walk in the implementation plan (section 15) passes against the local stack.
- `docs/architecture.md`, `docs/decisions.md`, `docs/operations.md` match the code.

## Externally blocked (owner action required)

- OIDC client registration on the VPS and the hub grant for the `spending` client.
- Production database and role creation, Coolify resource, DNS, GitHub secrets.
- Automatic bank connection: no demonstrably free and legal AISP channel for family use
  (ADR-005). CSV import is the delivered path.
