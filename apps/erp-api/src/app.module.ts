import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MaterialsModule } from './materials/materials.module';

@Module({
  imports: [MaterialsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
