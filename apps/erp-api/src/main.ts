import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // keep only properties defined in the DTO
      forbidNonWhitelisted: true, // reject requests with unknown properties
      transform: true, // turn the JSON body into a DTO instance
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
