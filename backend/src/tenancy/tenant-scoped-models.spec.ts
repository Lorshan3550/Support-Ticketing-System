import {
  TENANT_SCOPED_MODELS,
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
});
