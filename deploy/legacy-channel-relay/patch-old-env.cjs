'use strict';
// One runtime overlay; never restarts anything and never prints the original environment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const overlay = require('./runtime.env.patch.json');

function patchEnvironment(text, values = overlay) {
  const pending = new Map(Object.entries(values)),
    seen = new Set();
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
      if (!match || !pending.has(match[1])) return line;
      const key = match[1];
      if (seen.has(key)) throw new Error('RELAY_ENV_DUPLICATE_ASSIGNMENT');
      seen.add(key);
      return `${key}=${pending.get(key)}`;
    });
  for (const [key, value] of pending) if (!seen.has(key)) lines.push(`${key}=${value}`);
  return lines.join('\n').replace(/\n+$/, '\n');
}

function main(args) {
  const target = path.resolve(args[0] || '/opt/weiban-server/.env');
  const original = fs.readFileSync(target),
    candidate = patchEnvironment(original.toString('utf8'));
  if (args.includes('--apply')) {
    const expected = args[args.indexOf('--expect-sha256') + 1];
    if (!args.includes('--expect-sha256') || expected !== hash(original))
      throw new Error('RELAY_ENV_SOURCE_CHANGED');
    fs.writeFileSync(`${target}.before-legacy-relay-${hash(original).slice(0, 16)}`, original, {
      flag: 'wx',
      mode: 0o600,
    });
    fs.writeFileSync(`${target}.relay-new`, candidate, { flag: 'wx', mode: 0o600 });
    if (hash(fs.readFileSync(target)) !== hash(original))
      throw new Error('RELAY_ENV_SOURCE_CHANGED');
    fs.renameSync(`${target}.relay-new`, target);
  }
  return {
    applied: args.includes('--apply'),
    changedKeys: Object.keys(overlay),
    sourceSha256: hash(original),
    candidateSha256: hash(candidate),
    restartPerformed: false,
  };
}

module.exports = { patchEnvironment, overlay, main };
if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n');
  } catch {
    process.stderr.write('LEGACY_RELAY_ENV_PATCH_FAILED\n');
    process.exitCode = 1;
  }
}
