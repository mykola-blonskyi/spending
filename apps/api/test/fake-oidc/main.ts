import { parseArgs } from 'node:util';
import { type FakeUser, startFakeOidc } from './server';

/**
 * Runs the fake provider for local development and E2E:
 *   tsx test/fake-oidc/main.ts --port 4400
 * Environment: FAKE_OIDC_CLIENT_ID, FAKE_OIDC_CLIENT_SECRET, FAKE_OIDC_APP_ORIGIN and
 * FAKE_OIDC_USERS (JSON array of { sub, email, name?, picture?, locale?, theme? }).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '4400' } } });
  const appOrigin = process.env.FAKE_OIDC_APP_ORIGIN ?? 'http://localhost:5173';
  const users = JSON.parse(
    process.env.FAKE_OIDC_USERS ??
      '[{"sub":"e2e-owner","email":"owner@example.test","name":"Owner"},{"sub":"e2e-member","email":"member@example.test","name":"Member"}]',
  ) as FakeUser[];
  const provider = await startFakeOidc({
    port: Number(values.port),
    users,
    clients: [
      {
        clientId: process.env.FAKE_OIDC_CLIENT_ID ?? 'spending-dev',
        clientSecret: process.env.FAKE_OIDC_CLIENT_SECRET ?? 'spending-dev-secret',
        redirectUris: [`${appOrigin}/api/v1/auth/callback`],
        postLogoutRedirectUris: [`${appOrigin}/signin`],
      },
    ],
  });
  process.stdout.write(`Fake OIDC provider listening at ${provider.issuer}\n`);
  const stop = () => void provider.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main();
