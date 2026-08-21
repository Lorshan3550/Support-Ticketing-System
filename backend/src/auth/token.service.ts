import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.types';
import type { JwtPayload, TokenType } from './jwt-payload';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

/**
 * Issues and verifies the access/refresh pair.
 *
 * Access and refresh tokens are signed with DIFFERENT secrets and also carry a
 * `tokenType` claim. Either check alone would be enough; both together mean a
 * mistake in one place does not turn a long-lived refresh token into a valid
 * API credential.
 *
 * Refresh tokens are stateless — there is no token table in `schema.prisma`
 * and CLAUDE.md says not to invent one. The trade-off is deliberate and worth
 * naming: logout is client-side only and a leaked refresh token stays valid
 * until it expires. Rotation with server-side revocation needs a new model,
 * which is a separate decision.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  issueTokens(principal: AuthenticatedPrincipal): AuthTokens {
    const accessTtl = this.accessTtl();
    return {
      accessToken: this.sign(principal, 'access', accessTtl),
      refreshToken: this.sign(principal, 'refresh', this.refreshTtl()),
      tokenType: 'Bearer',
      expiresIn: accessTtl,
    };
  }

  /**
   * Verifies a refresh token and returns its claims. Every failure mode —
   * wrong secret, expired, an access token presented instead, or the wrong
   * principal type for the endpoint — surfaces as the same 401 so the response
   * does not tell an attacker which check failed.
   */
  verifyRefreshToken(
    token: string,
    expectedPrincipalType: JwtPayload['principalType'],
  ): JwtPayload {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (
      payload.tokenType !== 'refresh' ||
      payload.principalType !== expectedPrincipalType
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return payload;
  }

  private sign(
    principal: AuthenticatedPrincipal,
    tokenType: TokenType,
    expiresIn: string,
  ): string {
    const payload: JwtPayload = {
      sub: principal.principalId,
      tenantId: principal.tenantId,
      principalType: principal.principalType,
      email: principal.email,
      tokenType,
    };
    // The role is advisory only — guards re-read it from the database on every
    // request, so a role change takes effect immediately instead of waiting
    // for the access token to expire.
    if (tokenType === 'access' && principal.role) {
      payload.role = principal.role;
    }
    return this.jwtService.sign(payload, {
      secret:
        tokenType === 'access' ? this.accessSecret() : this.refreshSecret(),
      // TTLs come from env as plain strings; `ms` types them as a
      // template-literal union that config values cannot satisfy statically.
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
  }

  private accessSecret(): string {
    return this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private refreshSecret(): string {
    return this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private accessTtl(): string {
    return this.configService.get<string>('JWT_ACCESS_TTL') ?? '15m';
  }

  private refreshTtl(): string {
    return this.configService.get<string>('JWT_REFRESH_TTL') ?? '7d';
  }
}
