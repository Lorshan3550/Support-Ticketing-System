import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../../tenancy/tenant-context.types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Authorises `User` principals against `@Roles(...)`. Centralising this is the
 * point — CLAUDE.md forbids scattered `if (user.role === ...)` checks inside
 * services.
 *
 * This guard authorises; it does not authenticate. It expects
 * `UserJwtAuthGuard` to have run first and populated `request.user`. Applying
 * it alone would be a mistake, which is why `@Auth(...)` exists — it always
 * pairs the two in the right order, and is the only way this guard should be
 * reached in practice. The principal check below still fails closed if someone
 * bypasses that.
 *
 * The 401/403 split is deliberate:
 *   - no principal at all -> 401, the caller is not authenticated
 *   - authenticated but the wrong role -> 403
 *
 * 403 here does NOT conflict with CLAUDE.md's "404, not 403" rule. That rule
 * is about never leaking whether a *tenant-scoped resource* exists. A role
 * failure on a route the caller can legitimately see is an ordinary
 * authorization denial, and saying so is the honest answer.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.user as AuthenticatedPrincipal | undefined;

    // Checked BEFORE the metadata lookup on purpose. A route with no
    // `@Roles()` is open to any authenticated User — not to anonymous
    // callers.
    if (!principal) {
      throw new UnauthorizedException();
    }

    // `Admin` is a separate principal, not a super-role. It must never
    // satisfy a `User` role requirement: admins sit outside the
    // ticket-handling flow entirely and are gated by `AdminGuard`.
    if (principal.principalType !== 'user' || !principal.role) {
      throw new ForbiddenException('Insufficient role');
    }

    // Handler-level `@Roles()` deliberately OVERRIDES class-level rather than
    // merging with it. That is what makes `@Roles()` usable on a controller as
    // a default that individual routes can narrow or widen.
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    if (!required.includes(principal.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
