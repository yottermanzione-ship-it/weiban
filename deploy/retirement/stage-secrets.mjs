import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
const kind = process.argv[2];
if (!['archive', 'wechat'].includes(kind)) throw new Error('Choose archive or wechat');
const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyHash = createHash('sha256')
  .update(pair.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const ssh = (old, command, input) =>
  execFileSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'ConnectTimeout=15',
      '-i',
      old ? 'C:/Users/lomjy3/.ssh/weiban_old.pem' : 'C:/Users/lomjy3/.ssh/weiban_deploy',
      old ? 'ubuntu@152.136.111.51' : 'root@103.231.58.124',
      command,
    ],
    {
      input,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
let phase = 'export';
try {
  const encrypted = JSON.parse(
    ssh(
      true,
      'sudo node /tmp/weiban-retirement-export-secrets.cjs',
      JSON.stringify({ kind, publicKey, publicKeyHash }),
    ),
  );
  phase = 'store';
  const command =
    'docker run --rm -i --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --security-opt no-new-privileges -v /var/lib/weiban-entry/retirement:/ops:ro -v /var/lib/weiban-entry:/entry -v /srv/weiban/secrets/kek:/run/secrets/kek:ro --entrypoint node weiban-app:release-3bdac5d2589c7cc3d598c820a828dc911fa9319c /ops/receive-secrets.cjs';
  const summary = JSON.parse(ssh(false, command, JSON.stringify({ privateKey, encrypted })));
  console.log(JSON.stringify(summary));
} catch (error) {
  // Do not print a child-process object: it could contain encrypted transport input.
  const diagnostic =
    /(?:Error:|code:\s*')\s*([A-Z_]{4,})/.exec(String(error.stderr || ''))?.[1] || 'UNCLASSIFIED';
  console.error(
    JSON.stringify({
      staged: false,
      kind,
      phase,
      category: 'SECRET_STAGING_FAILED',
      diagnostic,
      exitStatus: error.status ?? null,
    }),
  );
  process.exitCode = 1;
}
