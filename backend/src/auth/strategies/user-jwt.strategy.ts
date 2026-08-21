import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import type { AuthenticatedPrincipal } from '../../tenancy/tenant-context.types';
import { UsersRepository } from '../../users/users.repository';
import type { JwtPayload } from '../jwt-payload';

/**
 * Authenticates `User` principals. Registered under its own strategy name so
 * the `principalType` split is enforced by which guard a route wears, not by
 * an `if` inside a service.
 */
@Injectable()
export class UserJwtStrategy extends PassportStrategy(Strategy, 'user-jwt') {
  constructor(
    configService: ConfigService,
    private readonly tenantContext: TenantContextService,
    private readonly users: UsersRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    if (payload.tokenType !== 'access' || payload.principalType !== 'user') {
      throw new UnauthorizedException();
    }

    // Establish tenant scope first: the lookup below runs through the scoped
    // client, so a token whose `sub` belongs to another tenant resolves to
    // null and fails here rather than reaching a handler.
    this.tenantContext.setTenantId(payload.tenantId);

    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    // The role comes from the database, not from the token, so a demotion
    // takes effect on the next request instead of when the token expires.
    const principal: AuthenticatedPrincipal = {
      principalType: 'user',
      principalId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };
    this.tenantContext.setPrincipal(principal);
    return principal;
  }
}
