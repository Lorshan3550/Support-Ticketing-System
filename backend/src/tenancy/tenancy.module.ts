import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createScopedPrismaClient, SCOPED_PRISMA } from './scoped-prisma';
import { TenantContextService } from './tenant-context.service';
import { TenantsRepository } from './tenants.repository';

/**
 * Tenant isolation infrastructure. Global because the scoped client and the
 * tenant context are cross-cutting — every feature module's repository layer
 * needs them, and threading imports through each one adds nothing.
 *
 * Note that everything here is a plain singleton. That is the whole point of
 * the AsyncLocalStorage approach: no `Scope.REQUEST`, so no scope bubbling up
 * through repositories, services and controllers.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    TenantsRepository,
    {
      provide: SCOPED_PRISMA,
      inject: [PrismaService, TenantContextService],
      useFactory: createScopedPrismaClient,
    },
  ],
  exports: [TenantContextService, TenantsRepository, SCOPED_PRISMA],
})
export class TenancyModule {}
