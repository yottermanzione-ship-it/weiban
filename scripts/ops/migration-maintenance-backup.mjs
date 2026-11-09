/** Execute the unchanged backup script with strict, networkless command fixtures. */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, sep, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assertIsolatedFixture } from './migration-maintenance.mjs';

const script = fileURLToPath(new URL('../../deploy/hk/backup.sh', import.meta.url));
const ops = fileURLToPath(new URL('../../deploy/hk/ops-lib.sh', import.meta.url));
const shellPath = (path) =>
  path.replaceAll('\\', '/').replace(/^([A-Za-z]):\//u, (_, drive) => `/${drive.toLowerCase()}/`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function removeFixture(root) {
  const absolute = realpathSync(root),
    temporary = realpathSync(tmpdir());
  if (
    !absolute.startsWith(temporary + sep) ||
    !basename(absolute).startsWith('codex-migration-maintenance-')
  ) {
    throw new Error('REFUSE_UNBOUNDED_FIXTURE_CLEANUP');
  }
  rmSync(absolute, { recursive: true, force: true });
}

export function runBackupRehearsal({ target, appInitiallyRunning = false, failure = 'none' } = {}) {
  assertIsolatedFixture(target);
  if (
    typeof appInitiallyRunning !== 'boolean' ||
    !['none', 'dump', 'term', 'space'].includes(failure)
  ) {
    throw new Error('INVALID_SYNTHETIC_BACKUP_SCENARIO');
  }
  const root = mkdtempSync(join(tmpdir(), 'codex-migration-maintenance-'));
  const started = performance.now();
  try {
    const bin = join(root, 'bin'),
      backups = join(root, 'backups'),
      state = join(root, 'app-state');
    const log = join(root, 'commands'),
      config = join(root, 'runtime.env'),
      recipient = join(root, 'recipient');
    for (const dir of [bin, backups, join(root, 'source')]) mkdirSync(dir);
    writeFileSync(state, appInitiallyRunning ? 'running' : 'stopped');
    writeFileSync(log, '');
    writeFileSync(config, '');
    writeFileSync(recipient, 'SYNTHETIC_RECIPIENT_NOT_A_KEY\n');
    const commands = {
      docker: `#!/usr/bin/env bash
set -euo pipefail
echo "docker $*" >> "$FIXTURE_LOG"
case "$1" in
  compose)
    case " $* " in
      *" ps --status running -q app "*) [[ $(cat "$FIXTURE_STATE") != running ]] || echo synthetic-app ;;
      *" stop app "*) echo stopped > "$FIXTURE_STATE" ;;
      *" pg_dump "*)
        [[ $FIXTURE_FAILURE != dump ]] || exit 7
        if [[ $FIXTURE_FAILURE == term ]]; then kill -TERM "$PPID"; exit 7; fi
        printf 'SYNTHETIC_DATABASE_BYTES' ;;
      *" --entrypoint tar "*) printf 'SYNTHETIC_MEDIA_BYTES' ;;
      *" --entrypoint du "*) printf '2048 /app/.data/media\\n' ;;
      *" pg_database_size("*) echo 1024 ;;
      *) echo 'fixture rejected unexpected compose command' >&2; exit 97 ;;
    esac ;;
  start) [[ $* == 'start synthetic-app' ]] || exit 97; echo running > "$FIXTURE_STATE" ;;
  inspect) echo healthy ;;
  *) echo 'fixture rejected unexpected docker command' >&2; exit 97 ;;
esac
`,
      systemctl: '#!/usr/bin/env bash\necho "systemctl $*" >> "$FIXTURE_LOG"\nexit 97\n',
      age: '#!/usr/bin/env bash\ncat\n',
      flock: '#!/usr/bin/env bash\nexit 0\n',
      df: '#!/usr/bin/env bash\nprintf "Avail\\n%s\\n" "$FIXTURE_FREE"\n',
      logger: '#!/usr/bin/env bash\necho fixture-alert >> "$FIXTURE_LOG"\n',
    };
    for (const [name, text] of Object.entries(commands))
      writeFileSync(join(bin, name), text, { mode: 0o755 });
    const windows = process.platform === 'win32';
    const bash = windows ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
    if (!existsSync(bash)) throw new Error('LOCAL_BASH_NOT_AVAILABLE');
    // No caller-supplied command path or production environment is forwarded.
    const env = {};
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LANG']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    env.PATH = [
      bin,
      ...(windows
        ? ['C:/Program Files/Git/usr/bin', 'C:/Program Files/Git/bin']
        : ['/usr/bin', '/bin']),
    ].join(delimiter);
    Object.assign(env, {
      WEIBAN_SRC: shellPath(join(root, 'source')),
      WEIBAN_DEPLOY_ENV: shellPath(config),
      WEIBAN_COMPOSE_PROJECT: 'codex_migration_maintenance_fixture',
      OPS_ALERT_DB: '0',
      BACKUP_AGE_RECIPIENT_FILE: shellPath(recipient),
      BACKUP_LOCK_FILE: shellPath(join(root, 'backup.lock')),
      BACKUP_RESERVE_BYTES: '16',
      BACKUP_SPACE_MARGIN_PERCENT: '20',
      BACKUP_MAX_TOTAL: '1M',
      KEEP: '2',
      APP_HEALTH_TIMEOUT_SECONDS: '0',
      FIXTURE_LOG: shellPath(log),
      FIXTURE_STATE: shellPath(state),
      FIXTURE_FAILURE: failure,
      FIXTURE_FREE: failure === 'space' ? '1' : '1000000000',
      FIXTURE_BIN: shellPath(bin),
      FIXTURE_SCRIPT: shellPath(script),
      FIXTURE_BACKUPS: shellPath(backups),
    });
    // Git Bash prepends its own tools during startup. Set PATH after that so every stub wins.
    const result = spawnSync(
      bash,
      [
        '-c',
        'export PATH="$FIXTURE_BIN:/usr/bin:/bin"; exec bash "$FIXTURE_SCRIPT" "$FIXTURE_BACKUPS"',
      ],
      {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    const bundles = readdirSync(backups).filter((name) => name.startsWith('weiban-'));
    return {
      isolation: 'networkless-command-fixture',
      actualBackupScriptExecuted: true,
      backupScriptSha256: sha(script),
      opsLibrarySha256: sha(ops),
      appInitiallyRunning,
      failure,
      exitCode: result.status,
      signal: result.signal,
      appFinallyRunning: readFileSync(state, 'utf8').trim() === 'running',
      starts: calls.filter((line) => line === 'docker start synthetic-app').length,
      stops: calls.filter((line) => line.endsWith(' stop app')).length,
      completeBundles: bundles.filter((name) => existsSync(join(backups, name, 'manifest.txt')))
        .length,
      partialBundles: bundles.filter((name) => !existsSync(join(backups, name, 'manifest.txt')))
        .length,
      unexpectedCommands: /unexpected|fixture rejected/u.test(result.stderr),
      systemctlCalls: calls.filter((line) => line.startsWith('systemctl')).length,
      elapsedMs: Math.round(performance.now() - started),
      // All output consists solely of synthetic paths/bytes, never real credentials or data.
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    removeFixture(root);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== '--isolated-fixture')
    throw new Error('EXPLICIT_ISOLATED_FIXTURE_REQUIRED');
  const target = { kind: 'isolated-fixture', network: 'none' };
  const results = [];
  for (const appInitiallyRunning of [false, true])
    for (const failure of ['none', 'dump', 'term', 'space']) {
      const {
        stdout: _stdout,
        stderr: _stderr,
        ...result
      } = runBackupRehearsal({ target, appInitiallyRunning, failure });
      results.push(result);
    }
  process.stdout.write(
    JSON.stringify({ kind: 'synthetic-backup-rehearsal', results }, null, 2) + '\n',
  );
}
