import { Module } from '@nestjs/common';
import { Clock } from '../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopAuthModule } from '../shop/auth/shop-auth.module';
import { ShopUsersModule } from '../shop/users/shop-users.module';
import { ShopUsersAdminController } from './shop-users-admin.controller';
import { ShopUsersAdminService } from './shop-users-admin.service';

/**
 * Local shop user administration (Sprint 12C): admin API /shop-users for
 * the Backoffice, built on the shop user and sign-in services. Not part of
 * the customer-facing /shop/v1 API.
 */
@Module({
  imports: [PrismaModule, ShopUsersModule, ShopAuthModule],
  controllers: [ShopUsersAdminController],
  providers: [ShopUsersAdminService, Clock],
})
export class ShopUsersAdminModule {}
