/**
 * 测试启动前读取仓库根目录的 .env（若存在），让本机测试拿到 TEST_DATABASE_URL。
 * CI 等没有 .env 的环境直接用进程环境变量。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}
