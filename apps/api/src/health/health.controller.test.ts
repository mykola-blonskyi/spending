import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { parseConfig } from '../common/config';

describe('GET /api/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseConfig({ NODE_ENV: 'test' }))],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('reports liveness', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('renders unknown routes with a stable error code', async () => {
    const response = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
  });
});
