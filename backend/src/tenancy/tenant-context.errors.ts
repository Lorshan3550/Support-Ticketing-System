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
