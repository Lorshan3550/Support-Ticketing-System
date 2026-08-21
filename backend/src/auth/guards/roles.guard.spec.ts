import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthenticatedPrincipal } from '../../tenancy/tenant-context.types';
import { RolesGuard } from './roles.guard';

/**
 * `RolesGuard` has no routes wearing it yet — ticket endpoints come later —
 * so these tests are what stops it from rotting into untested scaffolding.
 */
describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  const contextFor = (
    principal: AuthenticatedPrincipal | undefined,
    required: UserRole[] | undefined,
  ): ExecutionContext => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  };

  const userPrincipal = (role: UserRole): AuthenticatedPrincipal => ({
    principalType: 'user',
    principalId: 'user-1',
    tenantId: 'tenant-a',
    email: 'u@example.test',
    role,
  });

  const adminPrincipal: AuthenticatedPrincipal = {
    principalType: 'admin',
    principalId: 'admin-1',
    tenantId: 'tenant-a',
    email: 'a@example.test',
  };

  afterEach(() => jest.restoreAllMocks());

  it('allows any authenticated User when no @Roles() is set', () => {
    expect(
      guard.canActivate(
        contextFor(userPrincipal(UserRole.customer), undefined),
      ),
    ).toBe(true);
  });

  it('allows a User whose role is listed', () => {
    expect(
      guard.canActivate(
        contextFor(userPrincipal(UserRole.agent), [
          UserRole.agent,
          UserRole.owner,
        ]),
      ),
    ).toBe(true);
  });

  it('rejects a User whose role is not listed', () => {
    expect(() =>
      guard.canActivate(
        contextFor(userPrincipal(UserRole.customer), [UserRole.agent]),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects an Admin principal even on a role-guarded route', () => {
    // Admin is a separate principal, not a super-role. It must never satisfy
    // a `User` role requirement — admins are outside the ticket-handling flow.
    expect(() =>
      guard.canActivate(contextFor(adminPrincipal, [UserRole.owner])),
    ).toThrow(ForbiddenException);
  });

  it('rejects an Admin principal on a route with no @Roles() either', () => {
    expect(() =>
      guard.canActivate(contextFor(adminPrincipal, undefined)),
    ).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request with 401, not 403', () => {
    // Not authenticated is a different answer from authenticated-but-not-
    // allowed, and the status code should say which.
    expect(() =>
      guard.canActivate(contextFor(undefined, [UserRole.agent])),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an unauthenticated request even when no @Roles() is set', () => {
    // The footgun this closes: `@UseGuards(RolesGuard)` without the
    // authentication guard used to leave such a route wide open.
    expect(() => guard.canActivate(contextFor(undefined, undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
