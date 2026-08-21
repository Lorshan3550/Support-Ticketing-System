import { Injectable } from '@nestjs/common';
import {
  InjectScopedPrisma,
  type ScopedPrismaClient,
} from '../tenancy/scoped-prisma';

/**
 * All queries here go through the tenant-scoped client, so `tenantId` is
 * injected by the Prisma extension from the request's AsyncLocalStorage
 * context. No method on this class takes a `tenantId` argument — manual
 * threading is what CLAUDE.md forbids, and it is how isolation bugs creep in.
 */
@Injectable()
export class UsersRepository {
  constructor(
    @InjectScopedPrisma() private readonly prisma: ScopedPrismaClient,
  ) {}

  /** Credential lookup. Returns the password hash — callers must not leak it. */
  async findByEmailWithSecret(email: string) {
    return this.prisma.user.findFirst({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });
  }

  /**
   * Loads the principal behind an access token. A token whose `sub` belongs to
   * another tenant simply resolves to `null` here — the extension filters it
   * out — so a forged or replayed cross-tenant token fails authentication
   * rather than reaching a handler.
   */
  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}
