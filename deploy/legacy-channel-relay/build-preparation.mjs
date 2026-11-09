#!/usr/bin/env node
// Bundle the operator utility and its JS dependencies; Node 24 is the only runtime requirement.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { build } = require('esbuild');
if (!process.argv[2] || !path.isAbsolute(process.argv[2]))
  throw new Error('ABSOLUTE_OUTPUT_REQUIRED');
await build({
  entryPoints: [fileURLToPath(new URL('./prepare-new.mjs', import.meta.url))],
  outfile: process.argv[2],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  nodePaths: [fileURLToPath(new URL('../../apps/server/node_modules', import.meta.url))],
  external: ['pg-native'],
  banner: {
    js: "import { createRequire as __relayCreateRequire } from 'node:module'; const require = __relayCreateRequire(import.meta.url);",
  },
});
process.stdout.write('LEGACY_RELAY_PREPARATION_BUNDLED\n');
