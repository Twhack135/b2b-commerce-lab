import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopUsersService } from './shop-users.service';

/**
 * Shop users and their unit authorizations (Sprint 12A). No controllers of
 * its own: the sign-in and account context (/shop/v1) and the local
 * administration (/shop-users, Sprint 12C) use ShopUsersService.
 */
@Module({
  imports: [PrismaModule],
  providers: [ShopUsersService],
  exports: [ShopUsersService],
})
export class ShopUsersModule {}
