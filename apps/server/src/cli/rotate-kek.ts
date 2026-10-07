/** 密钥轮换只在停止所有读写进程的维护窗口执行。默认只读，原始密钥不回显。 */
import { loadLocalEnv } from '../platform/config/local-env.js';
import { loadConfig, ConfigError } from '../platform/config/config.js';
import { loadKekRing } from '../platform/crypto/kek-ring.js';
import { EnvelopeCrypto } from '../platform/crypto/envelope.js';
import { Database } from '../platform/db/database.js';
import { SystemClock } from '../platform/clock/clock.js';
async function main() {
  const args = process.argv.slice(2).filter((x) => x !== '--');
  if (args.includes('--help')) {
    process.stdout.write(
      'rotate-kek [--apply --maintenance]：默认只读检查；必须先停止全部web/worker进程。配置PLATFORM_KEK_RING_FILE。\n',
    );
    return;
  }
  if (args.some((x) => !['--apply', '--maintenance'].includes(x))) throw new Error('不支持的参数');
  if (args.includes('--apply') && !args.includes('--maintenance'))
    throw new Error('先停止全部web/worker，再用--apply --maintenance执行');
  loadLocalEnv();
  const config = loadConfig();
  const ring = loadKekRing(config);
  if (!ring) throw new Error('必须配置主密钥文件集合');
  const db = new Database({ url: config.database.url, poolMax: 1 });
  try {
    const crypto = new EnvelopeCrypto(db, new SystemClock(), ring);
    process.stdout.write(
      `目标版本v${ring.currentVersion}；校验结果${JSON.stringify(await crypto.inspectKeys())}\n`,
    );
    if (args.includes('--apply')) {
      let count = 0;
      for (;;) {
        const n = await crypto.rotateKeyBatch();
        if (!n) break;
        count += n;
        process.stdout.write(`已提交${count}个数据密钥\n`);
      }
      const status = await crypto.inspectKeys();
      if (status.some((x) => x.version !== ring.currentVersion))
        throw new Error('仍有旧版本，维护窗口内重新运行');
      process.stdout.write(`轮换完成；${JSON.stringify(status)}\n`);
    } else process.stdout.write('只读检查完成，数据库未修改\n');
  } finally {
    await db.close();
    for (const key of ring.keys.values()) key.fill(0);
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof ConfigError
      ? `${error.message}\n`
      : '轮换未完成；保持旧/新密钥集合，不要删除旧密钥；检查配置/数据库和维护窗口后重试。\n',
  );
  process.exitCode = 1;
});
