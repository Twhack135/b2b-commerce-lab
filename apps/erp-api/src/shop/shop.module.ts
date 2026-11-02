import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopHealthController } from './shop-health.controller';
import { ShopServiceGuard } from './shop-service.guard';

/**
 * The customer-facing API /shop/v1 (docs/adr/0001, 0005): its own
 * controllers and contracts, called only by the shop BFF. It never exposes
 * the admin controllers. Sprint 11: technical health only.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ShopHealthController],
  // Global: protects every route under /shop, also future ones
  providers: [{ provide: APP_GUARD, useClass: ShopServiceGuard }],
})
export class ShopModule {}
