import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaModule } from '../prisma/prisma.module';
import { SCOPED_PRISMA, type ScopedPrismaClient } from './scoped-prisma';
import { TenancyModule } from './tenancy.module';
import {
  TenantContextUnavailableError,
  TenantScopeViolationError,
} from './tenant-context.errors';
import { TenantContextService } from './tenant-context.service';

/**
 * Proves tenant isolation against a real Postgres. CLAUDE.md is explicit that
 * these must not be mocked — the whole claim is about query behaviour, and a
 * mock would happily agree with a broken extension.
 */
describe('tenant isolation (integration)', () => {
  let moduleRef: TestingModule;
  let prisma: ScopedPrismaClient;
  let tenantContext: TenantContextService;

  // Raw client, used only for cross-tenant fixture setup and assertions —
  // exactly the thing application code is forbidden from doing.
  let raw: PrismaClient;

  const suffix = randomUUID().slice(0, 8);
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        TenancyModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get<ScopedPrismaClient>(SCOPED_PRISMA);
    tenantContext = moduleRef.get(TenantContextService);

    raw = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    const makeTenant = async (name: string) => {
      const tenant = await raw.tenant.create({
        data: { name, subdomain: `iso-${name}-${suffix}` },
      });
      const user = await raw.user.create({
        data: {
          tenantId: tenant.id,
          email: `agent@${name}-${suffix}.test`,
          fullName: `${name} agent`,
          passwordHash: 'not-a-real-hash',
          role: UserRole.agent,
        },
      });
      return { tenantId: tenant.id, userId: user.id };
    };

    ({ tenantId: tenantA, userId: userA } = await makeTenant('a'));
    ({ tenantId: tenantB, userId: userB } = await makeTenant('b'));
  });

  afterAll(async () => {
    if (raw) {
      await raw.category.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
      await raw.user.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
      await raw.tenant.deleteMany({
        where: { id: { in: [tenantA, tenantB] } },
      });
      await raw.$disconnect();
    }
    await moduleRef?.close();
  });

  it('refuses to run a tenant-scoped query with no tenant in scope', async () => {
    await expect(prisma.user.findMany()).rejects.toThrow(
      TenantContextUnavailableError,
    );
  });

  it('returns only the current tenant rows from findMany', async () => {
    const rows = await tenantContext.runInTenant(tenantA, () =>
      prisma.user.findMany({ select: { id: true, tenantId: true } }),
    );

    expect(rows.map((row) => row.id)).toEqual([userA]);
    expect(rows.every((row) => row.tenantId === tenantA)).toBe(true);
  });

  it('cannot read another tenant row by its id — it reads as non-existent', async () => {
    // The 404-not-403 rule starts here: the row is invisible, so the service
    // layer above cannot accidentally leak that it exists.
    const found = await tenantContext.runInTenant(tenantA, () =>
      prisma.user.findUnique({ where: { id: userB } }),
    );

    expect(found).toBeNull();
  });

  it('cannot update another tenant row', async () => {
    await expect(
      tenantContext.runInTenant(tenantA, () =>
        prisma.user.update({
          where: { id: userB },
          data: { fullName: 'hijacked' },
        }),
      ),
    ).rejects.toThrow();

    const untouched = await raw.user.findUniqueOrThrow({
      where: { id: userB },
    });
    expect(untouched.fullName).not.toBe('hijacked');
  });

  it('cannot delete another tenant rows with deleteMany', async () => {
    const result = await tenantContext.runInTenant(tenantA, () =>
      prisma.user.deleteMany({ where: { id: userB } }),
    );

    expect(result.count).toBe(0);
    expect(await raw.user.findUnique({ where: { id: userB } })).not.toBeNull();
  });

  it('stamps the context tenant onto creates and ignores a supplied tenantId', async () => {
    const created = await tenantContext.runInTenant(tenantA, () =>
      prisma.category.create({
        // `tenantId` is injected at runtime by the extension; the generated
        // types still require it, so repositories narrow it away at their
        // boundary. Cast here to exercise the hostile case: a caller trying to
        // plant another tenant's id.
        data: { name: `cat-${suffix}`, tenantId: tenantB },
        select: { id: true, tenantId: true },
      }),
    );

    expect(created.tenantId).toBe(tenantA);
  });

  /**
   * The scalar `tenantId` above is only half the attack surface. Prisma
   * accepts the same change expressed as a relation, and that form carries no
   * `tenantId` key for the extension to strip — so before this was fixed, a
   * caller could push one of their OWN rows out into another tenant. The
   * `where` clause was never the weak point; the payload was.
   */
  it('refuses to move a row into another tenant via the tenant relation', async () => {
    const mine = await tenantContext.runInTenant(tenantA, () =>
      prisma.category.create({
        data: { name: `move-${suffix}`, tenantId: tenantA },
        select: { id: true },
      }),
    );

    await expect(
      tenantContext.runInTenant(tenantA, () =>
        prisma.category.update({
          where: { id: mine.id },
          data: { tenant: { connect: { id: tenantB } } },
        }),
      ),
    ).rejects.toThrow(TenantScopeViolationError);

    // Read back on the RAW client: the scoped client could not see the row
    // any more if the move had actually gone through, which would make a
    // scoped assertion pass for the wrong reason.
    const unmoved = await raw.category.findUniqueOrThrow({
      where: { id: mine.id },
      select: { tenantId: true },
    });
    expect(unmoved.tenantId).toBe(tenantA);
  });

  it('scopes counts and aggregates', async () => {
    const count = await tenantContext.runInTenant(tenantB, () =>
      prisma.user.count(),
    );
    expect(count).toBe(1);
  });

  it('leaves non-tenant-scoped models alone', async () => {
    // `Tenant` has no tenant_id column, so the extension must not rewrite it.
    const tenant = await tenantContext.runInTenant(tenantA, () =>
      prisma.tenant.findUnique({
        where: { id: tenantB },
        select: { id: true },
      }),
    );
    expect(tenant?.id).toBe(tenantB);
  });

  it('keeps concurrent tenants apart under interleaved queries', async () => {
    const [fromA, fromB] = await Promise.all([
      tenantContext.runInTenant(tenantA, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return prisma.user.findMany({ select: { tenantId: true } });
      }),
      tenantContext.runInTenant(tenantB, () =>
        prisma.user.findMany({ select: { tenantId: true } }),
      ),
    ]);

    expect(fromA.every((row) => row.tenantId === tenantA)).toBe(true);
    expect(fromB.every((row) => row.tenantId === tenantB)).toBe(true);
  });
});
