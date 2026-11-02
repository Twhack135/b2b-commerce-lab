import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopUsersService } from './shop-users.service';

/**
 * Shop users and their unit authorizations (Sprint 12A). Internal only:
 * no controllers. Login, sessions and administration endpoints follow in
 * later sprints and will use ShopUsersService.
 */
@Module({
  imports: [PrismaModule],
  providers: [ShopUsersService],
  exports: [ShopUsersService],
})
export class ShopUsersModule {}
