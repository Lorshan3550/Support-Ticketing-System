import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminsRepository } from '../admins/admins.repository';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantsRepository } from '../tenancy/tenants.repository';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.types';
import { UsersRepository } from '../users/users.repository';
import type { LoginDto } from './dto/login.dto';
import type { RefreshTokenDto } from './dto/refresh-token.dto';
import { PasswordService } from './password.service';
import { TokenService, type AuthTokens } from './token.service';

/**
 * Login and refresh for both principal types.
 *
 * The interesting part is how tenant scope is established *before* the
 * principal is known. A login request names its tenant by subdomain; we
 * resolve that to a tenant id, then run the credential lookup inside
 * `runInTenant(...)`. That means even the unauthenticated login path queries
 * through the tenant-scoped client — there is no "look up a user across all
 * tenants" code path anywhere in the system for an attacker to find.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenants: TenantsRepository,
    private readonly users: UsersRepository,
    private readonly admins: AdminsRepository,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
  ) {}

  async loginUser(dto: LoginDto): Promise<AuthTokens> {
    const tenantId = await this.resolveTenantId(dto.subdomain);

    const principal = await this.tenantContext.runInTenant(
      tenantId,
      async (): Promise<AuthenticatedPrincipal> => {
        const user = await this.users.findByEmailWithSecret(dto.email);
        if (!user || !user.isActive) {
          await this.passwords.verifyAgainstDummy(dto.password);
          throw invalidCredentials();
        }
        if (!(await this.passwords.verify(dto.password, user.passwordHash))) {
          throw invalidCredentials();
        }
        await this.users.touchLastLogin(user.id);
        return {
          principalType: 'user',
          principalId: user.id,
          tenantId,
          email: user.email,
          role: user.role,
        };
      },
    );

    return this.tokens.issueTokens(principal);
  }

  async loginAdmin(dto: LoginDto): Promise<AuthTokens> {
    const tenantId = await this.resolveTenantId(dto.subdomain);

    const principal = await this.tenantContext.runInTenant(
      tenantId,
      async (): Promise<AuthenticatedPrincipal> => {
        const admin = await this.admins.findByEmailWithSecret(dto.email);
        if (!admin || !admin.isActive) {
          await this.passwords.verifyAgainstDummy(dto.password);
          throw invalidCredentials();
        }
        if (!(await this.passwords.verify(dto.password, admin.passwordHash))) {
          throw invalidCredentials();
        }
        await this.admins.touchLastLogin(admin.id);
        return {
          principalType: 'admin',
          principalId: admin.id,
          tenantId,
          email: admin.email,
        };
      },
    );

    return this.tokens.issueTokens(principal);
  }

  /**
   * Exchanges a refresh token for a new pair. The principal is re-read from
   * the database inside its own tenant scope, so a user deactivated since the
   * token was issued cannot refresh their way back in.
   */
  async refreshUser(dto: RefreshTokenDto): Promise<AuthTokens> {
    const payload = this.tokens.verifyRefreshToken(dto.refreshToken, 'user');

    const principal = await this.tenantContext.runInTenant(
      payload.tenantId,
      async (): Promise<AuthenticatedPrincipal> => {
        const user = await this.users.findById(payload.sub);
        if (!user || !user.isActive) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        return {
          principalType: 'user',
          principalId: user.id,
          tenantId: user.tenantId,
          email: user.email,
          role: user.role,
        };
      },
    );

    return this.tokens.issueTokens(principal);
  }

  async refreshAdmin(dto: RefreshTokenDto): Promise<AuthTokens> {
    const payload = this.tokens.verifyRefreshToken(dto.refreshToken, 'admin');

    const principal = await this.tenantContext.runInTenant(
      payload.tenantId,
      async (): Promise<AuthenticatedPrincipal> => {
        const admin = await this.admins.findById(payload.sub);
        if (!admin || !admin.isActive) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        return {
          principalType: 'admin',
          principalId: admin.id,
          tenantId: admin.tenantId,
          email: admin.email,
        };
      },
    );

    return this.tokens.issueTokens(principal);
  }

  /**
   * An unknown or suspended subdomain returns the same 401 as a wrong
   * password. Distinguishing them would let anyone enumerate which tenants
   * exist on the platform.
   */
  private async resolveTenantId(subdomain: string): Promise<string> {
    const tenant = await this.tenants.findLoginableBySubdomain(subdomain);
    if (!tenant) {
      throw invalidCredentials();
    }
    return tenant.id;
  }
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException('Invalid credentials');
}
