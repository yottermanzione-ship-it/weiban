// Old-host key is forwarded from a dedicated in-memory agent for this copy only.
import { execFileSync, spawn } from 'node:child_process';
const kind = process.argv[2] || 'generated';
if (!['generated', 'private-media'].includes(kind)) throw new Error('TRANSFER_KIND_INVALID');
const sourceRoot =
  kind === 'generated' ? '/opt/weiban-server/public' : '/opt/weiban-server/private';
const sourceDirectory = kind === 'generated' ? 'generated' : 'chat-media';
const bin = 'C:/Program Files/Git/usr/bin/';
const agent = execFileSync(bin + 'ssh-agent.exe', ['-s'], { encoding: 'utf8', windowsHide: true });
const socket = /SSH_AUTH_SOCK=([^;]+)/.exec(agent)?.[1];
const pid = /SSH_AGENT_PID=(\d+)/.exec(agent)?.[1];
if (!socket || !pid) throw new Error('AGENT_START_FAILED');
const env = { ...process.env, SSH_AUTH_SOCK: socket, SSH_AGENT_PID: pid };
const quiet = { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
try {
  execFileSync(bin + 'ssh-add.exe', ['C:/Users/lomjy3/.ssh/weiban_old.pem'], quiet);
  const known =
    execFileSync('ssh-keygen', ['-F', '152.136.111.51', '-f', 'C:/Users/lomjy3/.ssh/known_hosts'], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .join('\n') + '\n';
  if (!known.trim()) throw new Error('OLD_HOST_IDENTITY_MISSING');
  const ssh = [
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'ConnectTimeout=15',
    '-i',
    'C:/Users/lomjy3/.ssh/weiban_deploy',
    'root@103.231.58.124',
  ];
  execFileSync(
    bin + 'ssh.exe',
    [
      ...ssh,
      'umask 077; mkdir -p /var/lib/weiban-entry/retirement; cat > /var/lib/weiban-entry/retirement/old-host-known-hosts',
    ],
    { ...quiet, input: known, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const command = `bash -o pipefail -c 'umask 077; test "$(readlink -f /srv/weiban-history-media)" = /srv/weiban-history-media && ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/lib/weiban-entry/retirement/old-host-known-hosts -o ConnectTimeout=15 ubuntu@152.136.111.51 "sudo tar --checkpoint=4096 --checkpoint-action=echo=${kind}-transfer -C ${sourceRoot} -cf - ${sourceDirectory}" | tar -C /srv/weiban-history-media --no-same-owner -xf -'`;
  const child = spawn(bin + 'ssh.exe', ['-A', ...ssh, command], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`DIRECT_COPY_EXIT_${code}`)),
    );
  });
  console.log(`direct-${kind}-copy-complete`);
} finally {
  execFileSync(bin + 'ssh-agent.exe', ['-k'], quiet);
}
