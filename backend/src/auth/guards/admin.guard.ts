import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid `Admin` access token. Deliberately a different guard from
 * `UserJwtAuthGuard` rather than a role check — `Admin` is a separate table
 * and a separate principal, not a `User.role` value.
 */
@Injectable()
export class AdminGuard extends AuthGuard('admin-jwt') {}
