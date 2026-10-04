/**
 * 本机开发时读取仓库根目录的 .env（docs/ops/local-dev.md）。生产环境不读文件，只用进程环境变量。
 * 从当前目录往上找，直到找到 pnpm-workspace.yaml 所在的仓库根目录。已存在的环境变量不会被覆盖。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function loadLocalEnv(startDir: string = process.cwd()): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const envFile = join(dir, '.env');
      if (!existsSync(envFile)) return null;
      process.loadEnvFile(envFile);
      return envFile;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
