import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UserRole } from '@prisma/client';
import { AdminGuard } from '../guards/admin.guard';
import { RolesGuard } from '../guards/roles.guard';
import { UserJwtAuthGuard } from '../guards/user-jwt-auth.guard';
import { Roles } from './roles.decorator';

/**
 * Protects a route for `User` principals, optionally narrowed to specific
 * roles.
 *
 * This exists so the guards cannot be applied wrongly. Authenticating and
 * authorising are two guards that must run in a specific order —
 * `UserJwtAuthGuard` populates `request.user`, then `RolesGuard` reads it —
 * and applying `RolesGuard` on its own would look protective while doing
 * almost nothing. Bundling them means there is no order to get wrong and no
 * half of the pair to forget.
 *
 * It also carries the Swagger annotations CLAUDE.md requires on every guarded
 * route, so they cannot drift out of sync with the guards actually applied.
 *
 *   @Auth()                          // any authenticated User
 *   @Auth(UserRole.agent)            // agents only
 *   @Auth(UserRole.owner, UserRole.agent)
 *
 * With no roles passed, no `@Roles()` metadata is set at all — so a
 * class-level `@Roles(...)` on the controller still applies. Widening a
 * restricted controller for one route is therefore explicit: pass the wider
 * list rather than relying on an empty `@Auth()` to open it up.
 */
export function Auth(...roles: UserRole[]) {
  const decorators = [
    UseGuards(UserJwtAuthGuard, RolesGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({
      description: 'Missing, expired, or non-User access token.',
    }),
  ];

  if (roles.length > 0) {
    decorators.push(
      Roles(...roles),
      ApiForbiddenResponse({
        description: `Authenticated, but the User role is not one of: ${roles.join(', ')}.`,
      }),
    );
  }

  return applyDecorators(...decorators);
}

/**
 * Protects a route for `Admin` principals.
 *
 * Deliberately a separate decorator with a separate guard rather than a role
 * on `@Auth()` — `Admin` is its own table and its own principal type, not a
 * `User.role` value. There is no role list because admins have no roles; the
 * `principalType` claim is the whole check.
 */
export function AdminOnly() {
  return applyDecorators(
    UseGuards(AdminGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({
      description: 'Missing, expired, or non-Admin access token.',
    }),
  );
}
