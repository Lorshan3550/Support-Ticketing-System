# Daily task plan

Day-by-day breakdown of the work left to finish this project. One entry per
working day; each day is scoped to fit a single focused session and to end on
something committable.

Companion documents: `4-week-prompt-plan.md` (how to drive each session),
`CLAUDE.md` (the rules every task below must respect), `schema-reference.md`
(what each model and field is for).

Every day ends the same way: run lint, build and tests, then do the manual
verification pass in `CLAUDE.md` (boot, Swagger, isolation smoke test, RBAC
smoke test, check the rows in Prisma Studio, read the logs) and commit with a
Conventional Commit message on a `feature/*` branch.

---

## Already done — baseline

Not tasks; the ground the plan below builds on. Confirm each still holds
before starting Day 1.

- **Project scaffold** — NestJS + Prisma + Postgres booting, `docker-compose`
  Postgres service, migrations applied, health-check route.
- **Tenancy layer** — `TenantContextService` on AsyncLocalStorage, fail-closed
  accessors, `TenantContextMiddleware`, the Prisma client extension behind
  `SCOPED_PRISMA`, `TENANT_SCOPED_MODELS` with its DMMF diff test.
- **Auth** — `User` and `Admin` login/refresh endpoints, both JWT strategies,
  `principalType` claim, `RolesGuard`, `AdminGuard`, `@Roles()`,
  `@CurrentPrincipal()`, password hashing.
- **Repositories** — `TenantsRepository`, `UsersRepository`,
  `AdminsRepository`.
- **Tests** — tenant context unit tests, extension tests, auth integration
  tests, one cross-tenant isolation integration test.
- **Seed** — `prisma/seed.ts` with two tenants, each with owner/agent/customer
  plus an `Admin`.

---

# Week 1 — Users, Admins, Categories

## Day 1 — Users module

- **Decide the user-creation flow.** Choose between an `Admin` creating `User`
  rows directly and the invitation-token flow the `Invitation` model implies.
  Record the choice and the reason in `CLAUDE.md`; MVP almost certainly wants
  direct creation with the invitation flow documented as stretch.
- **Build `UsersService`.** List, get-by-id, create, update, deactivate — all
  through `UsersRepository`, no `tenantId` parameters anywhere, no direct
  `PrismaService` use.
- **Write the DTOs.** `CreateUserDto`, `UpdateUserDto`, and a query DTO for
  list pagination/filtering, all `class-validator`-decorated so
  `whitelist: true` strips anything unexpected.
- **Decide the response shape.** A `UserResponse` DTO that never exposes
  `passwordHash` — do this as an explicit mapping, not by trusting the entity
  to be safe.

## Day 2 — Users endpoints + RBAC

- **Build `UsersController`.** Thin: validate, call the service, return.
  Mounted under an admin-guarded route for management operations and a
  self-service route for "my profile".
- **Apply the permission boundary.** `Admin` manages users; `owner` reads;
  `agent`/`customer` may read themselves only. No `if (role === ...)` checks
  inside the service.
- **Return 404 for cross-tenant IDs.** Confirm the extension already produces
  this and the service does not turn a null into a 403.
- **Annotate for Swagger.** `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` and
  `@ApiResponse` per route, including an explicit note that unknown-tenant IDs
  return 404 by design.
- **Test.** Isolation test (tenant A cannot read or mutate tenant B's users)
  plus an RBAC test per role boundary.

## Day 3 — Admins module

- **Build `AdminsService` and `AdminsController`.** Admin CRUD scoped to the
  tenant, on top of the existing `AdminsRepository`, guarded by `AdminGuard`.
- **Prevent self-lockout.** An admin must not be able to delete or deactivate
  the last active admin in their tenant, nor deactivate themselves.
- **DTOs and Swagger.** Same standard as the users module; admin responses
  never include the password hash.
- **Test.** Cross-tenant isolation for admins, a `User` JWT rejected on every
  admin route, and the last-admin guard.

## Day 4 — Categories module

- **Build the module end to end.** Repository (`SCOPED_PRISMA`), service,
  controller, DTOs — tenant-scoped CRUD, the smallest complete vertical slice
  in the project.
- **Set the read/write split.** All authenticated users of the tenant can
  list categories; only `Admin` creates, renames or deletes.
- **Handle name uniqueness per tenant.** Decide whether a duplicate name is a
  409 or is allowed, and make the DB constraint and the error path agree.
- **Decide delete semantics.** Hard delete versus soft delete/archive, given
  tickets will reference categories — pick before tickets exist, not after.
- **Swagger + tests.** Isolation test and an RBAC test (a `customer` creating
  a category is 403).

## Day 5 — Review + consolidation

- **Self-review the three modules together.** Controllers thin, every
  tenant-scoped query through a repository, no manual `tenantId` threading,
  DTOs validating and stripping.
- **Audit direct Prisma use.** Grep for `PrismaService`; only
  `TenantsRepository`, the seed and lifecycle code may appear.
- **Fill test gaps.** Every tenant-scoped endpoint added this week has at
  least one isolation test; add the missing ones.
- **Update `CLAUDE.md`.** Fold in this week's decisions (invitation flow,
  category delete semantics) so the file stays true.

---

# Week 2 — Tickets

## Day 6 — Ticket design decisions

- **Fix the status model.** Which `TicketStatus` transitions are legal, who
  may perform each, and whether transitions are validated in the service or in
  a small dedicated state-machine helper.
- **Fix the assignment rules.** Who can be assigned (agents only, or owners
  too), who can assign, and whether reassignment and unassignment are allowed.
- **Fix the visibility rules per role.** `customer` sees only their own
  tickets; `agent` sees assigned plus unassigned; `owner`/`Admin` see all —
  and decide where that filter lives so it cannot be forgotten on a new query.
- **Write the decisions down** in `CLAUDE.md` before writing any ticket code.

## Day 7 — Tickets: create and read

- **Build `TicketsRepository`** on `SCOPED_PRISMA`, with the list query
  supporting filter by status, priority, category and assignee, plus stable
  pagination.
- **Build create and read in `TicketsService`.** Requester derived from the
  JWT principal, never from the request body; category validated as belonging
  to the tenant.
- **Build the read endpoints.** List and get-by-id, with the role visibility
  filter applied inside the repository/service, not the controller.
- **DTOs, Swagger, tests.** Isolation test plus a visibility test showing one
  customer cannot read another customer's ticket.

## Day 8 — Tickets: update, status, assignment

- **Build update, status change and assignment endpoints,** enforcing the
  transition and assignment rules decided on Day 6.
- **Write ticket status history.** Every status change records a
  `TicketStatusHistory` row in the same transaction as the update, so the
  history cannot drift from the ticket.
- **Set the timestamps.** `firstRespondedAt`, `resolvedAt`, `closedAt` — set
  them exactly once, on the transition that earns them.
- **Test.** An illegal transition is rejected, a legal one writes exactly one
  history row, an agent cannot touch another agent's assigned ticket.

## Day 9 — Comments module

- **Build the module end to end.** List comments on a ticket, add a comment,
  with ticket ownership/visibility checked before the comment is returned or
  created.
- **Enforce internal notes.** `isInternalNote` comments are invisible to
  `customer` — filtered in the query, not in a response mapper, so a direct
  fetch by comment ID cannot leak one.
- **Restrict who can write internal notes.** `agent`, `owner` and `Admin`
  only; a customer sending `isInternalNote: true` gets 403 or has the flag
  stripped — pick one and document it.
- **Test.** Isolation, plus a dedicated internal-note test: a customer request
  never receives an internal comment, even when the comment ID is known.

## Day 10 — Review + hardening

- **Trace the internal-note enforcement path by hand** and confirm there is no
  route into a comment that skips it.
- **Review tickets and comments as a reviewer would** — N+1 queries in list
  endpoints, missing indexes for the common filters, transaction boundaries
  around multi-write operations.
- **Run the full manual pass on the ticket lifecycle:** create as customer,
  assign as admin/agent, comment both ways, resolve and close, then check the
  rows directly.
- **Commit the MVP-complete backend** — this is the demo's core.

---

# Week 3 — Background jobs, frontend, docs

## Day 11 — BullMQ + notifications

- **Add Redis to `docker-compose`** and wire BullMQ into the app with config
  from env, not hardcoded.
- **Decide the job payload.** IDs plus the tenant ID, never full entities —
  and confirm the worker re-enters tenant context via `runInTenant`, since a
  job has no HTTP request.
- **Enqueue on domain events.** A status change and a new comment each enqueue
  exactly one notification job; enqueue must not block the response.
- **Write the worker.** Creates `Notification` rows (no real email for MVP);
  decide and document retry/backoff and what happens on permanent failure.
- **Test.** One status change enqueues exactly one job, and a job processed
  outside a request still writes to the right tenant.

## Day 12 — Frontend scaffold + auth

- **Scaffold React + Vite** in `frontend/`, with the API base URL from env.
- **Build the login screen** for `User`, storing access/refresh tokens and
  attaching the bearer token to every request.
- **Handle token refresh and expiry** in one place — an interceptor, not
  per-call handling — and redirect to login when refresh fails.
- **Set up routing and a minimal layout** with an authenticated shell. No
  design work; the flow is the deliverable.

## Day 13 — Frontend ticket flow

- **Build the ticket list** with the filters the API supports, and empty and
  loading states.
- **Build ticket detail** showing status, priority, category, assignee and the
  comment thread.
- **Build create-ticket and add-comment forms,** surfacing server validation
  errors rather than swallowing them.
- **Add the internal-note toggle** for agents, hidden entirely for customers —
  a UI convenience over an already server-enforced rule, never the enforcement
  itself.
- **Add role-aware navigation** so customers do not see agent-only actions.

## Day 14 — Test hardening

- **Inventory every tenant-scoped endpoint** and list the ones missing an
  isolation test, then write them.
- **Add auth edge cases:** expired token, malformed token, `Admin` token on a
  `User` route and vice versa, missing bearer header.
- **Add validation edge cases:** unknown fields stripped, wrong types
  rejected, enum values outside the schema rejected.
- **Check coverage** on the tenancy, auth and tickets modules and fill the
  obvious holes — coverage as a gap-finder, not a target number.

## Day 15 — Swagger + API polish

- **Audit every controller** for missing `@ApiOperation`, `@ApiResponse` and
  `@ApiBearerAuth`, and every DTO field for `@ApiProperty`.
- **Confirm the Swagger CLI plugin is enabled** in `nest-cli.json` so most
  annotations are inferred rather than hand-written.
- **Document the 404-not-403 rule** on every tenant-scoped route, since it is
  a deliberate decision and worth surfacing to a reader.
- **Normalize error responses.** One exception filter, one error shape, no
  internal messages or stack traces leaking to clients.
- **Read the rendered docs end to end** as an outside consumer would.

---

# Week 4 — CI/CD, deployment, writeup

## Day 16 — CI pipeline

- **Write `.github/workflows/ci.yml`:** install, lint, type-check,
  `prisma generate`, `prisma migrate deploy` against a Postgres service
  container, full test suite, build.
- **Run integration tests against real Postgres** in CI — the isolation tests
  prove query behavior and mean nothing mocked.
- **Fail hard.** No `continue-on-error`; lint errors, type errors and failing
  tests all break the build.
- **Add a Docker build job** that builds the image without pushing, so a
  broken `Dockerfile` is caught at PR time.

## Day 17 — Docker + deployment prep

- **Write the production `Dockerfile`** — multi-stage, non-root user, only
  production dependencies in the final image.
- **Extend `docker-compose`** to run API, Postgres and Redis together for a
  one-command local demo.
- **Audit configuration.** Every env var documented in `.env.example`, no
  secrets committed, the app failing fast on missing required config.
- **Decide migration strategy on deploy** — `migrate deploy` on container
  start versus a separate release step — and document the choice.
- **Gate Swagger** behind `SWAGGER_ENABLED` and decide deliberately whether
  the live demo exposes it.

## Day 18 — Deploy

- **Provision the backend** on Render or Railway with managed Postgres and
  Redis, and run migrations against it.
- **Seed demo data** on the live database, with clearly labelled demo
  credentials for each role in both tenants.
- **Deploy the frontend** to Vercel or Netlify, pointed at the live API.
- **Fix CORS and cookie/token handling** for the real cross-origin setup.
- **Smoke test production:** log in as each role in both tenants, run the full
  ticket lifecycle, and confirm the cross-tenant 404 holds live.

## Day 19 — README + writeup

- **Write the README for a hiring manager reading for two minutes:** what the
  project is, the live demo link, demo credentials, a screenshot or two.
- **Document the architecture,** including how a request flows from middleware
  through the JWT strategy into tenant context and down to a scoped query.
- **Write the design-decisions section:** shared-schema multi-tenancy, the
  client extension over `$use`, AsyncLocalStorage over `Scope.REQUEST`,
  `Admin` as a separate table, 404 over 403.
- **State the known boundaries honestly** — relation includes from a
  non-scoped root, raw SQL bypassing the extension — and what is MVP versus
  documented-but-not-built.
- **Document how to run it locally and how to run the tests.**

## Day 20 — Final review

- **Verify every tenant-scoped model** appears in `TENANT_SCOPED_MODELS` and
  that its diff test passes.
- **Do a full manual pass** across every endpoint one last time, isolation and
  RBAC smoke tests included.
- **Re-read `CLAUDE.md`** and correct anything that no longer matches the
  code — it is a portfolio artifact too.
- **Write the honest defect list** of everything a real reviewer would flag,
  then fix what is cheap and record the rest as known limitations.
- **Tidy the repo:** dead code, stray TODOs, commented-out blocks, unused
  dependencies, and a readable commit history on `main`.

---

## Buffer and cut order

Two spare days are assumed somewhere in weeks 3–4; portfolio projects always
need them. If the schedule slips, cut in this order:

1. Frontend polish — a plain UI over a solid API interviews well.
2. The BullMQ notification feature — impressive, but not load-bearing.
3. Stretch schema features — they are already out of MVP scope.

Never cut: isolation tests, RBAC enforcement, Swagger annotations, or the
README's design-decisions section. Those are the parts being evaluated.
