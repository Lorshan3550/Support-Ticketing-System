import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AdminsRepository } from '../../admins/admins.repository';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import type { AuthenticatedPrincipal } from '../../tenancy/tenant-context.types';
import type { JwtPayload } from '../jwt-payload';

/**
 * Authenticates `Admin` principals — a separate table, separate login
 * endpoint, and a separate strategy from `User`. An admin token presented to a
 * user-guarded route fails at the guard, and vice versa, because the two
 * strategies reject each other's `principalType`.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    configService: ConfigService,
    private readonly tenantContext: TenantContextService,
    private readonly admins: AdminsRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    if (payload.tokenType !== 'access' || payload.principalType !== 'admin') {
      throw new UnauthorizedException();
    }

    this.tenantContext.setTenantId(payload.tenantId);

    const admin = await this.admins.findById(payload.sub);
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException();
    }

    const principal: AuthenticatedPrincipal = {
      principalType: 'admin',
      principalId: admin.id,
      tenantId: admin.tenantId,
      email: admin.email,
    };
    this.tenantContext.setPrincipal(principal);
    return principal;
  }
}
