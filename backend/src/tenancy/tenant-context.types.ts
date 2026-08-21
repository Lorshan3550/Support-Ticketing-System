import { UserRole } from '@prisma/client';

/**
 * The two principal types in this system. `User` and `Admin` are separate
 * tables with separate login endpoints — this claim is what keeps them apart
 * at the guard level. See CLAUDE.md § Roles & permissions.
 */
export type PrincipalType = 'user' | 'admin';

/** Who is making the request, once authentication has succeeded. */
export interface AuthenticatedPrincipal {
  principalType: PrincipalType;
  principalId: string;
  tenantId: string;
  email: string;
  /** Present for `user` principals only. Admins have no `UserRole`. */
  role?: UserRole;
}

/**
 * The per-request store held in AsyncLocalStorage.
 *
 * `tenantId` and `principal` are deliberately separate. Tenant scope is
 * established before we know who the principal is — the login flow resolves a
 * tenant from the subdomain and then looks up credentials *inside* that scope,
 * so even the unauthenticated login path queries through the scoped client.
 *
 * The object is mutable on purpose: the middleware opens an empty store at the
 * edge of the request, and the JWT strategy fills it in once the token has
 * been verified. Because every consumer reads the same object reference from
 * the same async context, that mutation is visible everywhere downstream.
 */
export interface TenantContextStore {
  tenantId?: string;
  principal?: AuthenticatedPrincipal;
}
