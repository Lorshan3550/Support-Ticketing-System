import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class AuthTokensResponse {
  @ApiProperty({ description: 'Short-lived bearer token for API calls.' })
  accessToken!: string;

  @ApiProperty({ description: 'Long-lived token accepted only by /refresh.' })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Access token lifetime.', example: '15m' })
  expiresIn!: string;
}

export class UserProfileResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ example: 'user' })
  principalType!: 'user';
}

export class AdminProfileResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ example: 'admin' })
  principalType!: 'admin';
}
