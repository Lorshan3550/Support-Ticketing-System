import { Module } from '@nestjs/common';
import { AdminsRepository } from './admins.repository';

@Module({
  providers: [AdminsRepository],
  exports: [AdminsRepository],
})
export class AdminsModule {}
