import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Global app configuration, shared by main.ts and the integration tests,
 * so tests run against exactly the same validation behaviour.
 */
export function configureApp(app: INestApplication) {
  // No framework fingerprint; JSON is never interpreted as another type
  const server = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
  };
  server.disable?.('x-powered-by');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // keep only properties defined in the DTO
      forbidNonWhitelisted: true, // reject requests with unknown properties
      transform: true, // turn the JSON body into a DTO instance
    }),
  );
}
