# Backend development workflow

Practical setup and day-to-day commands for the NestJS + Prisma backend.
For architecture rules (tenant isolation, RBAC, folder structure, PR
conventions) see [`CLAUDE.md`](../../CLAUDE.md) at the project root — this
file is the "how do I run it" companion, not a replacement.

## Prerequisites

- Node.js 24+
- Docker + Docker Compose (for local Postgres)
- npm (ships with Node)

## Setup from scratch

Run everything from inside `backend/` unless noted otherwise.

1. **Install dependencies**

   ```bash
   cd backend
   npm install
   ```

2. **Start Postgres** (compose file is at the project root, one level up)

   ```bash
   cd ..
   docker compose up -d postgres
   cd backend
   ```

   Confirm it's healthy before continuing:

   ```bash
   docker ps --filter name=postgres --format "{{.Names}}: {{.Status}}"
   ```

3. **Create your `.env`**

   ```bash
   cp .env.example .env
   ```

   Defaults in `.env.example` match the `docker-compose.yml` Postgres
   service (`postgres` / `postgres` / `support_tickets` on `localhost:5432`)
   — no edits needed for local dev. Never commit `.env`.

4. **Generate the Prisma client**

   ```bash
   npx prisma generate
   ```

5. **Apply migrations**

   ```bash
   npx prisma migrate dev
   ```

   This creates the database schema from `schema.prisma` and applies any
   migrations already committed in `prisma/migrations/`.

6. **Seed data** (once `prisma/seed.ts` exists — see `CLAUDE.md`'s manual
   verification section for what it should contain: 2 tenants, each with an
   `owner`, `agent`, `customer`, and `Admin`)

   ```bash
   npx prisma db seed
   ```

7. **Boot the app**

   ```bash
   npm run start:dev
   ```

   Verify:
   - `GET http://localhost:3000/health` → `{"status":"ok"}`
   - Swagger UI at `http://localhost:3000/api/docs` (only loads when
     `SWAGGER_ENABLED=true` in `.env`)
   - Console shows a clean boot — no unhandled errors, Prisma connects
     without warnings

## Everyday commands

| Command | What it does |
|---|---|
| `npm run start:dev` | Boot the app in watch mode |
| `npm run start:debug` | Boot with the Node inspector attached, watch mode |
| `npm run build` | Type-check and compile to `dist/` |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier write over `src/` and `test/` |
| `npm run test` | Unit tests (Jest) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:cov` | Unit tests with coverage report |
| `npm run test:e2e` | End-to-end tests (needs Postgres running) |
| `npx prisma migrate dev --name <desc>` | Create + apply a new migration after editing `schema.prisma` |
| `npx prisma generate` | Regenerate the Prisma client (run after pulling schema changes) |
| `npx prisma studio` | Browse the database in a GUI |
| `npx prisma db seed` | Re-run seed data (once `prisma/seed.ts` exists) |

## Docker (Postgres container)

`docker-compose.yml` lives at the project root (one level up from
`backend/`), so run these from there:

```bash
cd ..   # project root, if you're inside backend/
```

| Command | What it does |
|---|---|
| `docker compose up -d postgres` | Start Postgres in the background (creates the container/volume on first run) |
| `docker compose stop postgres` | Stop the container, keep it and its data around |
| `docker compose start postgres` | Resume a stopped container |
| `docker compose restart postgres` | Restart the container (e.g. after changing env vars in `docker-compose.yml`) |
| `docker compose down` | Stop and remove the container + network (data survives — it's on the `postgres_data` volume) |
| `docker compose down -v` | Stop and remove the container **and** the `postgres_data` volume — wipes the database, use to force a totally clean slate |
| `docker compose ps` | Check what's running |
| `docker compose logs -f postgres` | Tail Postgres logs |
| `docker ps --filter name=postgres --format "{{.Names}}: {{.Status}}"` | Quick one-liner health check (used in setup step 2 above) |

`docker compose down -v` is destructive — it deletes all local ticket/tenant
data. Only reach for it when you deliberately want a fresh database; after
running it you'll need `npx prisma migrate dev` (and reseed) again before
the app can boot.

## Before every commit

Mirrors the checklist in `CLAUDE.md` — run this for every commit, not just
before a PR. Automated checks first, since there's no point doing a manual
pass on code that doesn't even lint:

1. **Lint, build, test**

   ```bash
   npm run lint
   npm run build
   npm run test
   npm run test:e2e
   ```

   All four must be clean. Don't commit on green tests alone — continue to
   the manual pass below.

2. **Boot the app** and confirm a clean startup (no unhandled errors, no
   Prisma middleware warnings):

   ```bash
   npm run start:dev
   ```

3. **Exercise the changed endpoint(s) in Swagger UI**
   (`localhost:3000/api/docs`) — check the actual response body and status
   codes, not just that the DTO validated.

4. **Isolation smoke test, by hand** (if a tenant-scoped endpoint changed) —
   log in as tenant A, note an ID, log in as tenant B, try to access that ID
   directly. Expect `404`, not `403`.

5. **RBAC smoke test, by hand** — hit the endpoint as each role that should
   and shouldn't have access.

6. **Check the database** — `npx prisma studio` — confirm `tenant_id` is
   set correctly and nothing is silently null.

7. **Check the console logs** from your manual pass for swallowed errors or
   unexpected warnings.

8. **Reset seed data** if manual testing left the DB dirty:

   ```bash
   npx prisma db seed
   ```

Only after this passes: stage the change and commit, following the
branch-naming and Conventional Commits rules in `CLAUDE.md`.

## Troubleshooting

- **`prisma migrate dev` can't reach the database**: confirm the Postgres
  container is up and healthy (`docker ps`), and that `DATABASE_URL` in
  `.env` matches `docker-compose.yml`'s credentials.
- **Prisma client errors mentioning `adapter` or `datasource url`**: this
  project is on Prisma 7, which moved the connection URL out of
  `schema.prisma` and into `prisma.config.ts` + a driver adapter
  (`@prisma/adapter-pg`) constructed in `src/prisma/prisma.service.ts`. If
  you've regenerated the schema from an older Prisma 6 example, re-check
  that split.
- **Port 3000 already in use**: another `start:dev` process is likely still
  running — `pkill -f "nest start"` or change `PORT` in `.env`.
