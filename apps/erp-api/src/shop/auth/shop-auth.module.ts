import { Module } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopUsersModule } from '../users/shop-users.module';
import { ShopAuthController } from './shop-auth.controller';
import { ShopAuthService } from './shop-auth.service';
import { ShopSessionGuard } from './shop-session.guard';

/**
 * Sign-in of shop users (Sprint 12B): activation, login, session, logout
 * under /shop/v1/auth, and the session guard for customer routes.
 */
@Module({
  imports: [PrismaModule, ShopUsersModule],
  controllers: [ShopAuthController],
  providers: [ShopAuthService, ShopSessionGuard, Clock],
  exports: [ShopAuthService, ShopSessionGuard],
})
export class ShopAuthModule {}
