// 生产构建（ADR-0014 结论 1 由后端选定的做法，见 docs/backend/kernel.md「生产构建」）：
// 用 esbuild 把服务器源码和工作区包（@weiban/contracts，源码形式）打包成 dist/*.js；
// 其他 npm 依赖不打包，运行时从 node_modules 加载（NestJS 有大量可选的动态 require，打包进去会出错）。
// 产物：dist/main.js（服务器）、dist/migrate.js（迁移命令）、dist/identity.js（账号运维命令）。运行：node dist/main.js。
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

/** 工作区包（@weiban/*）打包进来，其余裸模块名一律外部化。 */
const externalizeNpm = {
  name: 'externalize-npm',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@weiban/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: {
    main: 'src/main.ts',
    migrate: 'src/cli/migrate.ts',
    identity: 'src/cli/identity.ts',
    'rotate-kek': 'src/cli/rotate-kek.ts',
    'seed-models': 'src/cli/seed-models.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  tsconfig: 'tsconfig.json',
  plugins: [externalizeNpm],
  logLevel: 'info',
});
