'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvironment } = require('./archive-environment.cjs');
const active = process.env.ENTRY_RELAY_ACTIVE === '1';
if (active) {
  const receipt = JSON.parse(fs.readFileSync('/run/retirement/activation.json', 'utf8'));
  if (
    receipt.version !== 1 ||
    receipt.oldWechatStopped !== true ||
    !receipt.captureSha256 ||
    !receipt.activatedAt
  )
    throw new Error('OLD_WECHAT_HANDOFF_REQUIRED');
}
const root = loadEnvironment({
  WEIBAN_DB_PATH: '/bridge-data/bridge.sqlite',
  LEGACY_CHANNEL_RELAY_ENABLED: active ? '1' : '0',
  WECHAT_CHANNEL_ENABLED: active ? '1' : '0',
  LEGACY_CHANNEL_RELAY_BASE_URL: 'https://app.weiban.online',
  LEGACY_CHANNEL_RELAY_MAP_FILE: '/run/retirement/legacy-map.json',
});
require(path.join(root, 'server.js'));
