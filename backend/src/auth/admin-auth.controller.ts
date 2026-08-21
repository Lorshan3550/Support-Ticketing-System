import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminsRepository } from '../admins/admins.repository';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.types';
import { AuthService } from './auth.service';
import { AdminOnly } from './decorators/auth.decorator';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import {
  AdminProfileResponse,
  AuthTokensResponse,
} from './dto/auth-tokens.response';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * Login for `Admin` principals — a separate table from `User`, with its own
 * endpoints, its own JWT `principalType` claim, and its own guard. Admins
 * manage tenant settings, users and categories; they are not wired into the
 * ticket-handling flow.
 */
@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly admins: AdminsRepository,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in as an Admin',
    description:
      'Separate from `POST /auth/login`: an Admin cannot log in there and a ' +
      'User cannot log in here, because the two live in different tables and ' +
      'the issued tokens carry different `principalType` claims.',
  })
  @ApiResponse({ status: 200, type: AuthTokensResponse })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Body() dto: LoginDto): Promise<AuthTokensResponse> {
    return this.authService.loginAdmin(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange an Admin refresh token for a new token pair',
  })
  @ApiResponse({ status: 200, type: AuthTokensResponse })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token.',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensResponse> {
    return this.authService.refreshAdmin(dto);
  }

  @Get('me')
  @AdminOnly()
  @ApiOperation({
    summary: 'Current Admin principal',
    description:
      'Guarded by `AdminGuard`, which uses the `admin-jwt` strategy. A valid ' +
      'User access token is rejected with 401 here.',
  })
  @ApiResponse({ status: 200, type: AdminProfileResponse })
  async me(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<AdminProfileResponse> {
    const admin = await this.admins.findById(principal.principalId);
    return {
      id: principal.principalId,
      tenantId: principal.tenantId,
      email: principal.email,
      fullName: admin?.fullName ?? '',
      principalType: 'admin',
    };
  }
}
