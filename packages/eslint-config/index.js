/**
 * @weiban/eslint-config —— 微伴共享 ESLint 配置（ESLint 10 扁平配置格式）。
 *
 * 用法（仓库根目录 eslint.config.js 已经这样写好，子项目一般不需要自己的配置）：
 *   import weiban from '@weiban/eslint-config';
 *   export default [...weiban];
 *
 * 内容：
 *   1. 通用规则：ESLint 推荐规则 + typescript-eslint 推荐规则，禁止 any（engineering-standards.md 第 1 节）
 *   2. 模块边界规则 R1～R9（engineering-standards.md 第 3 节），由本地插件 weiban 实现
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import {
  MODEL_PROVIDER_DOMAINS,
  MODEL_PROVIDER_PACKAGES,
  PUSH_PROVIDER_PACKAGES,
} from './architecture.js';
import weibanPlugin from './plugin.js';

/** 任何子项目都不检查的目录：依赖、构建产物、生成物、安卓 Gradle 工程。 */
export const GLOBAL_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/dev-dist/**',
  '**/.vite/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/blob-report/**',
  'packages/contracts/generated/**',
  'apps/android/**',
];

/** R1～R9 的规则开关与参数。单独导出，方便测试直接使用。 */
export const boundaryRules = {
  'weiban/module-boundaries': 'error', // R1、R2、R3
  'weiban/exclusive-sdk': [
    'error',
    [
      {
        id: 'R4',
        what: '模型',
        allowedModule: 'model-access',
        packages: MODEL_PROVIDER_PACKAGES,
        domains: MODEL_PROVIDER_DOMAINS,
      },
      { id: 'R5', what: '推送', allowedModule: 'push', packages: PUSH_PROVIDER_PACKAGES },
    ],
  ],
  'weiban/contracts-source': 'error', // R6
  'weiban/no-raw-time': 'error', // R7
  'weiban/own-schema-only': 'error', // R8
  'weiban/billing-port-exit': 'error', // R9
};

export default [
  { name: 'weiban/ignores', ignores: GLOBAL_IGNORES },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'weiban/base',
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    name: 'weiban/module-boundaries',
    plugins: { weiban: weibanPlugin },
    rules: boundaryRules,
  },
];
