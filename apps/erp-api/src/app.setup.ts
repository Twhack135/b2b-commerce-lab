import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Global app configuration, shared by main.ts and the integration tests,
 * so tests run against exactly the same validation behaviour.
 */
export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // keep only properties defined in the DTO
      forbidNonWhitelisted: true, // reject requests with unknown properties
      transform: true, // turn the JSON body into a DTO instance
    }),
  );
}
