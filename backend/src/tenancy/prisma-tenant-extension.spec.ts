import { scopeOperationToTenant } from './prisma-tenant-extension';
import {
  TenantContextUnavailableError,
  TenantScopeViolationError,
} from './tenant-context.errors';

const TENANT = 'tenant-a';

describe('scopeOperationToTenant', () => {
  describe('reads', () => {
    it.each([
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ])('merges tenantId into the where clause for %s', (operation) => {
      expect(
        scopeOperationToTenant(operation, { where: { id: 'x' } }, TENANT),
      ).toEqual({ where: { id: 'x', tenantId: TENANT } });
    });

    it('adds a where clause when the caller supplied none', () => {
      expect(scopeOperationToTenant('findMany', undefined, TENANT)).toEqual({
        where: { tenantId: TENANT },
      });
    });

    it('overrides a caller-supplied tenantId in the where clause', () => {
      expect(
        scopeOperationToTenant(
          'findMany',
          { where: { tenantId: 'tenant-b' } },
          TENANT,
        ),
      ).toEqual({ where: { tenantId: TENANT } });
    });

    it('preserves other args such as select and orderBy', () => {
      expect(
        scopeOperationToTenant(
          'findMany',
          { select: { id: true }, orderBy: { createdAt: 'desc' } },
          TENANT,
        ),
      ).toEqual({
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        where: { tenantId: TENANT },
      });
    });

    it('does not mutate the caller args object', () => {
      const args = { where: { id: 'x' } };
      scopeOperationToTenant('findMany', args, TENANT);
      expect(args).toEqual({ where: { id: 'x' } });
    });
  });

  describe('writes', () => {
    it('forces tenantId onto create data', () => {
      expect(
        scopeOperationToTenant('create', { data: { name: 'n' } }, TENANT),
      ).toEqual({ data: { name: 'n', tenantId: TENANT } });
    });

    it('overrides a caller-supplied tenantId on create', () => {
      expect(
        scopeOperationToTenant(
          'create',
          { data: { name: 'n', tenantId: 'tenant-b' } },
          TENANT,
        ),
      ).toEqual({ data: { name: 'n', tenantId: TENANT } });
    });

    it('forces tenantId onto every row of createMany', () => {
      expect(
        scopeOperationToTenant(
          'createMany',
          { data: [{ name: 'a' }, { name: 'b', tenantId: 'tenant-b' }] },
          TENANT,
        ),
      ).toEqual({
        data: [
          { name: 'a', tenantId: TENANT },
          { name: 'b', tenantId: TENANT },
        ],
      });
    });

    it('scopes update by tenant and refuses to move a row between tenants', () => {
      expect(
        scopeOperationToTenant(
          'update',
          { where: { id: 'x' }, data: { name: 'n', tenantId: 'tenant-b' } },
          TENANT,
        ),
      ).toEqual({
        where: { id: 'x', tenantId: TENANT },
        data: { name: 'n' },
      });
    });

    it.each(['delete', 'deleteMany'])('scopes %s by tenant', (operation) => {
      expect(
        scopeOperationToTenant(operation, { where: { id: 'x' } }, TENANT),
      ).toEqual({ where: { id: 'x', tenantId: TENANT } });
    });

    /**
     * Prisma accepts two vocabularies for the same foreign key and the
     * isolation layer has to block both. Stripping the scalar `tenantId` alone
     * left the relation form wide open: the checked input carries no
     * `tenantId` key to strip, so `data: { tenant: { connect: ... } }` reached
     * the database as `SET tenant_id = <other tenant>` and pushed the caller's
     * own row out of their tenant.
     */
    describe('the checked-input escape hatch', () => {
      const connectToOtherTenant = { connect: { id: 'tenant-b' } };

      it.each(['update', 'updateMany', 'updateManyAndReturn'])(
        'refuses to %s a row into another tenant via the relation',
        (operation) => {
          expect(() =>
            scopeOperationToTenant(
              operation,
              { where: { id: 'x' }, data: { tenant: connectToOtherTenant } },
              TENANT,
            ),
          ).toThrow(TenantScopeViolationError);
        },
      );

      it.each(['create', 'createManyAndReturn'])(
        'refuses to %s a row into another tenant via the relation',
        (operation) => {
          expect(() =>
            scopeOperationToTenant(
              operation,
              { data: { name: 'n', tenant: connectToOtherTenant } },
              TENANT,
            ),
          ).toThrow(TenantScopeViolationError);
        },
      );

      it('checks every row of a createMany payload, not just the first', () => {
        expect(() =>
          scopeOperationToTenant(
            'createMany',
            {
              data: [
                { name: 'a' },
                { name: 'b', tenant: connectToOtherTenant },
              ],
            },
            TENANT,
          ),
        ).toThrow(TenantScopeViolationError);
      });

      it.each(['create', 'update'])(
        'rejects the %s half of an upsert',
        (half) => {
          expect(() =>
            scopeOperationToTenant(
              'upsert',
              {
                where: { id: 'x' },
                create: { name: 'n' },
                update: { name: 'n2' },
                [half]: { name: 'n', tenant: connectToOtherTenant },
              },
              TENANT,
            ),
          ).toThrow(TenantScopeViolationError);
        },
      );

      it('leaves other relations alone', () => {
        // Only the tenant relation is forbidden. Scoping a ticket to its
        // category is ordinary, legitimate work.
        expect(() =>
          scopeOperationToTenant(
            'update',
            {
              where: { id: 'x' },
              data: { category: { connect: { id: 'cat-1' } } },
            },
            TENANT,
          ),
        ).not.toThrow();
      });
    });

    it('scopes both halves of an upsert', () => {
      expect(
        scopeOperationToTenant(
          'upsert',
          {
            where: { id: 'x' },
            create: { name: 'n' },
            update: { name: 'n2', tenantId: 'tenant-b' },
          },
          TENANT,
        ),
      ).toEqual({
        where: { id: 'x', tenantId: TENANT },
        create: { name: 'n', tenantId: TENANT },
        update: { name: 'n2' },
      });
    });
  });

  it('fails closed on an operation it does not recognise', () => {
    // If a future Prisma release adds an operation, isolation must break
    // loudly rather than let an unfiltered query through.
    expect(() =>
      scopeOperationToTenant('someFutureOperation', {}, TENANT),
    ).toThrow(TenantContextUnavailableError);
  });
});
