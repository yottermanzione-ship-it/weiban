#!/usr/bin/env node
/**
 * 注销核验脚本（T-080，security-and-privacy.md 第 6 节「注销后查不到」）。维护：backend-lead。
 *
 * 做什么：核对某个已注销用户在服务器上没有任何残留——
 *   1. 每个模块删除清单的 countUserData 为 0；
 *   2. 全库所有 uuid 列（及 text 类型的用户引用列）里没有该用户 ID；
 *   3. 账号行、数据密钥已删除；审计记录不含明文用户 ID；已送达事件不含该用户 ID；
 *   4. 对象存储里没有无元数据的孤儿文件。
 * 只输出表名 / 模块名和条数，不输出内容。全部通过退出码 0，有残留退出码 2，执行失败退出码 1。
 *
 * 怎么运行（仓库根目录；本机从根目录 .env 读 DATABASE_URL 与媒体存储配置）：
 *   pnpm verify-user-purged <用户ID>
 *   node scripts/verify-user-purged.mjs <用户ID>
 * 生产（构建后，在服务器镜像里）：node dist/identity.js verify-purged <用户ID>
 *
 * 实现：转调服务器命令行 `identity verify-purged`（apps/server/src/cli/identity.ts → PurgeVerifier）。
 */
import { spawnSync } from 'node:child_process';

const userId = process.argv[2];
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  process.stderr.write('用法：node scripts/verify-user-purged.mjs <用户ID（UUID）>\n');
  process.exit(1);
}
const result = spawnSync(
  'pnpm',
  ['--filter', '@weiban/server', 'identity', 'verify-purged', userId],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
