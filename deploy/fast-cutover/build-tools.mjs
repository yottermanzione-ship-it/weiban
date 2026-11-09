/** Builds code only. No source user data, credentials, servers, or database access. */
import { build } from '../../apps/server/node_modules/esbuild/lib/main.js';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = process.argv[2];
if (!out) throw new Error('OUTPUT_DIRECTORY_REQUIRED');
mkdirSync(resolve(out), { recursive: true });
for (const name of [
  'fast-cutover-export',
  'fast-cutover-media-source',
  'fast-cutover-runner',
  'fast-cutover-transport',
  'fast-cutover-finalize',
  'restore-designated-annual-balance-20261109',
  'fast-cutover-public-policy',
]) {
  await build({
    entryPoints: [resolve(root, 'scripts/ops', name + '.mjs')],
    outfile: resolve(out, name + '.mjs'),
    bundle: true,
    write: true,
    platform: 'node',
    format: 'esm',
    target:
      name === 'fast-cutover-export' || name === 'fast-cutover-media-source' ? 'node18' : 'node24',
    logLevel: 'silent',
    tsconfig: resolve(root, 'apps/server/tsconfig.json'),
    plugins: [
      {
        name: 'runtime-packages',
        setup(b) {
          b.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith('@weiban/') || /^[A-Za-z]:[\\/]/.test(args.path)
              ? undefined
              : { path: args.path, external: true },
          );
        },
      },
    ],
  });
  process.stdout.write(JSON.stringify({ built: name, privateData: false }) + '\n');
}
