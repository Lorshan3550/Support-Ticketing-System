import type { UserRole } from '@prisma/client';
import type { PrincipalType } from '../tenancy/tenant-context.types';

export type TokenType = 'access' | 'refresh';

/**
 * Claims carried by both principal types.
 *
 * `principalType` is the claim that keeps `User` and `Admin` apart. It is
 * checked at the guard/strategy level, never with ad-hoc `if` statements in a
 * service. `tokenType` plus separate signing secrets means a refresh token can
 * never be replayed as an access token, and vice versa.
 */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  principalType: PrincipalType;
  tokenType: TokenType;
  email: string;
  /** Present on `user` access tokens only; admins have no `UserRole`. */
  role?: UserRole;
}
