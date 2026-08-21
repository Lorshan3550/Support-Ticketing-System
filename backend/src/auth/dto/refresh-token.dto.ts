import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token issued by the matching login endpoint.',
  })
  @IsJWT()
  refreshToken!: string;
}
