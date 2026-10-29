import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { B2bUnitsModule } from './b2b-units/b2b-units.module';
import { ConditionTypesModule } from './condition-types/condition-types.module';
import { CustomerAccountsModule } from './customer-accounts/customer-accounts.module';
import { CustomersModule } from './customers/customers.module';
import { MaterialsModule } from './materials/materials.module';
import { PriceConditionsModule } from './price-conditions/price-conditions.module';
import { PricingModule } from './pricing/pricing.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';

@Module({
  imports: [
    MaterialsModule,
    CustomersModule,
    CustomerAccountsModule,
    B2bUnitsModule,
    ConditionTypesModule,
    PriceConditionsModule,
    PricingModule,
    SalesOrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
