/**
 * 导出脚本测试（Q-005）：每个 HTTP 接口都带路由信息导出，内联的 params / query / body / response 都有定义。
 */
import { describe, expect, it } from 'vitest';
import * as contracts from '../src/index.js';
import { buildContractDocuments } from '../scripts/contract-documents.js';

const { jsonSchema, openApi, report } = buildContractDocuments(
  contracts as unknown as Record<string, unknown>,
  contracts.CONTRACT_VERSION,
);

interface EndpointDoc {
  id: string;
  method: string;
  path: string;
  params?: { $ref: string };
  query?: { $ref: string };
  body?: { $ref: string };
  response: { $ref: string };
}

const defs = jsonSchema.$defs as Record<string, Record<string, unknown>>;
const endpoints = jsonSchema.endpoints as EndpointDoc[];

/** 契约里全部接口的数量，直接从源码数。 */
const sourceEndpointCount = Object.entries(contracts)
  .filter(([name]) => name.endsWith('Endpoints'))
  .reduce((sum, [, group]) => sum + Object.keys(group as object).length, 0);

describe('JSON Schema 导出', () => {
  it('带契约版本', () => {
    expect(jsonSchema.contractVersion).toBe(contracts.CONTRACT_VERSION);
  });

  it('每个接口都导出且带路由信息', () => {
    expect(endpoints.length).toBe(sourceEndpointCount);
    expect(report.endpointCount).toBe(sourceEndpointCount);
    const send = endpoints.find((e) => e.id === 'ChatEndpoints.sendMessage');
    expect(send).toMatchObject({
      method: 'POST',
      path: '/api/v1/conversations/:conversationId/messages',
    });
  });

  it('接口引用的定义都存在（含内联 schema）', () => {
    for (const e of endpoints) {
      for (const part of [e.params, e.query, e.body, e.response]) {
        if (part === undefined) continue;
        const name = part.$ref.replace('#/$defs/', '');
        expect(defs[name], `${e.id} → ${name}`).toBeDefined();
      }
    }
    expect(defs['IdentityEndpoints.listSessions.Response']).toBeDefined();
    expect(defs['BillingEndpoints.listLedger.Query']).toBeDefined();
  });

  it('所有 $ref 都指向存在的定义', () => {
    const text = JSON.stringify(jsonSchema);
    for (const match of text.matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)) {
      expect(defs[match[1] ?? ''], match[1]).toBeDefined();
    }
  });

  it('请求用输入形态：带默认值的字段可省略；响应用输出形态', () => {
    const login = endpoints.find((e) => e.id === 'IdentityEndpoints.login');
    const loginBody = defs[(login?.body?.$ref ?? '').replace('#/$defs/', '')];
    expect(loginBody?.required).not.toContain('kind');
  });

  it('事件与 WebSocket 帧也在定义里', () => {
    expect(defs['Events.MessageCreated']).toBeDefined();
    expect(defs.ServerFrame).toBeDefined();
    expect(report.opaque).toEqual([]);
  });
});

describe('OpenAPI 导出', () => {
  it('是 3.1 文档，操作数与接口数一致', () => {
    expect(openApi.openapi).toBe('3.1.0');
    expect(report.operationCount).toBe(sourceEndpointCount);
  });

  it('路径参数改写为 {name} 并声明为必填参数', () => {
    const paths = openApi.paths as Record<string, Record<string, { parameters?: unknown[] }>>;
    const op = paths['/api/v1/conversations/{conversationId}/messages']?.get;
    expect(op?.parameters).toContainEqual(
      expect.objectContaining({ name: 'conversationId', in: 'path', required: true }),
    );
    expect(op?.parameters).toContainEqual(
      expect.objectContaining({ name: 'limit', in: 'query', required: false }),
    );
  });

  it('无内容的接口返回 204', () => {
    const paths = openApi.paths as Record<string, Record<string, { responses: object }>>;
    expect(paths['/api/v1/auth/logout']?.post?.responses).toHaveProperty('204');
  });
});
