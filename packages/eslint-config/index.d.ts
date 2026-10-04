// 给 TypeScript 测试文件用的类型声明（配置本体是 JS，ESLint 直接加载，无需编译）。
import type { Linter } from 'eslint';

export declare const GLOBAL_IGNORES: string[];
export declare const boundaryRules: Linter.RulesRecord;
declare const config: Linter.Config[];
export default config;
