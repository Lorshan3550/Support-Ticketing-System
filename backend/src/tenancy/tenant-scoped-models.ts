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
