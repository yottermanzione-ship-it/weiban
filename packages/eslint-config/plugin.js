/**
 * 本地 ESLint 插件「weiban」：实现模块边界规则 R1～R9。
 * 每条规则自己根据文件路径判断是否适用，所以在整个仓库统一开启即可。
 */
import billingPortExit from './rules/billing-port-exit.js';
import contractsSource from './rules/contracts-source.js';
import exclusiveSdk from './rules/exclusive-sdk.js';
import moduleBoundaries from './rules/module-boundaries.js';
import noRawTime from './rules/no-raw-time.js';
import ownSchemaOnly from './rules/own-schema-only.js';

export default {
  meta: { name: '@weiban/eslint-plugin-local', version: '0.1.0' },
  rules: {
    'module-boundaries': moduleBoundaries,
    'exclusive-sdk': exclusiveSdk,
    'contracts-source': contractsSource,
    'no-raw-time': noRawTime,
    'own-schema-only': ownSchemaOnly,
    'billing-port-exit': billingPortExit,
  },
};
