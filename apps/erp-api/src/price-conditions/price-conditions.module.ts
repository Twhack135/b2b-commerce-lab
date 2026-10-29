import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PriceConditionsController } from './price-conditions.controller';
import { PriceConditionsService } from './price-conditions.service';

@Module({
  imports: [PrismaModule],
  controllers: [PriceConditionsController],
  providers: [PriceConditionsService],
})
export class PriceConditionsModule {}
