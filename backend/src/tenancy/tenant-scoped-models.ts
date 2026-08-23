import { Prisma } from '@prisma/client';

/**
 * Every model carrying a `tenant_id` column.
 *
 * CLAUDE.md rule: any new tenant-scoped model added to `schema.prisma` must be
 * added here in the same commit. `tenant-scoped-models.spec.ts` enforces that
 * mechanically by diffing this list against the Prisma DMMF, so forgetting is
 * a failing test rather than a silent isolation hole.
 *
 * Models deliberately absent because they carry no `tenant_id`:
 *   - `Tenant` itself (it *is* the tenant)
 *   - `Comment`, `Attachment`, `TeamMember`, `TicketTag`,
 *     `TicketStatusHistory`, `SlaBreach`, `CustomerSatisfactionRating`
 *     — these are scoped transitively through their parent row, so the
 *     services that read them must reach them via a scoped parent lookup.
 */
export const TENANT_SCOPED_MODELS = [
  'User',
  'Admin',
  'Team',
  'Invitation',
  'Category',
  'Ticket',
  'Tag',
  'SlaPolicy',
  'CannedResponse',
  'Notification',
  'AuditLog',
  'Webhook',
  'Integration',
  'Subscription',
  'KnowledgeBaseArticle',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

const scopedModelSet: ReadonlySet<string> = new Set(TENANT_SCOPED_MODELS);

export function isTenantScopedModel(model: string | undefined): boolean {
  return model !== undefined && scopedModelSet.has(model);
}

/** Models the DMMF reports as having a `tenantId` field. Used by the drift test. */
export function tenantScopedModelsFromSchema(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name)
    .sort();
}

/**
 * The relation field pointing back at `Tenant` on every scoped model.
 *
 * Prisma generates TWO input shapes for the same write and accepts either:
 * the *unchecked* form takes the raw foreign key (`tenantId: '...'`), while
 * the *checked* form takes this relation (`tenant: { connect: { id: '...' } }`).
 * Both compile to the same `SET tenant_id = ...`. The isolation extension has
 * to block both, so it needs to know this field's name.
 *
 * `tenant-scoped-models.spec.ts` pins the assumption that every scoped model
 * spells it exactly this way, so a future model declaring
 * `org Tenant @relation(...)` is a failing test rather than a silent bypass.
 */
export const TENANT_RELATION_FIELD = 'tenant';

/**
 * Model name -> the names of its relation fields that point at `Tenant`.
 *
 * Prisma 7's runtime DMMF is trimmed and no longer carries
 * `relationFromFields`, so the relation is identified by its target type
 * instead. Used by the drift test.
 */
export function tenantRelationFieldsFromSchema(): Record<string, string[]> {
  return Object.fromEntries(
    Prisma.dmmf.datamodel.models.map((model) => [
      model.name,
      model.fields
        .filter((field) => field.kind === 'object' && field.type === 'Tenant')
        .map((field) => field.name),
    ]),
  );
}
