import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminsModule } from '../admins/admins.module';
import { UsersModule } from '../users/users.module';
import { AdminAuthController } from './admin-auth.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from './guards/admin.guard';
import { RolesGuard } from './guards/roles.guard';
import { UserJwtAuthGuard } from './guards/user-jwt-auth.guard';
import { PasswordService } from './password.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { UserJwtStrategy } from './strategies/user-jwt.strategy';
import { TokenService } from './token.service';

/**
 * `JwtModule` is registered without a global secret on purpose: access and
 * refresh tokens are signed with different secrets, supplied per call in
 * `TokenService`.
 */
@Module({
  imports: [PassportModule, JwtModule.register({}), UsersModule, AdminsModule],
  controllers: [AuthController, AdminAuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    UserJwtStrategy,
    AdminJwtStrategy,
    RolesGuard,
    UserJwtAuthGuard,
    AdminGuard,
  ],
  // Feature modules (tickets, categories, ...) reach the guards through
  // `@Auth()` / `@AdminOnly()`. Exporting them keeps that an explicit
  // dependency on this module rather than something that happens to work
  // because `Reflector` is globally available.
  exports: [
    PasswordService,
    TokenService,
    RolesGuard,
    UserJwtAuthGuard,
    AdminGuard,
  ],
})
export class AuthModule {}
