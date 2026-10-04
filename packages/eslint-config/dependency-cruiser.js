/**
 * 服务器模块之间禁止循环依赖（ADR-0004「同层之间允许调用端口，但禁止循环依赖」）。
 *
 * 为什么用 dependency-cruiser 而不是 ESLint：循环要看整张引用图，ESLint 一次只看一个文件；
 * dependency-cruiser 纯 JavaScript、无原生二进制，能精确表达「跨模块的循环」。
 *
 * 规则：apps/server/src/modules/<A>/ 下的文件，如果沿着 import 走一圈能回到自己，
 * 并且这一圈经过了别的模块（不全在 <A> 内部），就报错。
 *   - 不同层之间的循环必然有一条「下层 → 上层」的引用，R2 已经拦下；这里补上同层之间的循环。
 *   - 同一个模块内部文件之间的循环不在本规则范围内（ADR-0004 未要求）。
 *   - `import type` 也算依赖：两个模块在类型上互相依赖，同样说明边界划错了。
 *   - 测试文件不参与。
 *
 * 根目录 .dependency-cruiser.js 引用本配置，由 `pnpm lint`（lint:deps）运行。
 * 本文件由运维负责人维护；规则内容（是否禁止）由架构负责人定。
 */

/** 服务器源码目录（相对仓库根目录，正斜杠）。 */
export const SERVER_SRC = 'apps/server/src';

const MODULES = `^${SERVER_SRC}/modules/`;
const TEST_FILES = '\\.(test|spec)\\.[cm]?[jt]sx?$|/(test|tests|__tests__)/';

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
export const forbidden = [
  {
    name: 'no-cross-module-cycle',
    comment:
      '服务器模块之间禁止循环依赖（ADR-0004）。拆开的办法：改用事件通知，或把共同依赖下沉到更底层的模块。',
    severity: 'error',
    from: { path: `${MODULES}([^/]+)/` },
    to: { circular: true, viaSomeNot: `${MODULES}$1/` },
  },
];

/** @type {import('dependency-cruiser').ICruiseOptions} */
export const options = {
  includeOnly: `^${SERVER_SRC}/`,
  exclude: { path: TEST_FILES },
  doNotFollow: { path: 'node_modules' },
  // 看 TypeScript 编译之前的引用，import type 也算
  tsPreCompilationDeps: true,
  enhancedResolveOptions: {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
  },
};

/** @type {import('dependency-cruiser').IConfiguration} */
export default { forbidden, options };
