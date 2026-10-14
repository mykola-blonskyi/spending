import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './harness';

describe('API process', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(() => t.app.close());

  it('serves liveness without leaking the framework', async () => {
    const response = await fetch(`${t.baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness from the database', async () => {
    const response = await fetch(`${t.baseUrl}/api/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('renders unknown routes with a stable error code', async () => {
    const response = await fetch(`${t.baseUrl}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
  });
});
