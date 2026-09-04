import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { AppModule } from './app.module.js';
import { port, backendKind } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableCors({ origin: true, methods: ['GET', 'POST'] });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );

  // Serve the operator/collector/consumer/regulator dashboards from the gateway
  // itself, so the whole product is one URL — same-origin API, no CORS, no mock.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = path.join(here, '..', 'web');
  app.useStaticAssets(webDir, { index: ['index.html'] });

  const p = port();
  await app.listen(p);
  new Logger('Gateway').log(
    `AyurTrace live on http://localhost:${p}  (backend=${backendKind()})`,
  );
}

void bootstrap();
