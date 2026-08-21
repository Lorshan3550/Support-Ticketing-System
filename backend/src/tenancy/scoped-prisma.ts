import { Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tenantIsolationExtension } from './prisma-tenant-extension';
import type { TenantContextService } from './tenant-context.service';

/**
 * The tenant-isolated Prisma client.
 *
 * Created once at boot from the singleton `PrismaService`, so it shares the
 * same connection pool. `$extends` returns a NEW client object rather than
 * mutating the original, which is why this is a separate DI token: it makes
 * "raw client" and "tenant-scoped client" two different, greppable things.
 *
 * Rule of thumb — repositories for tenant-scoped models inject
 * `SCOPED_PRISMA`; only `TenantsRepository` and lifecycle code inject
 * `PrismaService` directly.
 */
export function createScopedPrismaClient(
  prisma: PrismaService,
  tenantContext: TenantContextService,
) {
  return prisma.$extends(tenantIsolationExtension(tenantContext));
}

export type ScopedPrismaClient = ReturnType<typeof createScopedPrismaClient>;

export const SCOPED_PRISMA = Symbol('SCOPED_PRISMA');

/** Sugar for `@Inject(SCOPED_PRISMA)`. */
export const InjectScopedPrisma = () => Inject(SCOPED_PRISMA);
