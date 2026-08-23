import { InternalServerErrorException } from '@nestjs/common';

/**
 * Thrown when tenant-scoped work is attempted with no tenant in scope.
 *
 * This is always a programming error — a code path that reached the query
 * layer without going through the auth guard or an explicit
 * `runInTenant(...)` wrapper — so it surfaces as a 500, not a 4xx. The
 * important property is that it *throws* rather than falling back to an
 * unfiltered query: the isolation layer fails closed.
 */
export class TenantContextUnavailableError extends InternalServerErrorException {
  constructor(detail: string) {
    super(`Tenant context unavailable: ${detail}`);
  }
}

/**
 * Thrown when a write payload tries to set the tenant relationship itself.
 *
 * Distinct from `TenantContextUnavailableError`: the context is perfectly
 * available here, the *payload* is illegal. Which tenant a row belongs to is
 * decided by the request context and nothing else — a caller asking to change
 * it is a programming error, so this is a 500 like its sibling rather than a
 * 4xx the caller could treat as a normal outcome.
 */
export class TenantScopeViolationError extends InternalServerErrorException {
  constructor(detail: string) {
    super(`Tenant scope violation: ${detail}`);
  }
}
