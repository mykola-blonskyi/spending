import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import type { AppConfig } from './common/config';
import { httpMiddleware } from './common/http.middleware';

export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: config.env === 'test' ? false : undefined,
    bufferLogs: true,
  });
  configureApp(app);
  return app;
}

function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // One hop: the web container's nginx, which sends a single X-Forwarded-For (docs/operations.md).
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '3mb' });
  app.use('/api', httpMiddleware);
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setOpenAPIVersion('3.1.0')
      .setTitle('Spending API')
      .setVersion('1')
      .build(),
  );
  return cleanupOpenApiDoc(doc, { version: '3.1' });
}
