import { TenantContextUnavailableError } from './tenant-context.errors';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService();
  });

  describe('fails closed', () => {
    it('throws when no async context is open', () => {
      expect(() => service.getTenantId()).toThrow(
        TenantContextUnavailableError,
      );
    });

    it('throws inside an open context that has no tenant yet', () => {
      service.runWithNewContext(() => {
        expect(() => service.getTenantId()).toThrow(
          TenantContextUnavailableError,
        );
      });
    });

    it('throws when asked for a principal on an unauthenticated request', () => {
      service.runWithNewContext(() => {
        expect(() => service.getPrincipal()).toThrow(
          TenantContextUnavailableError,
        );
        expect(service.getPrincipalOrNull()).toBeNull();
      });
    });

    it('never returns undefined instead of throwing', () => {
      // The whole point: "no tenant" must not degrade into "all tenants".
      expect(() => service.getTenantId()).toThrow();
    });
  });

  describe('context propagation', () => {
    it('survives await boundaries', async () => {
      await service.runInTenant('tenant-a', async () => {
        expect(service.getTenantId()).toBe('tenant-a');
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(service.getTenantId()).toBe('tenant-a');
      });
    });

    it('keeps concurrent, interleaved requests separate', async () => {
      // This is the bug a singleton with a mutable `tenantId` field would have:
      // request B overwrites request A's tenant while A is parked on an await.
      const observe = async (tenantId: string, delay: number) =>
        service.runInTenant(tenantId, async () => {
          const before = service.getTenantId();
          await new Promise((resolve) => setTimeout(resolve, delay));
          return { before, after: service.getTenantId() };
        });

      const [a, b, c] = await Promise.all([
        observe('tenant-a', 20),
        observe('tenant-b', 5),
        observe('tenant-c', 10),
      ]);

      expect(a).toEqual({ before: 'tenant-a', after: 'tenant-a' });
      expect(b).toEqual({ before: 'tenant-b', after: 'tenant-b' });
      expect(c).toEqual({ before: 'tenant-c', after: 'tenant-c' });
    });

    it('lets a guard fill in the store the middleware opened', () => {
      service.runWithNewContext(() => {
        service.setPrincipal({
          principalType: 'user',
          principalId: 'user-1',
          tenantId: 'tenant-a',
          email: 'a@example.test',
          role: 'agent',
        });

        expect(service.getTenantId()).toBe('tenant-a');
        expect(service.getPrincipal().principalId).toBe('user-1');
      });
    });

    it('does not leak context after the scope closes', async () => {
      await service.runInTenant('tenant-a', () => service.getTenantId());
      expect(() => service.getTenantId()).toThrow(
        TenantContextUnavailableError,
      );
    });

    it('holds the context open for a lazily-started thenable', async () => {
      // Prisma returns a lazy PrismaPromise: the query starts on `.then()`,
      // not on construction. If `runInTenant` handed the object back out
      // before awaiting it, the query would run after the scope closed and
      // the isolation extension would see no tenant. Regression guard.
      let observedInsideThen: string | undefined;

      const lazy = {
        then(resolve: (value: string) => void) {
          observedInsideThen = service.getTenantId();
          resolve('done');
        },
      };

      await service.runInTenant('tenant-a', () => lazy as unknown as string);

      expect(observedInsideThen).toBe('tenant-a');
    });
  });
});
