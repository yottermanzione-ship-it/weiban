/** Actual payment service + an owned, temporary local PostgreSQL container; never a supplied URL. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
  fsyncSync,
  openSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { reconcileReceiptJournal } from './migration-maintenance.mjs';

const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const image = 'pgvector/pgvector:0.8.7-pg18';
const label = 'app.weiban.fixture';
function removeFixture(root) {
  const absolute = realpathSync(root),
    temporary = realpathSync(tmpdir());
  if (
    !absolute.startsWith(temporary + sep) ||
    !basename(absolute).startsWith('codex-migration-maintenance-payment-')
  ) {
    throw new Error('REFUSE_UNBOUNDED_PAYMENT_FIXTURE_CLEANUP');
  }
  rmSync(absolute, { recursive: true, force: true });
}

export async function runPaymentMaintenanceRehearsal({ target } = {}) {
  if (
    !target ||
    Object.keys(target).some((key) => !['kind', 'network'].includes(key)) ||
    target.kind !== 'isolated-fixture' ||
    target.network !== 'loopback-container'
  ) {
    throw new Error('ONLY_OWNED_LOCAL_CONTAINER_ALLOWED_NO_SUPPLIED_URL');
  }
  const dockerEnv = { ...process.env };
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
    delete dockerEnv[name];
  function rawDocker(args) {
    const result = spawnSync('docker', args, { encoding: 'utf8', env: dockerEnv, timeout: 30_000 });
    if (result.error || result.status !== 0)
      throw new Error(
        `ISOLATED_DOCKER_COMMAND_FAILED:${args[0]}:${result.status}:${result.stderr?.trim() ?? ''}`,
      );
    return result.stdout.trim();
  }
  const context = rawDocker(['context', 'show']);
  const endpoint = rawDocker([
    'context',
    'inspect',
    context,
    '--format',
    '{{(index .Endpoints "docker").Host}}',
  ]);
  if (
    !/^(?:npipe:\/\/\/\/.\/pipe\/dockerDesktopLinuxEngine|unix:\/\/\/var\/run\/docker.sock)$/u.test(
      endpoint,
    )
  ) {
    throw new Error('REMOTE_OR_UNKNOWN_DOCKER_ENDPOINT_REFUSED');
  }
  const docker = (args) => rawDocker(['--context', context, ...args]);
  docker(['image', 'inspect', image, '--format', '{{.Id}}']); // Never pull or mutate an existing image.
  const token = randomUUID().replaceAll('-', '').slice(0, 16);
  const name = `codex_migration_maintenance_${token}`,
    networkName = `${name}_net`;
  const databaseName = name,
    password = randomBytes(24).toString('hex');
  const root = mkdtempSync(join(tmpdir(), 'codex-migration-maintenance-payment-'));
  let containerId, networkId, app, unregister;
  const started = performance.now(),
    checks = [];
  try {
    networkId = docker(['network', 'create', '--label', `${label}=${token}`, networkName]);
    containerId = docker([
      'run',
      '--detach',
      '--pull=never',
      '--name',
      name,
      '--label',
      `${label}=${token}`,
      '--network',
      networkName,
      '--publish',
      '127.0.0.1::5432',
      '--memory',
      '1g',
      '--cpus',
      '1',
      '--tmpfs',
      '/var/lib/postgresql:rw,nosuid,size=768m',
      '--env',
      'PGDATA=/var/lib/postgresql/data',
      '--env',
      'POSTGRES_USER=fixture',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--env',
      `POSTGRES_DB=${databaseName}`,
      image,
    ]);
    assert.match(containerId, /^[a-f0-9]{64}$/u);
    const endpointText = docker(['port', containerId, '5432/tcp']);
    assert.match(endpointText, /^127\.0\.0\.1:\d+$/u);
    const connectionString = `postgres://fixture:${password}@${endpointText}/${databaseName}`;
    const url = new URL(connectionString);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, `/${databaseName}`);
    const pg = serverRequire('pg');
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const client = new pg.Client({ connectionString, connectionTimeoutMillis: 500 });
      try {
        await client.connect();
        const result = await client.query('SELECT current_database() AS name');
        assert.equal(result.rows[0].name, databaseName);
        ready = true;
      } catch {
        /* The owned initdb is still starting. */
      } finally {
        await client.end().catch(() => {});
      }
      if (ready) break;
      await new Promise((done) => setTimeout(done, 250));
    }
    assert.equal(ready, true, 'OWNED_DATABASE_NOT_READY');
    const { register } = serverRequire('tsx/esm/api');
    unregister = register({
      tsconfig: fileURLToPath(new URL('../../apps/server/tsconfig.json', import.meta.url)),
    });
    serverRequire('reflect-metadata');
    const { Migrator } = await import('../../apps/server/src/platform/db/migrator.ts');
    const migrations = new Migrator(
      connectionString,
      fileURLToPath(new URL('../../apps/server/drizzle', import.meta.url)),
    );
    const migrationStart = performance.now();
    await migrations.up();
    const status = await migrations.status();
    assert.equal(
      status.every((entry) => entry.applied),
      true,
    );
    assert.match(status.at(-1).tag, /^0162_/u);
    const migrationMs = Math.round(performance.now() - migrationStart);
    const { AppModule } = await import('../../apps/server/src/app.module.ts');
    const { configureHttpApp } = await import('../../apps/server/src/main.ts');
    const { loadConfig, TestClock, DATABASE } =
      await import('../../apps/server/src/platform/index.ts');
    const { createLogger } = await import('../../apps/server/src/platform/logging/logger.ts');
    const { ScanPaymentService, monitorSigningText, BillingTestQueries, MembershipOrderService } =
      await import('../../apps/server/src/modules/billing/testing.ts');
    const { IdentityCommands } = await import('../../apps/server/src/modules/identity/index.ts');
    const { Test } = serverRequire('@nestjs/testing');
    const sharp = serverRequire('sharp');
    const clock = new TestClock('2026-11-09T00:00:00.000Z');
    const key = randomBytes(32),
      keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const mediaRoot = join(root, 'media');
    mkdirSync(mediaRoot);
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: connectionString,
      LOG_LEVEL: 'silent',
      HTTP_TRUST_PROXY: 'true',
      MEDIA_DISK_ROOT: mediaRoot,
      APP_ROLE: 'web',
    });
    let service,
      database,
      query,
      baseUrl,
      userNumber = 0,
      deviceId;
    async function startApp() {
      const module = await Test.createTestingModule({
        imports: [
          AppModule.forRoot({
            config,
            clock,
            logger: createLogger({ level: 'silent' }),
            kekRing: { currentVersion: 1, keys: new Map([[1, key]]) },
            background: false,
          }),
        ],
      }).compile();
      app = module.createNestApplication({ logger: false });
      configureHttpApp(app, config);
      await app.init();
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();
      assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
      service = app.get(ScanPaymentService);
      database = app.get(DATABASE);
      query = new BillingTestQueries(database);
    }
    await startApp();
    const admin = await app
      .get(IdentityCommands)
      .createAdmin('migration_admin', randomBytes(32).toString('hex'));
    async function user() {
      userNumber++;
      const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.99.0.${userNumber}`,
        },
        body: JSON.stringify({
          username: `migration_${userNumber}`,
          password: randomBytes(32).toString('hex'),
          device: {
            platform: 'web',
            name: 'Synthetic migration fixture',
            appVersion: '7.8',
            timeZone: 'Asia/Shanghai',
          },
        }),
      });
      assert.equal(response.status, 201, 'SYNTHETIC_REGISTRATION_FAILED');
      return (await response.json()).user.userId;
    }
    const pair = await service.pairCode(admin, 'Synthetic isolated monitor');
    deviceId = pair.deviceId;
    await service.pair({
      deviceId,
      pairCode: pair.pairCode,
      publicKey,
      signature: sign(
        'sha256',
        Buffer.from(`wb-pay-pair-v1|${deviceId}|${pair.pairCode}|${publicKey}`),
        keys.privateKey,
      ).toString('base64'),
    });
    const signed = (event) => {
      const input = { deviceId, requestTime: clock.now().toISOString(), event, signature: '' };
      input.signature = sign(
        'sha256',
        Buffer.from(monitorSigningText(input)),
        keys.privateKey,
      ).toString('base64');
      return input;
    };
    const heartbeat = () =>
      service.report(signed({ type: 'heartbeat', listenerConnected: true, queued: 0 }));
    await heartbeat();
    const qr =
      'data:image/png;base64,' +
      (
        await sharp({
          create: { width: 8, height: 8, channels: 3, background: { r: 25, g: 40, b: 60 } },
        })
          .png()
          .toBuffer()
      ).toString('base64');
    const settings = { enabled: true, cutoverConfirmed: true, wechatQr: qr, alipayQr: qr };
    await service.saveSettings(admin, settings);
    const users = await Promise.all([user(), user(), user(), user(), user()]);
    const order = (owner, amountFen) =>
      service.create(owner, {
        clientOrderId: randomUUID(),
        channel: 'wechat',
        purchase: { kind: 'recharge', amountFen },
      });
    const orders = [
      await order(users[0], 500),
      await service.create(users[1], {
        clientOrderId: randomUUID(),
        channel: 'alipay',
        purchase: { kind: 'membership', planId: 'month' },
      }),
      await order(users[2], 700),
      await order(users[3], 800),
    ];
    await service.get(users[3], orders[3].id, true); // Explicit synthetic cancelled-order boundary.
    const events = orders.map((purchase) => ({
      type: 'receipt',
      eventId: createHash('sha256').update(randomUUID()).digest('hex'),
      channel: purchase.channel,
      amountFen: purchase.amountFen,
      observedAt: clock.now().toISOString(),
      postedAt: clock.now().toISOString(),
    }));
    const journalPath = join(root, 'durable-notification-fixture.json');
    writeFileSync(journalPath, JSON.stringify(events));
    const fd = openSync(journalPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const check = async (name, action) => {
      const start = performance.now();
      await action();
      checks.push({ name, passed: true, elapsedMs: Math.round(performance.now() - start) });
    };
    await check(
      'disabled orders reject; two channels preserve receipts without fulfillment',
      async () => {
        await service.saveSettings(admin, { ...settings, enabled: false });
        await assert.rejects(order(users[4], 900));
        for (const event of events.slice(0, 2))
          assert.equal((await service.report(signed(event))).status, 'review');
        assert.equal(
          (await service.receipts({ limit: 100 })).items.filter(
            (r) => r.reason === 'payments_disabled',
          ).length,
          2,
        );
        for (const owner of users.slice(0, 2))
          assert.equal((await query.ledgerOf(owner)).length, 0);
      },
    );
    await check(
      'retry and reopen do not silently fulfill already recorded disabled receipts',
      async () => {
        await service.saveSettings(admin, settings);
        for (const event of events.slice(0, 2)) {
          const results = await Promise.all([
            service.report(signed(event)),
            service.report(signed(event)),
          ]);
          assert.ok(results.every((result) => result.status === 'review'));
        }
        assert.equal((await service.receipts({ limit: 100 })).items.length, 2);
        await service.saveSettings(admin, { ...settings, enabled: false });
      },
    );
    await check(
      'application restart retains the disabled setting and the external original-event journal',
      async () => {
        await app.close();
        app = undefined;
        clock.advance(16 * 60_000);
        await startApp();
        assert.equal((await service.settings()).enabled, false);
        assert.deepEqual(JSON.parse(readFileSync(journalPath, 'utf8')), events);
      },
    );
    let laterOrder;
    await check(
      'late original receipt cannot credit a later buyer of the same amount',
      async () => {
        await heartbeat();
        await service.saveSettings(admin, settings);
        laterOrder = await order(users[4], orders[2].amountFen);
        assert.equal(laterOrder.amountFen, orders[2].amountFen);
        assert.equal((await service.report(signed(events[2]))).status, 'review');
        const saved = (await service.receipts({ limit: 100 })).items.find(
          (row) => row.eventId === events[2].eventId,
        );
        assert.equal(saved.reason, 'delayed_or_clock');
        assert.equal(saved.observedAt, events[2].observedAt);
        assert.equal(saved.postedAt, events[2].postedAt);
        assert.equal((await query.ledgerOf(users[4])).length, 0);
        await service.saveSettings(admin, { ...settings, enabled: false });
      },
    );
    await check(
      'explicit original-order reconciliation is idempotent for recharge and membership',
      async () => {
        for (let index = 0; index < 3; index++) {
          const saved = (await service.receipts({ limit: 100 })).items.find(
            (row) => row.eventId === events[index].eventId,
          );
          const results = await Promise.all(
            [0, 1, 2].map(() =>
              service.resolve(
                admin,
                saved.id,
                orders[index].id,
                'SYNTHETIC bank/order verified; controlled post-import reconciliation',
              ),
            ),
          );
          assert.ok(results.every((result) => result.status === 'matched'));
          assert.equal((await service.get(users[index], orders[index].id)).status, 'paid');
        }
        for (const index of [0, 2]) {
          const entries = (await query.ledgerOf(users[index])).filter(
            (entry) => entry.purpose === 'scan_recharge',
          );
          assert.equal(entries.length, 1);
          assert.equal(Number(entries[0].amount_micros), orders[index].amountFen * 10000);
        }
        assert.equal(
          (await app.get(MembershipOrderService).listOrders({ userId: users[1], limit: 10 })).items
            .length,
          1,
        );
        const { rows } = await database.query(
          'SELECT count(*)::int AS n FROM billing.scan_orders WHERE id=$1 AND membership_order_id IS NOT NULL',
          [orders[1].id],
        );
        assert.equal(rows[0].n, 1);
        assert.equal((await query.ledgerOf(users[4])).length, 0);
        assert.equal((await service.get(users[4], laterOrder.id)).status, 'pending');
      },
    );
    await check(
      'cancelled-order receipt remains recorded for review without automatic compensation',
      async () => {
        assert.equal((await service.report(signed(events[3]))).status, 'review');
        assert.equal((await service.get(users[3], orders[3].id)).status, 'cancelled');
        assert.equal((await query.ledgerOf(users[3])).length, 0);
      },
    );
    await check(
      'all persisted events are acknowledged once; a cancelled receipt blocks window release',
      async () => {
        for (const event of JSON.parse(readFileSync(journalPath, 'utf8')))
          await service.report(signed(event));
        const receipts = (await service.receipts({ limit: 100 })).items;
        assert.equal(receipts.length, events.length);
        assert.equal(new Set(receipts.map((row) => row.eventId)).size, events.length);
        for (const event of events) {
          const row = receipts.find((item) => item.eventId === event.eventId);
          assert.equal(row.observedAt, event.observedAt);
          assert.equal(row.postedAt, event.postedAt);
        }
        const captured = events.map((event) => ({ ...event, deviceId }));
        const recorded = [];
        for (const row of receipts) {
          const index = events.findIndex((event) => event.eventId === row.eventId);
          const entries = (await query.ledgerOf(users[index])).filter(
            (entry) => entry.idempotency_key === `scan_payment:${orders[index].id}`,
          );
          const { rows } = await database.query(
            'SELECT count(*)::int AS n FROM billing.scan_orders WHERE id=$1 AND status=$2',
            [orders[index].id, 'paid'],
          );
          recorded.push({
            ...row,
            deviceId,
            ledgerCount: entries.length,
            expectedLedgerCount: orders[index].points > 0 ? 1 : 0,
            fulfillmentCount: rows[0].n,
          });
        }
        const reconciliation = reconcileReceiptJournal(captured, recorded);
        assert.equal(reconciliation.missing, 0);
        assert.equal(reconciliation.conflicts, 0);
        assert.equal(reconciliation.unresolved, 1);
        assert.equal((await service.devices()).filter((item) => item.active).length, 1);
      },
    );
    await database.query(
      'CREATE TABLE public.codex_migration_fixture(id text PRIMARY KEY, synthetic boolean NOT NULL)',
    );
    await database.query(
      "INSERT INTO public.codex_migration_fixture VALUES('migration-1109',true)",
    );
    const { runEntitlementDatabaseRehearsal } =
      await import('./legacy-delta-entitlements-rehearsal.mjs');
    const entitlements = await runEntitlementDatabaseRehearsal({
      database,
      target: { kind: 'isolated-fixture', synthetic: true, url: connectionString },
      userIds: await Promise.all([user(), user(), user()]),
    });
    return {
      kind: 'synthetic-payment-maintenance-rehearsal',
      productionAccessed: false,
      database: databaseName,
      migrations: status.length,
      lastMigration: status.at(-1).tag,
      migrationMs,
      checks,
      journalEvents: events.length,
      recordedReceipts: events.length,
      manuallyReconciledSyntheticOrders: 3,
      heldCancelledSyntheticReceipts: 1,
      newOrdersRemainDisabled: (await service.settings()).enabled === false,
      elapsedMs: Math.round(performance.now() - started),
      entitlements,
      limits: [
        'Synthetic disk journal models phone retention; it is not an Android device test.',
        'Legacy recognition is a required external gate; no real legacy server was contacted.',
        'No database restore or real bank payment occurred in this payment fixture.',
      ],
    };
  } finally {
    if (app) await app.close();
    if (unregister) await unregister();
    if (containerId) {
      assert.equal(
        docker(['inspect', '--format', `{{index .Config.Labels "${label}"}}`, containerId]),
        token,
      );
      docker(['rm', '--force', '--volumes', containerId]);
    }
    if (networkId) {
      assert.equal(
        docker(['network', 'inspect', '--format', `{{index .Labels "${label}"}}`, networkId]),
        token,
      );
      docker(['network', 'rm', networkId]);
    }
    removeFixture(root);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== '--isolated-fixture')
    throw new Error('EXPLICIT_ISOLATED_FIXTURE_REQUIRED');
  const result = await runPaymentMaintenanceRehearsal({
    target: { kind: 'isolated-fixture', network: 'loopback-container' },
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
