import {
  TenantContextUnavailableError,
  TenantScopeViolationError,
} from './tenant-context.errors';
import {
  isTenantScopedModel,
  TENANT_RELATION_FIELD,
} from './tenant-scoped-models';
import type { TenantContextService } from './tenant-context.service';

type QueryArgs = Record<string, unknown> | undefined;

interface AllOperationsParams {
  model?: string;
  operation: string;
  args: QueryArgs;
  query: (args: QueryArgs) => Promise<unknown>;
}

/** Merges `tenantId` into a `where` clause without mutating the caller's object. */
function scopeWhere(
  args: QueryArgs,
  tenantId: string,
): Record<string, unknown> {
  const where = (args?.where ?? {}) as Record<string, unknown>;
  return { ...args, where: { ...where, tenantId } };
}

/**
 * Rejects a write payload that sets the tenant relationship through Prisma's
 * *checked* input shape.
 *
 * Prisma emits two vocabularies for the same foreign key and accepts either
 * (`data: XOR<XUpdateInput, XUncheckedUpdateInput>`):
 *
 *   unchecked:  { tenantId: 'other-tenant' }
 *   checked:    { tenant: { connect: { id: 'other-tenant' } } }
 *
 * Both compile to `SET tenant_id = 'other-tenant'`. `stripTenantId` below
 * handles the unchecked form; this handles the checked one. Stripping was the
 * wrong tool for it — the checked input carries no `tenantId` key to strip, so
 * a denylist over key names silently let the relation form through. Throwing
 * also beats stripping on its merits: silently discarding half a caller's
 * payload hides the mistake, and this is always a mistake.
 *
 * Only the top level of each payload object is inspected, matching the
 * extension's documented boundary — nested writes reached from a relation are
 * not rewritten at all.
 */
function assertNoTenantRelationWrite(data: unknown, operation: string): void {
  if (Array.isArray(data)) {
    for (const row of data) {
      assertNoTenantRelationWrite(row, operation);
    }
    return;
  }
  if (data && typeof data === 'object' && TENANT_RELATION_FIELD in data) {
    throw new TenantScopeViolationError(
      `${operation} payload sets the \`${TENANT_RELATION_FIELD}\` relation on a ` +
        'tenant-scoped model. Which tenant a row belongs to comes from the ' +
        'request context, never from the caller — remove the relation from the ' +
        'write payload.',
    );
  }
}

/**
 * Strips the scalar `tenantId` from a write payload so a caller cannot move a
 * row into another tenant. The scope always comes from the request context,
 * never from the request body.
 *
 * This covers Prisma's *unchecked* input shape only. The *checked* shape
 * expresses the same change as a `tenant` relation and is rejected outright by
 * `assertNoTenantRelationWrite` above.
 */
function stripTenantId(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(stripTenantId);
  }
  if (data && typeof data === 'object') {
    const rest = { ...(data as Record<string, unknown>) };
    delete rest.tenantId;
    return rest;
  }
  return data;
}

function withTenantId(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => withTenantId(row, tenantId));
  }
  return { ...(data as Record<string, unknown>), tenantId };
}

/**
 * Rewrites one Prisma operation so it can only touch the current tenant's rows.
 *
 * Reads and targeted writes get `tenantId` merged into `where` — valid on
 * `findUnique`/`update`/`delete` too, because `extendedWhereUnique` is GA in
 * Prisma 5+ and unique-where inputs accept extra scalar filters. Creates get
 * `tenantId` forced into `data`.
 *
 * Write payloads are additionally checked for an attempt to set the tenant
 * relationship in either of the two shapes Prisma accepts — see
 * `assertNoTenantRelationWrite` and `stripTenantId`.
 *
 * Unknown operations throw. If a future Prisma release adds an operation this
 * switch does not recognise, the isolation layer fails closed rather than
 * quietly letting an unfiltered query through.
 */
export function scopeOperationToTenant(
  operation: string,
  args: QueryArgs,
  tenantId: string,
): QueryArgs {
  switch (operation) {
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findMany':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'deleteMany':
      return scopeWhere(args, tenantId);

    case 'delete':
      return scopeWhere(args, tenantId);

    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn': {
      assertNoTenantRelationWrite(args?.data, operation);
      const scoped = scopeWhere(args, tenantId);
      return { ...scoped, data: stripTenantId(scoped.data) };
    }

    case 'create':
    case 'createMany':
    case 'createManyAndReturn':
      assertNoTenantRelationWrite(args?.data, operation);
      return { ...args, data: withTenantId(args?.data, tenantId) };

    case 'upsert': {
      assertNoTenantRelationWrite(args?.create, operation);
      assertNoTenantRelationWrite(args?.update, operation);
      const scoped = scopeWhere(args, tenantId);
      return {
        ...scoped,
        create: withTenantId(scoped.create, tenantId),
        update: stripTenantId(scoped.update),
      };
    }

    default:
      throw new TenantContextUnavailableError(
        `unhandled Prisma operation "${operation}" on a tenant-scoped model — ` +
          'add it to scopeOperationToTenant before using it',
      );
  }
}

/**
 * The Prisma client extension that enforces tenant isolation.
 *
 * Built once at application boot and shared by every request. It reads the
 * tenant from AsyncLocalStorage at *query* time, which is exactly why the
 * context is ALS-backed rather than a request-scoped provider — a boot-time
 * singleton has no way to inject a per-request object.
 *
 * KNOWN BOUNDARIES (deliberate, not oversights):
 *   - Only top-level operation args are rewritten. A nested write or a
 *     relation `include` reached from a NON-scoped root (e.g. starting a query
 *     at `Tenant` and including `users`) is not filtered. Tenant lookups
 *     therefore go through `TenantsRepository` on the raw client and select
 *     scalars only; never traverse into tenant-scoped relations from `Tenant`.
 *   - `$queryRaw` / `$executeRaw` bypass model operations entirely and are not
 *     covered. Raw SQL against tenant-scoped tables must not be used.
 *   - Models scoped transitively (`Comment`, `Attachment`, ...) carry no
 *     `tenant_id`, so they are reached through a scoped parent lookup instead.
 *     Note this fails OPEN: those models are not recognised as scoped, so
 *     their queries pass through unfiltered.
 *   - A write payload may not set the tenant relationship in EITHER shape:
 *     the scalar `tenantId` is stripped and the `tenant` relation is rejected.
 *     Only the top level of each payload is inspected, so a nested write
 *     reached from a relation is not covered.
 */
export function tenantIsolationExtension(tenantContext: TenantContextService) {
  return {
    name: 'tenant-isolation',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }: AllOperationsParams) {
          if (!isTenantScopedModel(model)) {
            return query(args);
          }
          // Throws if no tenant is in scope. Fail closed — never fall back to
          // an unfiltered query.
          const tenantId = tenantContext.getTenantId();
          return query(scopeOperationToTenant(operation, args, tenantId));
        },
      },
    },
  };
}
