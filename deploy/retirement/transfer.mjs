// Transfer only fixed, authorized archive paths. Data never lands on the workstation.
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const plans = {
  source: {
    read: "sudo tar --exclude='*.bak*' --exclude='*.before-*' --exclude='public/download-page/*.apk' -C /opt/weiban-server -czf - package.json package-lock.json db.js server.js lib routes public/console public/download-page public/official-assets public/payment-assets public/stickers persona_packages",
    write:
      'umask 077; mkdir -p /var/lib/weiban-entry/source; tar -C /var/lib/weiban-entry/source --no-same-owner -xzf -',
  },
  database: {
    read: 'sudo tar -C /opt/weiban-server/private/retirement-prep-20261110 -czf - history.sqlite',
    write:
      'umask 077; mkdir -p /var/lib/weiban-entry/data; tar -C /var/lib/weiban-entry/data --no-same-owner -xzf -',
  },
  media: {
    read: 'sudo tar -C /opt/weiban-server/public -cf - generated',
    write:
      'umask 077; mkdir -p /srv/weiban/history-media; tar -C /srv/weiban/history-media --no-same-owner -xf -',
  },
  media_directories: {
    read: "bash -o pipefail -c 'cd /opt/weiban-server/public && sudo find generated -type d -print0 | sudo tar --no-recursion --null -cf - -T -'",
    write: 'umask 077; tar -C /srv/weiban/history-media --no-same-owner -xf -',
  },
};
const name = process.argv[2];
const plan = plans[name];
if (!plan) throw new Error('Choose source, database or media');
const ssh = (old, command) =>
  spawn(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=20',
      '-i',
      old ? 'C:/Users/lomjy3/.ssh/weiban_old.pem' : 'C:/Users/lomjy3/.ssh/weiban_deploy',
      old ? 'ubuntu@152.136.111.51' : 'root@103.231.58.124',
      command,
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
const source = ssh(true, plan.read);
const target = ssh(false, plan.write);
source.stdin.end();
let bytes = 0;
const digest = createHash('sha256');
const progress = new Transform({
  transform(chunk, _encoding, done) {
    bytes += chunk.length;
    digest.update(chunk);
    done(null, chunk);
  },
});
let failed = false;
const exits = [source, target].map(
  (child, index) =>
    new Promise((resolve, reject) => {
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-500);
      });
      child.stdout.on('error', reject);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          failed = true;
          reject(new Error(`Transfer ${name} endpoint ${index} exited ${code}; ${stderr}`));
        }
      });
    }),
);
target.stdout.resume();
const timer = setInterval(
  () => console.log(JSON.stringify({ phase: name, transferredMiB: Math.round(bytes / 1048576) })),
  15000,
);
try {
  await Promise.all([pipeline(source.stdout, progress, target.stdin), ...exits]);
  console.log(
    JSON.stringify({
      phase: name,
      transferredBytes: bytes,
      streamSha256: digest.digest('hex'),
      complete: !failed,
    }),
  );
} finally {
  clearInterval(timer);
  source.kill();
  target.kill();
}
