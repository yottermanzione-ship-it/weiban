/** Maintenance-container pipeline. Private snapshot stdout goes straight into the runner stdin. */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import {
  fastCutoverMediaMasterArgs,
  fastCutoverMediaControlArgs,
} from './fast-cutover-media-ssh.mjs';

const error = (code) => {
  throw new Error(code);
};
const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
function run(command, args, { env = process.env } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => b.fill(0));
    child.stderr.on('data', (b) => b.fill(0));
    child.on('error', () => fail(new Error('FAST_TRANSPORT_PROCESS_UNAVAILABLE')));
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error('FAST_TRANSPORT_CONTROL_FAILED')),
    );
  });
}
async function main() {
  const options = new Map();
  let execute = false;
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--execute') {
      execute = true;
      continue;
    }
    if (key === '--plan') continue;
    if (
      ![
        '--settings',
        '--cutoff',
        '--freeze-id',
        '--expected-database',
        '--expected-oid',
        '--rounding',
        '--benefit-cutover-at',
        '--expected-source-digest',
      ].includes(key) ||
      !process.argv[i + 1]
    )
      error('FAST_TRANSPORT_ARGUMENT_INVALID');
    options.set(key, process.argv[++i]);
  }
  const settingsFile = options.get('--settings');
  if (!settingsFile) error('FAST_TRANSPORT_SETTINGS_REQUIRED');
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  if (settings.controlPath !== '/tmp/wb-fast-control/old-%C.sock')
    error('FAST_TRANSPORT_CONTROL_PATH_INVALID');
  mkdirSync('/tmp/wb-fast-control', { recursive: true, mode: 0o700 });
  const cutoff = options.get('--cutoff');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(cutoff ?? ''))
    error('FAST_TRANSPORT_CUTOFF_REQUIRED');
  const freezeId = options.get('--freeze-id');
  if (execute && !/^[A-Za-z0-9_-]{6,80}$/.test(freezeId ?? ''))
    error('FAST_TRANSPORT_FREEZE_ID_REQUIRED');
  const sourceExporter = dirname(settings.sourceScriptPath) + '/fast-cutover-export.mjs';
  if (!/^\/tmp\/[A-Za-z0-9_./-]+\/fast-cutover-export\.mjs$/.test(sourceExporter))
    error('FAST_TRANSPORT_SOURCE_PATH_INVALID');
  const env = { ...process.env, SSH_AUTH_SOCK: settings.sshAuthSock };
  let master = false,
    source,
    target;
  try {
    await run('ssh', fastCutoverMediaMasterArgs(settings), { env });
    master = true;
    const config = loadConfig(),
      db = new pg.Client({ connectionString: config.database.url });
    let operator;
    try {
      await db.connect();
      const result = await db.query(
        "SELECT id FROM identity.users WHERE role='admin' AND status='active'",
      );
      if (result.rows.length !== 1) error('FAST_TRANSPORT_ADMIN_NOT_UNIQUE');
      operator = result.rows[0].id;
    } finally {
      await db.end().catch(() => {});
    }
    const command = [
      'sudo',
      '-n',
      'node',
      '--',
      sourceExporter,
      '--db',
      '/opt/weiban-server/weiban.db',
      '--root',
      settings.sourceRoot,
      '--cutoff',
      cutoff,
    ];
    if (execute)
      command.push(
        '--frozen',
        '--freeze-id',
        freezeId,
        '--writer-units',
        'weiban-voice-agent.service,weiban-voice-bridge.service',
        '--confirmed-process-stop',
      );
    const sshArgs = [
      '-F',
      '/dev/null',
      '-p',
      '22',
      '-S',
      settings.controlPath,
      '-o',
      'BatchMode=yes',
      '-o',
      'ControlMaster=no',
      '-o',
      'ProxyCommand=false',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${settings.knownHostsFile}`,
      '-o',
      'ForwardAgent=no',
      'ubuntu@152.136.111.51',
      command.map(quote).join(' '),
    ];
    const runner = resolve(dirname(fileURLToPath(import.meta.url)), 'fast-cutover-runner.mjs');
    const runnerArgs = [
      runner,
      execute ? '--execute' : '--plan',
      '--operator-id',
      operator,
      '--source-ssh-settings',
      settingsFile,
    ];
    for (const key of [
      '--expected-database',
      '--expected-oid',
      '--rounding',
      '--benefit-cutover-at',
      '--expected-source-digest',
    ])
      if (options.has(key)) runnerArgs.push(key, options.get(key));
    if (execute) runnerArgs.push('--confirm-maintenance', freezeId);
    source = spawn('ssh', sshArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    target = spawn(process.execPath, runnerArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const done = (child) =>
      new Promise((resolveResult) => {
        child.on('error', () => resolveResult(-1));
        child.on('close', (code) => resolveResult(code ?? -1));
      });
    const sourceDone = done(source),
      targetDone = done(target);
    // Only these reviewed programs' JSON summaries reach the operator. Never expose source stdout.
    source.stderr.on('data', (b) => {
      try {
        const v = JSON.parse(b.toString());
        if (v && typeof v === 'object' && v.privateValuesReturned === false)
          process.stderr.write(JSON.stringify(v) + '\n');
      } catch {
        /*No raw SSH/SQL output.*/
      } finally {
        b.fill(0);
      }
    });
    target.stdout.pipe(process.stdout);
    target.stderr.pipe(process.stderr);
    source.stdout.pipe(target.stdin);
    target.stdin.on('error', () => source.kill());
    const onSignal = () => {
      source.kill();
      target.kill();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const codes = await Promise.all([sourceDone, targetDone]);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (codes.some((code) => code !== 0)) error('FAST_TRANSPORT_PIPELINE_FAILED');
  } finally {
    source?.kill();
    target?.kill();
    if (master)
      await run('ssh', fastCutoverMediaControlArgs(settings, 'exit'), { env }).catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category: 'FAST_TRANSPORT_FAILED',
        privateValuesReturned: false,
        partialCommitPossible: true,
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
