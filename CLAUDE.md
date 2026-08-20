# Project: multi-tenant support-ticket SaaS

Portfolio project demonstrating backend depth in NestJS. Built to show hiring
managers real system-design decisions, not just CRUD. This file is context
for Claude Code — read it before making changes.

## Purpose & audience

This project exists to get an Associate/Software Engineer offer. Every
decision should optimize for "defensible in an interview," not "fastest to
ship." When in doubt, prefer the version I can explain over the version
that's 10 minutes faster to build.

## Tech stack

- Backend: NestJS (TypeScript)
- ORM: Prisma
- Database: PostgreSQL
- Auth: JWT (access + refresh tokens) for two principal types — `User` and
  `Admin` (separate tables, separate login endpoints, `principalType` claim)
- Queue: BullMQ + Redis (for notifications / background jobs)
- Frontend: React (Vite) — consumes the API, kept simple
- Tests: Jest
- API docs: Swagger / OpenAPI via `@nestjs/swagger`
- CI/CD: GitHub Actions
- Deployment: Docker + docker-compose locally; Render/Railway for live demo

## Non-negotiable architecture rule: tenant isolation

Every table that has a `tenant_id` column MUST be queried through the scoped
repository layer — never through a raw Prisma call in a service or
controller. This is the single most important rule in this codebase.

- Auth guard extracts `tenantId` and `role` from the JWT.
- A request-scoped `TenantContextService` holds `tenantId` for the life of
  the request.
- Prisma middleware (`prisma.$use`) auto-injects `where: { tenantId }` on
  every read/write to a tenant-scoped model. See `schema.prisma` for which
  models carry `tenant_id`.
- Never write a query that takes `tenantId` as a manual argument passed
  through several layers — pull it from `TenantContextService` at the
  repository boundary instead. Manual threading is how isolation bugs creep
  in.
- Any new tenant-scoped model added to `schema.prisma` must be added to the
  Prisma middleware's scoped-model list in the same commit.

If you (Claude Code) are about to write a `prisma.ticket.findMany(...)` or
similar directly in a service, stop — route it through the repository layer
instead.

## Schema

Full schema and field-by-field rationale: see `schema-reference.md`.
Prisma schema: see `schema.prisma`.

MVP models (build first): `Tenant`, `User`, `Category`, `Ticket`, `Comment`.
Everything else in `schema.prisma` is stretch — don't implement service/
controller logic for stretch models unless explicitly asked.

## Roles & permissions

Two distinct principal types — don't conflate them:

- `User` — roles: `owner`, `agent`, `customer` (see `UserRole` enum). Handles
  the ticket-facing side of the product.
- `Admin` — a **separate table**, not a `User.role` value. Admins have their
  own login endpoint, own JWT, and manage tenant settings, users, and
  categories. They are not part of the ticket-handling flow — don't wire
  `Admin` into ticket creation/assignment/comments.

Permissions:

- `customer`: can create tickets, comment on their own tickets, cannot see
  `is_internal_note` comments, cannot see other customers' tickets.
- `agent`: can view/update tickets assigned to them or unassigned, can write
  internal notes.
- `owner`: elevated `User` role, still ticket-facing. Tenant-level
  management (inviting users, editing categories, tenant settings) goes
  through `Admin`, not `owner`.
- `Admin`: full tenant-scoped management access — users, categories, audit
  logs. Enforce with a separate guard/strategy from the `User` JWT, e.g. a
  `principalType` claim (`user` | `admin`) checked at the guard level.

Enforce roles with NestJS guards (`@Roles()` decorator + `RolesGuard` for
`User`, a separate `AdminGuard` for `Admin`), not with scattered
`if (user.role === ...)` checks inside services.

## Folder structure

```
.github/
  workflows/
    ci.yml           # lint, type-check, test, build on push/PR
src/
  auth/              # JWT strategies (User + Admin), guards, login/refresh
  tenancy/           # TenantContextService, Prisma middleware
  users/
  admins/            # Admin login, tenant/user/category management
  tickets/
  comments/
  categories/
  common/            # shared decorators, pipes, filters
  prisma/            # PrismaService wrapper
  main.ts            # Nest bootstrap + Swagger setup
```

Each feature module: `*.controller.ts`, `*.service.ts`, `*.module.ts`,
`dto/` folder with `class-validator` DTOs for every input.

## Conventions

- DTOs for all request bodies, validated with `class-validator` +
  `ValidationPipe` (whitelist: true).
- Services never touch `PrismaService` directly for tenant-scoped models —
  go through the repository/middleware layer.
- Controllers stay thin: validation + calling the service, no business
  logic.
- Every new tenant-scoped feature needs at least one test proving isolation:
  user from tenant A cannot read/write tenant B's data (expect 404, not
  403 — don't leak existence).

## Manual verification before committing

Automated tests catch regressions; they don't catch "I misread the ticket
and built the wrong thing" or "this endpoint technically passes but the
response shape is wrong." Do this pass before every commit, not just
before a PR — it's fast once the seed data exists.

**Prerequisite — seed data once:** maintain `prisma/seed.ts` with 2 tenants,
and for each tenant one `owner`, one `agent`, one `customer`, and one
`Admin`. Re-seeding should be one command (`npx prisma db seed`) so this
checklist takes minutes, not a fresh setup each time.

1. **Automated checks first** — `npm run lint`, `npm run build`,
   `npm run test`. Don't do the manual pass on top of code that doesn't
   even lint.
2. **Boot the app** — `docker-compose up` (or `npm run start:dev`) and
   confirm a clean startup: no unhandled errors in the console, migrations
   applied, `TenantContextService` and Prisma middleware initialize without
   warnings.
3. **Exercise the changed endpoint(s) via Swagger UI**
   (`localhost:3000/api/docs`) — don't just trust the DTO validated, watch
   the actual response body. Check status codes match what's documented,
   not just a 200/error split.
4. **Isolation smoke test, by hand** — log in as tenant A's user, note an
   ID (a ticket, a category, whatever the endpoint touches), then log in as
   tenant B and try to access that ID directly. Confirm 404. This is the
   single most important manual check in this project — do it for every
   endpoint you touch, even if the automated isolation test also passes.
5. **RBAC smoke test, by hand** — hit the endpoint as each role that
   should and shouldn't have access (customer/agent/owner/Admin as
   relevant). Confirm the boundary is where you think it is, not just that
   *a* 403 happens somewhere.
6. **Check the database directly** — `npx prisma studio`, look at the rows
   your change created/modified. Confirm `tenant_id` is set correctly,
   foreign keys point where expected, nothing is silently null that
   shouldn't be.
7. **Check the logs** — scroll back through console output from your
   manual pass. A silently swallowed error or an unexpected warning here
   is worth chasing down before it's buried in a commit.
8. **Reset seed data** if your manual testing left the DB in a weird state,
   so the next person (or you, next session) starts clean.

Only after this passes: stage the change and commit, following the Git &
PR conventions below.

## Git & PR conventions

- Branch naming: `feature/<short-desc>`, `fix/<short-desc>`,
  `chore/<short-desc>`, `docs/<short-desc>` — e.g. `feature/ticket-assignment`.
- Commits follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `chore:`, `ci:`. Scope where useful:
  `feat(tickets): add assignment endpoint`.
- One logical change per commit — don't bundle an isolation fix with an
  unrelated feature.
- PR title mirrors the conventional commit format of its primary change.
- PR description covers: what changed, why, how to test it, and a
  checklist:
  - [ ] Tests added/updated
  - [ ] Isolation test included, if a tenant-scoped endpoint changed
  - [ ] Swagger annotations added/updated for any new or changed endpoint
  - [ ] CI passing
- Write the PR description as if a reviewer will actually read it, even on
  a solo project — this is a portfolio artifact too, and interviewers
  sometimes look at PR history.
- Squash merge into `main` to keep history readable; the branch's messy
  intermediate commits don't need to survive.
- Don't merge with failing CI, even solo — treat the pipeline as the gate
  it would be on a real team.

## API documentation (Swagger)

- Use `@nestjs/swagger`. Bootstrap in `main.ts`:
  `SwaggerModule.setup('api/docs', app, document)`.
- Every controller gets `@ApiTags('tickets')` (etc.), and `@ApiBearerAuth()`
  on any route requiring a JWT.
- Every endpoint gets `@ApiOperation({ summary: ... })` and
  `@ApiResponse(...)` for at least the success case and the auth/validation
  failure cases. Document the 404-not-403 behavior on tenant-scoped routes
  explicitly — it's a deliberate choice, not an oversight, and worth
  surfacing in the docs.
- Every DTO gets `@ApiProperty()` (or `@ApiPropertyOptional()`) on each
  field — enable the Swagger CLI plugin
  (`@nestjs/swagger/plugin` in `nest-cli.json`) so most of this is inferred
  automatically instead of hand-written.
- Treat the Swagger doc as a required part of the endpoint, not an
  afterthought — a new route without annotations isn't done yet.
- Gate `/api/docs` behind an env flag in production
  (`SWAGGER_ENABLED=true` only in dev/staging) rather than exposing it
  publicly on the live demo, unless you want it public as a portfolio
  showcase — either is a defensible choice, just make it deliberately.

## CI/CD pipeline

GitHub Actions, defined in `.github/workflows/ci.yml`.

- Trigger: on push and PR to `main`.
- Job steps: install deps → lint → type-check → `prisma generate` →
  `prisma migrate deploy` against a Postgres service container → run tests
  (including the tenant-isolation tests) → build.
- Use a `postgres:` service container in the workflow for integration
  tests — don't mock the database for isolation tests, they need to prove
  real query behavior.
- Fail the pipeline on lint errors, type errors, or any failing test — no
  soft-fail steps.
- Optional but a good signal: a separate job that builds the Docker image
  to confirm `Dockerfile` isn't broken, without pushing it anywhere.
- Deploy step: if using Render/Railway's native git integration, CI only
  needs to gate merges (deploy happens automatically on `main`). If doing
  it manually via CLI/webhook, add a `deploy` job that runs only on
  `main` after the test job succeeds.

## What NOT to do

- Don't add stretch-schema features (SLA, billing, webhooks, integrations)
  until MVP is fully working and tested.
- Don't skip the isolation test when adding a new tenant-scoped endpoint.
- Don't put authorization logic in the frontend only — every check must
  also exist server-side.
- Don't invent new tables not in `schema.prisma` without checking
  `schema-reference.md` first — it may already be scoped as stretch.
- Don't ship a new or changed endpoint without matching Swagger annotations
  — an undocumented route isn't finished.
- Don't merge a PR with a red CI pipeline, even to "fix it in the next
  commit."
- Don't commit on green tests alone — do the manual verification pass
  first, especially the isolation and RBAC smoke tests. Automated tests
  only catch what you thought to test for.

## Current focus

MVP build, in this order: auth + tenant context → users/RBAC → admins →
categories → tickets → comments. Ask before jumping ahead to stretch
features.
