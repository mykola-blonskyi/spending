# Spending

Spending is a web app for tracking income and expenses, for one person or for a family.

You install it on your phone or computer like a normal app (it is a PWA). It keeps working
without internet and syncs when the connection comes back. It runs on the owner's own server
and uses only free services.

## What it does

**Personal by default.** Every user gets a private space for their own money. Nobody else can
see it.

**Family is optional.** A user can create one family space and invite people with a one-time
link. Each entry is then marked as personal or family:

- Personal entries stay private to the person who wrote them.
- Family entries are visible to every family member, and any member can edit them.

**Recording money.**

- Income and expenses with amount, date, account, category and a note.
- Accounts (cash, bank, card, savings) and categories you can rename, recolor or archive.
- Any currency. EUR is the base currency. Foreign amounts are converted with the European
  Central Bank's daily rates. The app always shows the original amount, the rate and its date,
  and says clearly when a rate is not available yet.
- Monthly budgets per category, with warnings when you get close to or go over a limit.
- Recurring entries such as salary or rent. They are created automatically, once each, even
  after the server was down for a while.

**History and insights.**

- Full history with search and filters (period, category, account, currency, type, personal or
  family).
- A dashboard with income, expenses and balance, trends, a category breakdown, budget progress
  and a comparison with the previous period.

**Bank statements.** You download a CSV statement from your bank (for example BBVA or
Santander) and import it. You see a preview and choose which column is which. Rows already
imported are skipped, but two real identical purchases on the same day are both kept.
Categories are suggested and the app learns from your corrections. An import can be undone.

In family mode, imported rows wait in a review list. For each row you confirm the category and
choose personal or family.

The app never asks for your online-banking password and never moves money. There is no
automatic bank connection, because no free and legal option exists for this use (see
`docs/decisions.md`, ADR-005).

**Works offline.**

- New entries, edits and deletions are saved on the device first and synced later.
- The queue of changes survives closing the app or restarting the phone.
- Retries never create duplicates.
- If the same entry was changed on two devices while offline, both versions are kept. You
  choose which one is right, and totals count the entry only once until you decide.

**Your data is yours.** You can export everything you can see as JSON, and your entries as
CSV. You can delete your account.

**Languages and look.**

- English, Ukrainian, Russian and Spanish. Dates and amounts follow the chosen language.
- Light, dark or system theme.
- Several layouts and color palettes to choose from in settings.

## Project status

The product is being built in small pull requests.

- The full specification is issue #5.
- The work is split into tickets #6 to #41, tracked in GitHub Issues.
- `plans/current.md` lists the order of work.

## How it is built

| Part         | Technology                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------ |
| Web app      | React 19, Vite, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query and Virtual, Zustand |
| Translations | `use-intl`                                                                                 |
| Offline      | IndexedDB (one database per user) and a service worker                                     |
| API          | NestJS 11, TypeScript, zod validation, OpenAPI                                             |
| Database     | PostgreSQL 18 with Drizzle ORM                                                             |
| Sign-in      | Google, through the shared login service `login.blonskyi.dev` (OpenID Connect)             |
| Tests        | Vitest, React Testing Library, Playwright                                                  |
| Hosting      | One VPS with Coolify, Traefik and Docker Compose                                           |

The API is one program with several modules: `auth`, `users`, `workspaces`, `ledger`, `sync`,
`budgets`, `recurring`, `imports`, `analytics`, `database`. There are no microservices.

The web app talks to the API only through typed code generated from the API's OpenAPI file.

## Repository layout

```text
apps/api      the API (NestJS)
apps/web      the web app (React)
deploy        Docker images, nginx config, backup script
docs          architecture, decisions (ADRs), operations
knowledge     domain model, business rules (BR-1, BR-2, ...), glossary
plans         the current work plan
scripts       deploy helper scripts and their tests
```

## Run it on your computer

You need Node 24, pnpm 11 and Docker.

1. Install the dependencies.

   ```bash
   corepack enable
   pnpm install
   ```

2. Start the local database. This is PostgreSQL 18 on `127.0.0.1:55440`.

   ```bash
   pnpm db:up
   ```

3. Create the API settings file.

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

   Open `apps/api/.env` and change two values:

   - set `NODE_ENV=test`, because the local login uses plain http;
   - set `SESSION_ENCRYPTION_KEY` to the output of:

     ```bash
     node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
     ```

4. Create the database tables.

   ```bash
   DATABASE_URL=postgres://spending:spending@127.0.0.1:55440/spending pnpm --filter @spending/api db:migrate
   ```

5. Start the fake login service. It replaces the real Google login on your computer and shows
   one button per test user.

   ```bash
   pnpm --filter @spending/api fake-oidc
   ```

6. In a second terminal, start the API and the web app.

   ```bash
   pnpm dev
   ```

7. Open http://localhost:5173 and click "Continue with Google". The fake login page opens.
   Pick a test user.

The API runs on port 3000 and the web app on port 5173. The web app forwards `/api` requests
to the API.

To stop the database, run `pnpm db:down`.

## Checks

These are the same checks GitHub runs on every pull request.

```bash
pnpm lint               # code style rules
pnpm format:check       # formatting
pnpm typecheck          # TypeScript types
pnpm test               # unit and component tests
pnpm test:integration   # API tests against a real database
pnpm build              # production build
pnpm test:e2e           # browser tests (run pnpm build first)
```

If you change the API, regenerate the API description and the web app's types:

```bash
pnpm openapi
```

CI fails when these generated files are out of date. If you add a database migration, run
`pnpm --filter @spending/api db:check` as well.

## Deploying

The app runs on the owner's VPS as a Coolify stack:

- a web container (nginx) that serves the app and adds strict security headers;
- the API container;
- a migration job that first saves a database backup;
- a daily backup job.

A deploy starts only by hand: in GitHub, open Actions, then Deploy, then Run workflow on
`main`. The workflow runs all checks again, tells Coolify to deploy that exact commit, and
checks that the new version is healthy.

`docs/operations.md` has the full runbook: first-time setup, secrets, deploys, rollback,
backups and restore.

## Security in short

- Sign-in only through Google via the shared login service. There are no local passwords.
- Sessions are stored on the server. The browser holds only an opaque cookie.
- Every request is checked against who you are and which spaces you belong to.
- Money is stored as whole cents, never as floating-point numbers.
- Logs never contain amounts, notes, tokens or passwords.

## Documentation

| File                          | What is in it                                 |
| ----------------------------- | --------------------------------------------- |
| `docs/architecture.md`        | How the parts fit together, the sync protocol |
| `docs/decisions.md`           | Architecture decisions and why they were made |
| `docs/operations.md`          | Running locally, CI, deploys, backups         |
| `knowledge/business-rules.md` | The rules the app must follow (BR-1, BR-2, …) |
| `knowledge/domain-model.md`   | Users, spaces, accounts, entries and the rest |
| `knowledge/glossary.md`       | The words this project uses                   |

## Contributing

1. Create a branch from `main`.
2. Make the change and run the checks above.
3. Open a pull request. Every pull request gets a full review, and CI must be green before it
   is merged.

Never commit secrets. Local settings live in `apps/api/.env`, which git ignores.
