// Unit tests for the pure modules (src/core, src/model): bundled with esbuild, run with node:test.
// They need no Blockbench; the Blockbench side is covered by the live checks in BlockBenchMCP
// (scripts/verify-blocksmooth.mjs there).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, '.test-build');
fs.rmSync(out, { recursive: true, force: true });

const entries = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.ts'));
await esbuild.build({
  entryPoints: entries.map((f) => path.join(root, 'test', f)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

const files = fs.readdirSync(out).filter((f) => f.endsWith('.mjs')).map((f) => path.join(out, f));
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
