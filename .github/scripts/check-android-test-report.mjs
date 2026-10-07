import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function collect(directory, found = []) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) collect(path, found);
    else if (
      item.name.startsWith('TEST-') &&
      item.name.endsWith('.xml') &&
      path.includes('/build/test-results/')
    )
      found.push(path);
  }
  return found;
}
let total = 0;
const classes = new Set();
for (const path of collect('apps/android')) {
  const source = readFileSync(path, 'utf8');
  const tag = source.match(/<testsuite\s[^>]+>/)?.[0];
  if (!tag) throw new Error(`Invalid JUnit report: ${path}`);
  const attribute = (name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  for (const name of ['failures', 'errors', 'skipped'])
    if (Number(attribute(name)) !== 0) throw new Error(`Android ${name} != 0: ${path}`);
  const count = Number(attribute('tests'));
  if (!Number.isInteger(count) || count < 1) throw new Error(`No Android tests executed: ${path}`);
  total += count;
  classes.add(attribute('name'));
}
for (const name of [
  'app.weiban.testvectors.ProtocolVectorsTest',
  'app.weiban.testvectors.HistoryTest',
  'app.weiban.data.SyncRunnerTest',
  'app.weiban.data.ChatRealtimeTest',
  'app.weiban.data.BackgroundChatDrainTest',
  'app.weiban.feature.chat.ChatScreenTest',
  'app.weiban.data.SessionRepositoryTest',
  'app.weiban.network.ApiClientTest',
  'app.weiban.network.ContractJsonTest',
  'app.weiban.feature.auth.AuthScreenTest',
  'app.weiban.feature.me.MeScreenTest',
  'app.weiban.feature.me.AvatarCropTest',
  'app.weiban.feature.me.MoneyTest',
  'app.weiban.contracts.ContractRoundTripTest',
]) {
  if (!classes.has(name)) throw new Error(`Required Android suite did not execute: ${name}`);
}
console.log(`Android JUnit: ${total} passed, 0 skipped`);
