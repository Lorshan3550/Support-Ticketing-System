import { PrismaClient, TenantPlan, TenantStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

/**
 * Seeds two tenants, each with one owner, one agent, one customer and one
 * Admin — the fixture the manual verification pass in CLAUDE.md assumes.
 *
 * This deliberately uses the RAW Prisma client, not the tenant-scoped one.
 * Seeding writes across tenants by definition, so it is the one place that
 * legitimately sets `tenantId` by hand. Nothing inside `src/` may do this.
 */

const SEED_PASSWORD = 'Password123!';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

interface TenantSeed {
  name: string;
  subdomain: string;
  plan: TenantPlan;
  status: TenantStatus;
}

const TENANTS: TenantSeed[] = [
  {
    name: 'Acme Corp',
    subdomain: 'acme',
    plan: TenantPlan.pro,
    status: TenantStatus.active,
  },
  {
    name: 'Globex Inc',
    subdomain: 'globex',
    plan: TenantPlan.free,
    status: TenantStatus.trial,
  },
];

async function seedTenant(seed: TenantSeed, passwordHash: string) {
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: seed.subdomain },
    update: { name: seed.name, plan: seed.plan, status: seed.status },
    create: seed,
  });

  const users: Array<{ role: UserRole; fullName: string }> = [
    { role: UserRole.owner, fullName: `${seed.name} Owner` },
    { role: UserRole.agent, fullName: `${seed.name} Agent` },
    { role: UserRole.customer, fullName: `${seed.name} Customer` },
  ];

  for (const { role, fullName } of users) {
    const email = `${role}@${seed.subdomain}.test`;
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: { fullName, role, passwordHash, isActive: true },
      create: { tenantId: tenant.id, email, fullName, role, passwordHash },
    });
  }

  const adminEmail = `admin@${seed.subdomain}.test`;
  await prisma.admin.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
    update: { fullName: `${seed.name} Admin`, passwordHash, isActive: true },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      fullName: `${seed.name} Admin`,
      passwordHash,
    },
  });

  console.log(
    `  ${seed.subdomain}: owner/agent/customer + admin  (tenantId ${tenant.id})`,
  );
}

async function main() {
  const passwordHash = await bcrypt.hash(
    SEED_PASSWORD,
    Number(process.env.BCRYPT_ROUNDS ?? 12),
  );

  console.log('Seeding tenants...');
  for (const tenant of TENANTS) {
    await seedTenant(tenant, passwordHash);
  }
  console.log(`\nAll seeded principals use the password: ${SEED_PASSWORD}`);
  console.log('Log in with e.g. { subdomain: "acme", email: "agent@acme.test" }');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
