import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid `User` access token. Rejects admin tokens, because the
 * `user-jwt` strategy checks the `principalType` claim.
 */
@Injectable()
export class UserJwtAuthGuard extends AuthGuard('user-jwt') {}
