// Build the Blockbench plugin.
//   node scripts/build.mjs             dist/blocksmooth.js (the file name is the plugin id)
//   node scripts/build.mjs --release   also copies LICENSE into dist/ to ship with it
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = process.argv.includes('--release');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  define: { __BLOCKSMOOTH_VERSION__: JSON.stringify(pkg.version) },
  // The logo is embedded as a data URL: Blockbench shows it in the plugin list
  // without a separate icon file next to the plugin.
  loader: { '.svg': 'dataurl' },
  banner: {
    js: [
      `/*! BlockSmooth ${pkg.version} — Blockbench plugin`,
      ' * Copyright (C) 2026 Renas Demirbas',
      ` * SPDX-License-Identifier: ${pkg.license}`,
      ' * Source and license: https://github.com/RenasDemirbas/BlockSmooth',
      ' */',
    ].join('\n'),
  },
  outfile: path.join(dist, 'blocksmooth.js'),
  logLevel: 'info',
});

if (release) {
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
  console.log('LICENSE copied to dist/');
}
