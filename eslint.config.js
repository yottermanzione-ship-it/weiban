// 仓库根 ESLint 配置：整个仓库共用 @weiban/eslint-config（含模块边界规则 R1～R9）。
// 子项目需要额外规则（例如网页的浏览器全局变量、React 规则）时，在下面追加带 files 限定的配置块。
import weiban from '@weiban/eslint-config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...weiban,
  {
    files: [
      'apps/web/src/**/*.{ts,tsx}',
      'apps/web/test/**/*.ts',
      'apps/admin/src/**/*.{ts,tsx}',
      'packages/client-core/src/**/*.ts',
    ],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
];
