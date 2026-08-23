import {
  TENANT_RELATION_FIELD,
  TENANT_SCOPED_MODELS,
  tenantRelationFieldsFromSchema,
  tenantScopedModelsFromSchema,
} from './tenant-scoped-models';

/**
 * CLAUDE.md requires that any new tenant-scoped model added to
 * `schema.prisma` is registered with the isolation layer in the same commit.
 * This turns that convention into a failing test instead of a code-review
 * habit: a model with a `tenantId` field that nobody registered would
 * otherwise be queried completely unfiltered.
 */
describe('tenant-scoped model registry', () => {
  it('matches every model in schema.prisma that has a tenantId field', () => {
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(
      tenantScopedModelsFromSchema(),
    );
  });

  it('does not register models that have no tenantId column', () => {
    // These are scoped transitively through a parent row, not by a column.
    for (const model of [
      'Tenant',
      'Comment',
      'Attachment',
      'TeamMember',
      'TicketTag',
      'TicketStatusHistory',
      'SlaBreach',
      'CustomerSatisfactionRating',
    ]) {
      expect(TENANT_SCOPED_MODELS as readonly string[]).not.toContain(model);
    }
  });

  /**
   * The isolation extension blocks the checked-input escape hatch
   * (`data: { tenant: { connect: ... } }`) by rejecting one hardcoded key
   * name. That is only sound while every scoped model actually spells the
   * relation that way — a model declaring `org Tenant @relation(...)` would
   * slip straight past the check. Pin it here.
   */
  describe('tenant relation field name', () => {
    const relationsByModel = tenantRelationFieldsFromSchema();

    it.each([...TENANT_SCOPED_MODELS])(
      '%s names its Tenant relation `tenant`',
      (model) => {
        expect(relationsByModel[model]).toEqual([TENANT_RELATION_FIELD]);
      },
    );

    it('finds a Tenant relation on exactly the models registered as scoped', () => {
      const withRelation = Object.entries(relationsByModel)
        .filter(([, fields]) => fields.length > 0)
        .map(([model]) => model)
        .sort();

      expect(withRelation).toEqual([...TENANT_SCOPED_MODELS].sort());
    });
  });
});
