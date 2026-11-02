import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopAccountController } from './account/shop-account.controller';
import { ShopAuthModule } from './auth/shop-auth.module';
import { ShopHealthController } from './shop-health.controller';
import { ShopServiceGuard } from './shop-service.guard';
import { ShopUsersModule } from './users/shop-users.module';

/**
 * The customer-facing API /shop/v1 (docs/adr/0001, 0005): its own
 * controllers and contracts, called only by the shop BFF. It never exposes
 * the admin controllers. Sprint 11: technical health only; Sprint 12A adds
 * the internal shop user services (no endpoints), Sprint 12B the sign-in
 * under /shop/v1/auth, Sprint 12C the account context /shop/v1/account
 * with the server-checked unit selection.
 */
@Module({
  imports: [PrismaModule, ShopUsersModule, ShopAuthModule],
  controllers: [ShopHealthController, ShopAccountController],
  // Global: protects every route under /shop, also future ones
  providers: [{ provide: APP_GUARD, useClass: ShopServiceGuard }],
})
export class ShopModule {}
