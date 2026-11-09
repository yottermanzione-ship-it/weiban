/**
 * Target-container callback, using a previously authenticated Linux OpenSSH ControlMaster.
 * This module/factory never starts an agent, opens a connection, or reads a private key.
 * Root starts the master once using fastCutoverMediaMasterArgs(); readSource only multiplexes it.
 * A lost master fails closed (ProxyCommand=false); it cannot create per-file TCP handshakes.
 *
 * Mounts supplied by root:
 *   1. The exact forwarded agent socket -> /run/wb-fast/agent.sock; SSH_AUTH_SOCK points there.
 *   2. A verified public known_hosts file (read-only) -> /run/wb-fast/known_hosts.
 *   3. Private tmpfs /run/wb-fast/control (0700) for old-%C.sock; no plaintext media staging.
 * No key file, local .ssh directory, or agent directory is mounted/copied.
 * Keep the local ephemeral agent and local->HK ssh -A session alive until completion.
 * The container->old-server connection uses ForwardAgent=no: the old server gets no agent socket.
 *
 * Existing maintenance runner:
 *   const readSource = createFastCutoverSshMediaReader(settings);
 *   await importFastCutoverMedia({...runtime, objects, readSource, execute:true});
 * Root spawns `ssh` with fastCutoverMediaMasterArgs(settings) once, outside this module.
 * Root closes it afterwards with fastCutoverMediaControlArgs(settings, 'exit').
 */
import { spawn } from 'node:child_process';
import { isAbsolute, posix } from 'node:path';
import { decodeFastCutoverMediaFrame } from './fast-cutover-media-source.mjs';

const DESTINATION = 'ubuntu@152.136.111.51';
const MAX_FRAME_BYTES = 64 * 1024 * 1024 + 8196;
const need = (value, code) => {
  if (!value) throw new Error(code);
};

function config(input) {
  const value = { ...input, sshAuthSock: input.sshAuthSock ?? process.env.SSH_AUTH_SOCK };
  for (const key of [
    'controlPath',
    'knownHostsFile',
    'sshAuthSock',
    'sourceRoot',
    'sourceScriptPath',
  ])
    need(
      typeof value[key] === 'string' && isAbsolute(value[key]) && !/[\r\n\0]/.test(value[key]),
      'FAST_MEDIA_SSH_CONFIG_INVALID',
    );
  need(
    value.controlPath.includes('%C') && !value.controlPath.includes(' '),
    'FAST_MEDIA_SSH_CONTROL_PATH_INVALID',
  );
  // OpenSSH joins the remote argv into a shell command. Only this temporary script path is allowed in it.
  need(
    /^\/tmp\/[A-Za-z0-9_./-]+\/fast-cutover-media-source\.mjs$/.test(value.sourceScriptPath) &&
      posix.normalize(value.sourceScriptPath) === value.sourceScriptPath &&
      !value.sourceScriptPath.split('/').includes('..'),
    'FAST_MEDIA_SSH_SOURCE_SCRIPT_INVALID',
  );
  value.timeoutMs ??= 60000;
  need(
    Number.isInteger(value.timeoutMs) && value.timeoutMs >= 1000 && value.timeoutMs <= 120000,
    'FAST_MEDIA_SSH_TIMEOUT_INVALID',
  );
  return value;
}
function common(value) {
  return [
    '-F',
    '/dev/null',
    '-p',
    '22',
    '-S',
    value.controlPath,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile=${value.knownHostsFile}`,
    '-o',
    'GlobalKnownHostsFile=/dev/null',
    '-o',
    `IdentityAgent=${value.sshAuthSock}`,
    '-o',
    'IdentityFile=none',
    '-o',
    'IdentitiesOnly=no',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
  ];
}
/** Arguments only: caller explicitly starts the one master. No connection is started here. */
export function fastCutoverMediaMasterArgs(input) {
  const value = config(input);
  return [...common(value), '-M', '-N', '-f', '-o', 'ControlPersist=600', DESTINATION];
}
/** Arguments only: caller can check/close its own master after transfers. */
export function fastCutoverMediaControlArgs(input, operation = 'check') {
  need(['check', 'exit'].includes(operation), 'FAST_MEDIA_SSH_CONTROL_OPERATION_INVALID');
  return [...common(config(input)), '-O', operation, DESTINATION];
}

function command(args, input, timeoutMs, maxBytes) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks = [];
    let size = 0,
      finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      input?.fill(0);
      const output = code ? null : Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      if (code) reject(new Error(code));
      else resolveResult(output);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish('FAST_MEDIA_SSH_TIMEOUT');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (finished) {
        chunk.fill(0);
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        chunk.fill(0);
        child.kill('SIGKILL');
        finish('FAST_MEDIA_SSH_RESPONSE_TOO_LARGE');
      } else chunks.push(chunk);
    });
    // ssh/sudo stderr can contain paths. Consume it without logging or returning it.
    child.stderr.on('data', (chunk) => chunk.fill(0));
    child.stdin.on('error', () => {});
    child.on('error', () => finish('FAST_MEDIA_SSH_UNAVAILABLE'));
    child.on('close', (code) => finish(code === 0 ? null : 'FAST_MEDIA_SSH_REMOTE_FAILED'));
    child.stdin.end(input);
  });
}

/** Returns the precise readSource(object) callback expected by importFastCutoverMedia. */
export function createFastCutoverSshMediaReader(input) {
  const value = config(input);
  let checked;
  return async function readSource(object) {
    // -O check never falls back to opening a TCP connection; check once before file transfers.
    checked ??= command(fastCutoverMediaControlArgs(value), undefined, 10000, 1024).then(
      (bytes) => {
        bytes.fill(0);
      },
    );
    await checked;
    const { kind, path, bytes, mtimeMs } = object.asset;
    const request = Buffer.from(
      JSON.stringify({ root: value.sourceRoot, asset: { kind, path, bytes, mtimeMs } }),
    );
    let frame;
    try {
      need(request.length <= 8192, 'FAST_MEDIA_SSH_REQUEST_TOO_LARGE');
      frame = await command(
        [
          ...common(value),
          '-o',
          'ControlMaster=no',
          '-o',
          'ProxyCommand=false',
          DESTINATION,
          'sudo',
          '-n',
          'node',
          '--',
          value.sourceScriptPath,
        ],
        request,
        value.timeoutMs,
        MAX_FRAME_BYTES,
      );
      return decodeFastCutoverMediaFrame(frame);
    } finally {
      request.fill(0);
      frame?.fill(0);
    }
  };
}
