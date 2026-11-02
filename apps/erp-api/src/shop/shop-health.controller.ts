import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Technical health of the shop API for the shop BFF: no customer, price or
 * order data, no versions, no database details. Protected by the global
 * ShopServiceGuard like every route under /shop.
 */
@Controller('shop/v1')
export class ShopHealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @Header('Cache-Control', 'no-store')
  async health(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('The shop API is not available.');
    }
    return { status: 'ok' };
  }
}
