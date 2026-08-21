import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

/**
 * A bcrypt hash of a value no one can log in with. Compared against when the
 * looked-up principal does not exist, so a request for an unknown email costs
 * the same wall-clock time as one for a known email. Without this, response
 * timing leaks which accounts exist in a tenant.
 */
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7EmVoHUlyd4Lkzj7uYuSTZaJ/N7dEUq';

@Injectable()
export class PasswordService {
  constructor(private readonly configService: ConfigService) {}

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.rounds());
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  /** Burns comparable time when there is no principal to verify against. */
  async verifyAgainstDummy(plaintext: string): Promise<void> {
    await bcrypt.compare(plaintext, DUMMY_HASH);
  }

  private rounds(): number {
    return Number(this.configService.get<string>('BCRYPT_ROUNDS') ?? 12);
  }
}
