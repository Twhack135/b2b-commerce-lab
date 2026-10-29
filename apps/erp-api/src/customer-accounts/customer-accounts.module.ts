import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerAccountsController } from './customer-accounts.controller';
import { CustomerAccountsService } from './customer-accounts.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerAccountsController],
  providers: [CustomerAccountsService],
})
export class CustomerAccountsModule {}
