import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./build-cache.sh', import.meta.url));
const source = resolve(dirname(script), '../..');
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'weiban-build-cache-test-'));
  assert.ok(root.startsWith(join(tmpdir(), 'weiban-build-cache-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const cache = join(root, 'cache');
  const dockerRoot = join(root, 'docker');
  for (const dir of [bin, cache, dockerRoot]) mkdirSync(dir);
  const config = join(root, 'cache.env');
  const log = join(root, 'calls');
  writeFileSync(log, '');
  writeFileSync(
    config,
    [
      'BUILDER=weiban-release',
      'CACHE_PATH=' + cache,
      'MAX_BYTES=4294967296',
      'LEGACY_MAX_BYTES=1073741824',
      'RESERVED_BYTES=536870912',
      'MIN_FREE_BYTES=12884901888',
      '',
    ].join('\n'),
  );
  const stubs = {
    docker: [
      '#!/bin/bash',
      'echo "$*" >> "$FAKE_LOG"',
      'case "$1 $2" in',
      ' "info --format") echo "$FAKE_DOCKER_ROOT";;',
      ' "volume inspect")',
      '   [[ $FAKE_VOLUME_MISSING != 1 ]] || exit 1',
      '   echo "local|none|bind|$FAKE_VOLUME_PATH|build-cache";;',
      ' "buildx inspect") echo docker-container;;',
      ' "inspect --format") echo "$FAKE_RUNNING|buildx_buildkit_weiban-release0_state";;',
      ' "buildx prune") ;;',
      ' *) echo "unexpected docker command" >&2; exit 97;;',
      'esac',
    ].join('\n'),
    stat: '#!/bin/bash\nif [[ $FAKE_SAME_DISK == 1 || "${@: -1}" != "$FAKE_CACHE_PATH" ]]; then echo 1; else echo 2; fi\n',
    df: '#!/bin/bash\nprintf "Avail\\n%s\\n" "$FAKE_AVAIL"\n',
    flock: '#!/bin/bash\n[[ $FAKE_BUSY != 1 ]]\n',
    id: '#!/bin/bash\necho 0\n',
  };
  for (const [name, text] of Object.entries(stubs))
    writeFileSync(join(bin, name), text, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    WEIBAN_BUILD_CACHE_CONFIG: config,
    RELEASE_LOCK_FILE: join(root, 'release.lock'),
    WEIBAN_RELEASE_LOCK_HELD: '0',
    FAKE_LOG: log,
    FAKE_DOCKER_ROOT: dockerRoot,
    FAKE_CACHE_PATH: cache,
    FAKE_VOLUME_PATH: cache,
    FAKE_VOLUME_MISSING: '0',
    FAKE_SAME_DISK: '0',
    FAKE_AVAIL: '30000000000',
    FAKE_RUNNING: 'true',
    FAKE_BUSY: '0',
    ...overrides,
  };
  return {
    root,
    cache,
    config,
    env,
    run: (...args) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env }),
    calls: () => readFileSync(log, 'utf8'),
  };
}
test('capacity pruning covers both builders without deleting images, volumes or restarting services', (t) => {
  const f = fixture(t);
  const r = f.run('prune');
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    f.calls(),
    /buildx prune --builder weiban-release --all --force --reserved-space 536870912 --max-used-space 4294967296 --min-free-space 12884901888/,
  );
  assert.match(
    f.calls(),
    /buildx prune --builder default --all --force --reserved-space 0 --max-used-space 1073741824/,
  );
  assert.doesNotMatch(f.calls(), /(?:image|volume|container) (?:rm|prune)|compose|restart/);
  assert.doesNotMatch(f.calls(), /until=/, 'a young but oversized cache must be reclaimable');
});
test('a busy release lock leaves cache alone', (t) => {
  const f = fixture(t, { FAKE_BUSY: '1' });
  const r = f.run('prune');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.calls(), '');
});
test('same filesystem and an incorrectly bound volume fail before pruning', (t) => {
  for (const overrides of [{ FAKE_SAME_DISK: '1' }, { FAKE_VOLUME_PATH: '/unrelated-volume' }]) {
    const f = fixture(t, overrides);
    const r = f.run('prune');
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(f.calls(), /buildx prune/);
  }
});
test('a missing volume or stopped builder fails before pruning', (t) => {
  for (const overrides of [{ FAKE_VOLUME_MISSING: '1' }, { FAKE_RUNNING: 'false' }]) {
    const f = fixture(t, overrides);
    const r = f.run('prune');
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(f.calls(), /buildx prune/);
  }
});
test('insufficient build filesystem space blocks builds, not running services', (t) => {
  const f = fixture(t, { FAKE_AVAIL: '1000000000' });
  const r = f.run('check');
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(f.calls(), /prune|stop|restart/);
});
test('dry run checks identity and prints limits without removing cache', (t) => {
  const f = fixture(t);
  const r = f.run('dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /max=4294967296/);
  assert.doesNotMatch(f.calls(), /buildx prune/);
});
test('invalid settings and redirected cache paths fail closed', (t) => {
  const f = fixture(t);
  writeFileSync(
    f.config,
    readFileSync(f.config, 'utf8').replace('MAX_BYTES=4294967296', 'MAX_BYTES=oops'),
  );
  assert.notEqual(f.run('prune').status, 0);
  assert.equal(f.calls(), '');
  writeFileSync(
    f.config,
    readFileSync(f.config, 'utf8').replace('MAX_BYTES=oops', 'MAX_BYTES=4294967296'),
  );
  const linked = join(f.root, 'linked');
  symlinkSync(f.cache, linked);
  writeFileSync(
    f.config,
    readFileSync(f.config, 'utf8').replace('CACHE_PATH=' + f.cache, 'CACHE_PATH=' + linked),
  );
  assert.notEqual(f.run('prune').status, 0);
  assert.doesNotMatch(f.calls(), /buildx prune/);
});
test('installer refuses an existing unrelated volume before changing builder or services', (t) => {
  const f = fixture(t, { FAKE_VOLUME_PATH: '/unrelated-volume' });
  const r = f.run('install', source, 'a'.repeat(40));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(f.calls(), /volume create|buildx create|buildx prune/);
});
test('builder GC has an all-cache capacity rule independent of the age rule', (t) => {
  const f = fixture(t);
  const r = f.run('render-config');
  assert.equal(r.status, 0, r.stderr);
  const all = r.stdout.split('[[worker.oci.gcpolicy]]')[2];
  assert.match(all, /all = true/);
  assert.match(all, /maxUsedSpace = 4294967296/);
  assert.match(all, /minFreeSpace = 12884901888/);
  assert.doesNotMatch(all, /keepDuration/);
});
