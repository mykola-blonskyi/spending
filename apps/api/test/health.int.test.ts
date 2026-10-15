import { gzipSync } from 'node:zlib';
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
    expect(await response.json()).toEqual({ status: 'ok', version: 'unknown' });
  });

  it('reports readiness from the database', async () => {
    const response = await fetch(`${t.baseUrl}/api/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', version: 'unknown' });
  });

  it('renders unknown routes with a stable error code', async () => {
    const response = await fetch(`${t.baseUrl}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
  });

  it('rejects a body that inflates past the limit as too large', async () => {
    const response = await fetch(`${t.baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: gzipSync(JSON.stringify({ pad: 'x'.repeat(4 * 1024 * 1024) })),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('rejects an unsupported body encoding as a client error', async () => {
    const response = await fetch(`${t.baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'compress' },
      body: '{}',
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED' },
    });
  });
});
