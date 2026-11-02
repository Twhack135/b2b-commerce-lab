import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loopbackHost } from './common/network-binding';
import {
  configuredKeyDigest,
  SHOP_SERVICE_KEY_ENV,
} from './shop/shop-service-key';

async function bootstrap() {
  // Local only: the admin endpoints have no authentication (yet), so any
  // other interface is refused before anything starts (docs/adr/0006)
  const host = loopbackHost(process.env.HOST);
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  if (!configuredKeyDigest(process.env)) {
    new Logger('ShopModule').warn(
      `${SHOP_SERVICE_KEY_ENV} is missing or shorter than 32 characters: /shop/v1 answers 503.`,
    );
  }
  await app.listen(process.env.PORT ?? 3000, host);
}
void bootstrap();
