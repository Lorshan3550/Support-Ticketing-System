import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Email is unique per tenant (`@@unique([tenantId, email])`), not globally, so
 * a login attempt must name its tenant. The subdomain is the tenant handle
 * users already know from their URL.
 */
export class LoginDto {
  @ApiProperty({
    description: 'Tenant subdomain the principal belongs to.',
    example: 'acme',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  subdomain!: string;

  @ApiProperty({ example: 'agent@acme.test' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
