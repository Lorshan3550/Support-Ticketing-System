import { Injectable } from '@nestjs/common';
import {
  InjectScopedPrisma,
  type ScopedPrismaClient,
} from '../tenancy/scoped-prisma';

/**
 * `Admin` is a separate principal table from `User` — not a `User.role` value.
 * It is tenant-scoped like everything else, so the same scoped client applies:
 * an admin can only ever be found within their own tenant.
 */
@Injectable()
export class AdminsRepository {
  constructor(
    @InjectScopedPrisma() private readonly prisma: ScopedPrismaClient,
  ) {}

  async findByEmailWithSecret(email: string) {
    return this.prisma.admin.findFirst({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        passwordHash: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.admin.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.prisma.admin.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}
