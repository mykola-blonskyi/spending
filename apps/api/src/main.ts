import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { parseConfig } from './common/config';

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const app = await createApp(config);
  app.useLogger(new ConsoleLogger({ json: config.env === 'production' }));
  await app.listen(config.port, '0.0.0.0');
}

void main();
