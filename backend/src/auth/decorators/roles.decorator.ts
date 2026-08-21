import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to specific `User` roles. Read by `RolesGuard`.
 * Roles live on `User` only — `Admin` is a separate principal and is gated by
 * `AdminGuard`, not by this decorator.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
