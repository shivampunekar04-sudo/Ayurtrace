/**
 * Minimal .env loader (no dependency; Node 18 has no built-in --env-file).
 * Imported FIRST in main.ts so credentials are in process.env before any module
 * that reads them (IpfsService, config/env) is constructed. Existing env vars win,
 * so a real environment always overrides the file. Secrets live in .env, which is
 * gitignored — never commit real tokens.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

function parseAndApply(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return; // no .env here — fine
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

// Load .env from the current working directory and from the gateway package root.
parseAndApply(path.resolve(process.cwd(), '.env'));
parseAndApply(path.resolve(process.cwd(), 'apps/gateway/.env'));
