import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { TenantContextUnavailableError } from './tenant-context.errors';
import type {
  AuthenticatedPrincipal,
  TenantContextStore,
} from './tenant-context.types';

/**
 * Ambient per-request tenant context, backed by Node's AsyncLocalStorage.
 *
 * WHY ALS AND NOT `Scope.REQUEST`
 * ------------------------------
 * Node has no threads to hang a thread-local on: one thread interleaves many
 * requests at every `await`, so a singleton holding a mutable `tenantId` field
 * would be overwritten by a concurrent request — a silent, load-dependent
 * cross-tenant read. Both `Scope.REQUEST` and AsyncLocalStorage solve that.
 * We use ALS because:
 *
 *   1. The Prisma client extension that enforces isolation is built ONCE at
 *      boot (`$extends` returns a new client object). A boot-time singleton
 *      cannot inject a request-scoped provider, and making `PrismaService`
 *      request-scoped would churn a connection pool per request.
 *   2. Request scope "bubbles up": any provider injecting a request-scoped
 *      provider becomes request-scoped too, all the way to the controller.
 *      ALS leaves the DI graph entirely singleton.
 *   3. Background work (BullMQ notification jobs, cron, scripts) has no HTTP
 *      request at all. `runInTenant(...)` gives those the same mechanism the
 *      request path uses, instead of a second code path.
 *
 * The cost of ALS is that the dependency is implicit — a repository reading
 * this store does not declare it in its constructor. That is mitigated two
 * ways: this is an injectable service (so consumers *do* declare it), and
 * every accessor below fails closed rather than returning `undefined`.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContextStore>();

  /**
   * Opens an empty context for the life of a request. Called by
   * `TenantContextMiddleware` at the very edge, before guards run, so that the
   * JWT strategy has a store to write into.
   *
   * The callback is Express's `next`, which kicks off the rest of the request
   * synchronously. Everything downstream inherits this context because their
   * async chains START inside it.
   */
  runWithNewContext(callback: () => void): void {
    this.storage.run({}, callback);
  }

  /**
   * Runs `callback` scoped to a known tenant with no authenticated principal.
   *
   * Used by the login flow (tenant resolved from subdomain, credentials then
   * looked up through the scoped client) and by background jobs that carry a
   * tenant id in their payload.
   *
   * The `await` inside the wrapper is load-bearing, not stylistic. Prisma
   * returns a LAZY `PrismaPromise`: constructing it does nothing, and the
   * query only starts when something calls `.then()`. Handing that object back
   * out of `storage.run(...)` and awaiting it at the call site would start the
   * query AFTER this context closed, and the isolation extension would find no
   * tenant. Awaiting here forces `.then()` to fire while the context is still
   * open. `tenant-context.service.spec.ts` pins this behaviour.
   */
  async runInTenant<T>(
    tenantId: string,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    return this.storage.run({ tenantId }, async () => await callback());
  }

  /** Establishes tenant scope inside an already-open context. */
  setTenantId(tenantId: string): void {
    this.requireStore('setTenantId called outside a request context').tenantId =
      tenantId;
  }

  /** Records the authenticated principal and its tenant. */
  setPrincipal(principal: AuthenticatedPrincipal): void {
    const store = this.requireStore(
      'setPrincipal called outside a request context',
    );
    store.principal = principal;
    store.tenantId = principal.tenantId;
  }

  /**
   * The tenant every scoped query is filtered by. Throws if absent — never
   * returns `undefined`, because "no tenant" must never degrade into "all
   * tenants".
   */
  getTenantId(): string {
    const store = this.requireStore(
      'no async context is open (is TenantContextMiddleware applied?)',
    );
    if (!store.tenantId) {
      throw new TenantContextUnavailableError(
        'no tenant in scope for this operation',
      );
    }
    return store.tenantId;
  }

  /** The authenticated principal. Throws if the request is unauthenticated. */
  getPrincipal(): AuthenticatedPrincipal {
    const principal = this.requireStore(
      'no async context is open (is TenantContextMiddleware applied?)',
    ).principal;
    if (!principal) {
      throw new TenantContextUnavailableError(
        'no authenticated principal in scope',
      );
    }
    return principal;
  }

  getPrincipalOrNull(): AuthenticatedPrincipal | null {
    return this.storage.getStore()?.principal ?? null;
  }

  hasTenant(): boolean {
    return Boolean(this.storage.getStore()?.tenantId);
  }

  private requireStore(detail: string): TenantContextStore {
    const store = this.storage.getStore();
    if (!store) {
      throw new TenantContextUnavailableError(detail);
    }
    return store;
  }
}
