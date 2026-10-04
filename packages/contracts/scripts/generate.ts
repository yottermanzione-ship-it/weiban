/**
 * 契约导出：pnpm --filter @weiban/contracts generate
 *
 * 产出（packages/contracts/generated/，构建产物，不进仓库）：
 * - json-schema.json：JSON Schema（draft 2020-12）合集，安卓 Kotlin 数据类由它生成。
 * - openapi.json：OpenAPI 3.1 接口文档。
 * 导出规则见 contract-documents.ts 文件头。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as contracts from '../src/index.js';
import { buildContractDocuments } from './contract-documents.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated');
mkdirSync(outDir, { recursive: true });

const { jsonSchema, openApi, report } = buildContractDocuments(
  contracts as unknown as Record<string, unknown>,
  contracts.CONTRACT_VERSION,
);

writeFileSync(join(outDir, 'json-schema.json'), `${JSON.stringify(jsonSchema, null, 2)}\n`);
writeFileSync(join(outDir, 'openapi.json'), `${JSON.stringify(openApi, null, 2)}\n`);

console.log(`契约版本 ${contracts.CONTRACT_VERSION}`);
console.log(
  `JSON Schema：${report.schemaCount} 个定义（其中请求用的输入形态 ${report.inputVariantCount} 个），` +
    `${report.endpointCount} 个接口`,
);
console.log(`OpenAPI：${report.pathCount} 个路径、${report.operationCount} 个操作`);
console.log(`输出目录：${outDir}`);
if (report.aliases.length > 0) console.log(`同一 schema 的别名：${report.aliases.join('；')}`);
if (report.opaque.length > 0) {
  console.warn(`以下定义无法用 JSON Schema 表达，导出为任意值 {}：${report.opaque.join(', ')}`);
}
