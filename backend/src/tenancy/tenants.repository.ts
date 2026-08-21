import { Injectable } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `Tenant` is the one model with no `tenant_id` — it *is* the tenant — so this
 * repository uses the raw client. It selects scalars only and never traverses
 * into tenant-scoped relations, because the isolation extension rewrites
 * top-level args only and would not filter a nested `include`.
 */
@Injectable()
export class TenantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the tenant a login attempt is for. Suspended tenants are treated
   * as non-existent so a caller cannot distinguish "wrong subdomain" from
   * "suspended account".
   */
  async findLoginableBySubdomain(subdomain: string) {
    return this.prisma.tenant.findFirst({
      where: {
        subdomain,
        status: { in: [TenantStatus.active, TenantStatus.trial] },
      },
      select: { id: true, name: true, subdomain: true, status: true },
    });
  }
}
