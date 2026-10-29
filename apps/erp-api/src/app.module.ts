import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CustomersModule } from './customers/customers.module';
import { MaterialsModule } from './materials/materials.module';

@Module({
  imports: [MaterialsModule, CustomersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
