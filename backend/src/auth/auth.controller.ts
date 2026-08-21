import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.types';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import { Auth } from './decorators/auth.decorator';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import {
  AuthTokensResponse,
  UserProfileResponse,
} from './dto/auth-tokens.response';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * Login for `User` principals (owner / agent / customer). Admins have their
 * own endpoints under `/admin/auth` — see `AdminAuthController`.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly users: UsersRepository,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in as a User (owner, agent or customer)',
    description:
      'Email is unique per tenant, so the tenant subdomain is required. ' +
      'An unknown subdomain, an unknown email, a deactivated account and a ' +
      'wrong password all return the same 401 — distinguishing them would ' +
      'let a caller enumerate tenants and accounts.',
  })
  @ApiResponse({ status: 200, type: AuthTokensResponse })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Body() dto: LoginDto): Promise<AuthTokensResponse> {
    return this.authService.loginUser(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a User refresh token for a new token pair',
    description:
      'Refresh tokens are signed with a separate secret and carry a ' +
      "`tokenType: 'refresh'` claim, so an access token cannot be used here " +
      'and a refresh token cannot be used as a bearer credential. An admin ' +
      'refresh token is rejected.',
  })
  @ApiResponse({ status: 200, type: AuthTokensResponse })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token.',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensResponse> {
    return this.authService.refreshUser(dto);
  }

  @Get('me')
  @Auth()
  @ApiOperation({
    summary: 'Current User principal',
    description:
      'Reads the principal resolved by the JWT guard. The underlying lookup ' +
      'runs through the tenant-scoped Prisma client, so a token minted for ' +
      "another tenant's user cannot resolve here.",
  })
  @ApiResponse({ status: 200, type: UserProfileResponse })
  async me(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<UserProfileResponse> {
    const user = await this.users.findById(principal.principalId);
    return {
      id: principal.principalId,
      tenantId: principal.tenantId,
      email: principal.email,
      fullName: user?.fullName ?? '',
      role: principal.role!,
      principalType: 'user',
    };
  }
}
