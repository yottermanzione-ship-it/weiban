'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readKey, open } = require('./sealed-json.cjs');
function loadEnvironment(overrides = {}) {
  const root = path.resolve(__dirname, '..');
  const key = readKey('/run/secrets/kek');
  let bundle;
  try {
    bundle = open(JSON.parse(fs.readFileSync('/run/secrets/archive.sealed.json', 'utf8')), key);
  } finally {
    key.fill(0);
  }
  const denied = new Set([
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'WEIBAN_DATA_ENCRYPTION_KEY_FILE',
    'WEIBAN_DATA_ENCRYPTION_OLD_KEY_FILES',
  ]);
  for (const [name, value] of Object.entries(bundle.environment))
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && !denied.has(name) && typeof value === 'string')
      process.env[name] = value;
  process.env.WEIBAN_DATA_ENCRYPTION_KEY = bundle.vaultKey;
  process.env.WEIBAN_DATA_ENCRYPTION_OLD_KEYS = (bundle.oldVaultKeys || []).join(',');
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PORT: '8080',
    PUBLIC_DOMAIN: 'weiban.online',
    WEIBAN_DB_PATH: '/archive-data/history.sqlite',
    ADMIN_SESSION_COOKIE_SECURE: '1',
    LEGACY_WRITES_PAUSED: '1',
    LEGACY_GENERATION_DISABLED: '1',
    LEGACY_BACKGROUND_DISABLED: '1',
    LEGACY_CHANNEL_RELAY_ENABLED: '0',
    LEGACY_WEB_REDIRECT_ORIGIN: 'https://app.weiban.online',
    WECHAT_CHANNEL_ENABLED: '0',
    WEIBO_CHANNEL_ENABLED: '0',
    QQ_CHANNEL_ENABLED: '0',
    HEARTBEAT_DISABLED: '1',
    GROUP_SCENES_DISABLED: '1',
    MOMENTS_DISABLED: '1',
    MOMENTS_PUBLISH_DISABLED: '1',
    WEIBAN_GENERATED_MEDIA_ROOT: path.join(root, 'public/generated'),
    ...overrides,
  });
  require(path.join(root, 'lib/secret_vault')).hydrateSecretEnvironment();
  return root;
}
module.exports = { loadEnvironment };
