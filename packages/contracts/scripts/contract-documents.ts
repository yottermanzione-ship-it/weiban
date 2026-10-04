/**
 * 把契约模块（src/index.ts 的全部导出）转换为 JSON Schema 合集与 OpenAPI 3.1 文档。
 * 纯函数，不读写文件，便于测试（test/generate.test.ts）。
 *
 * 规则：
 * 1. 具名定义 = src/index.ts 导出的每个 Zod schema（事件以「Events.」开头）。
 * 2. 每个 HTTP 接口（导出名以 Endpoints 结尾的对象里的 EndpointDef）逐个导出路由信息（Q-005）；
 *    接口里没有名字的内联 schema 以「分组.接口名.Params / Query / Body / Response」命名。
 * 3. 响应和其他具名定义按「输出」形态导出（服务器发出的样子：带默认值的字段为必填）；
 *    请求部分（Params / Query / Body）按「输入」形态导出（可省略带默认值的字段）。
 *    同一个定义两种形态不同时，输入形态另起名「原名Input」。
 * 4. 接收端容错的 schema（z.preprocess）在输出形态下导出它的严格结果（含 type = 'unsupported' 分支）。
 */
import { z } from 'zod';

type Json = Record<string, unknown>;
type Io = 'input' | 'output';

const DEFS_PREFIX = '#/$defs/';
const COMPONENTS_PREFIX = '#/components/schemas/';

interface EndpointLike {
  method: string;
  path: string;
  auth: string;
  summary: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
}

const REQUEST_PARTS = [
  ['params', 'Params'],
  ['query', 'Query'],
  ['body', 'Body'],
] as const;

type RequestPart = (typeof REQUEST_PARTS)[number][0];

interface EndpointEntry {
  id: string;
  group: string;
  key: string;
  def: EndpointLike;
  request: Partial<Record<RequestPart, string>>;
  response: string;
}

export interface ContractDocuments {
  jsonSchema: Json;
  openApi: Json;
  report: {
    schemaCount: number;
    inputVariantCount: number;
    endpointCount: number;
    pathCount: number;
    operationCount: number;
    aliases: string[];
    opaque: string[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEndpoint(value: unknown): value is EndpointLike {
  return (
    isRecord(value) &&
    typeof value.method === 'string' &&
    typeof value.path === 'string' &&
    typeof value.auth === 'string' &&
    value.response instanceof z.ZodType
  );
}

/** 深拷贝 JSON，同时把 $ref '#/$defs/X' 换成 prefix + rename(X)。 */
function rewriteRefs(value: unknown, prefix: string, rename: (id: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRefs(item, prefix, rename));
  if (!isRecord(value)) return value;
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string' && child.startsWith(DEFS_PREFIX)) {
      out[key] = prefix + rename(child.slice(DEFS_PREFIX.length));
    } else {
      out[key] = rewriteRefs(child, prefix, rename);
    }
  }
  return out;
}

/** 收集一个定义直接引用的其他定义 id。 */
function refsOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) refsOf(item, found);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && child.startsWith(DEFS_PREFIX)) {
        found.add(child.slice(DEFS_PREFIX.length));
      } else {
        refsOf(child, found);
      }
    }
  }
  return found;
}

/** 从 roots 出发，沿引用找出所有需要的定义。 */
function reachable(roots: Iterable<string>, defs: Record<string, Json>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const def = defs[id];
    if (def === undefined) throw new Error(`引用了不存在的定义：${id}`);
    for (const ref of refsOf(def)) if (!seen.has(ref)) queue.push(ref);
  }
  return seen;
}

function convertRegistry(
  registry: z.core.$ZodRegistry<{ id: string }>,
  io: Io,
): Record<string, Json> {
  const result = z.toJSONSchema(registry, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'any',
    cycles: 'ref',
    uri: (id) => DEFS_PREFIX + id,
  });
  const defs: Record<string, Json> = {};
  for (const [id, schema] of Object.entries(result.schemas)) {
    const copy: Json = { ...(schema as Json) };
    delete copy.$schema;
    delete copy.$id;
    defs[id] = copy;
  }
  return defs;
}

export function buildContractDocuments(
  mod: Record<string, unknown>,
  contractVersion: string,
): ContractDocuments {
  const registry = z.registry<{ id: string }>();
  const idOf = new Map<z.ZodType, string>();
  const aliases: string[] = [];

  const register = (schema: z.ZodType, id: string, reportAlias: boolean): string => {
    const existing = idOf.get(schema);
    if (existing !== undefined) {
      if (reportAlias) aliases.push(`${id} = ${existing}`);
      return existing;
    }
    idOf.set(schema, id);
    registry.add(schema, { id });
    return id;
  };

  // 1. 具名导出
  const namedIds: string[] = [];
  const collect = (prefix: string, source: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(source)) {
      if (value instanceof z.ZodType) namedIds.push(register(value, prefix + name, true));
    }
  };
  collect('', mod);
  const events = mod.Events;
  if (isRecord(events)) collect('Events.', events);

  // 2. 接口
  const endpoints: EndpointEntry[] = [];
  for (const [group, value] of Object.entries(mod)) {
    if (!group.endsWith('Endpoints') || !isRecord(value)) continue;
    for (const [key, def] of Object.entries(value)) {
      if (!isEndpoint(def)) continue;
      const id = `${group}.${key}`;
      const request: Partial<Record<RequestPart, string>> = {};
      for (const [part, suffix] of REQUEST_PARTS) {
        const schema = def[part];
        if (schema !== undefined) request[part] = register(schema, `${id}.${suffix}`, false);
      }
      const response = register(def.response, `${id}.Response`, false);
      endpoints.push({ id, group, key, def, request, response });
    }
  }

  // 3. 两种形态分别转换
  const rawOut = convertRegistry(registry, 'output');
  const rawIn = convertRegistry(registry, 'input');

  const outputNeeded = reachable([...namedIds, ...endpoints.map((e) => e.response)], rawOut);
  const inputNeeded = reachable(
    endpoints.flatMap((e) => Object.values(e.request)),
    rawIn,
  );

  // 输入形态需要另起名的定义：两种形态都要导出，且内容不同（或引用了另起名的定义）
  const renamed = new Set<string>();
  for (const id of inputNeeded) {
    if (outputNeeded.has(id) && JSON.stringify(rawIn[id]) !== JSON.stringify(rawOut[id])) {
      renamed.add(id);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of inputNeeded) {
      if (renamed.has(id) || !outputNeeded.has(id)) continue;
      for (const ref of refsOf(rawIn[id])) {
        if (renamed.has(ref)) {
          renamed.add(id);
          changed = true;
          break;
        }
      }
    }
  }
  const inputName = (id: string) => (renamed.has(id) ? `${id}Input` : id);
  const outputName = (id: string) => id;

  const defs: Record<string, Json> = {};
  for (const id of [...outputNeeded].sort()) {
    defs[id] = rewriteRefs(rawOut[id], DEFS_PREFIX, outputName) as Json;
  }
  let inputVariantCount = 0;
  for (const id of [...inputNeeded].sort()) {
    const name = inputName(id);
    if (name === id && outputNeeded.has(id)) continue;
    defs[name] = rewriteRefs(rawIn[id], DEFS_PREFIX, inputName) as Json;
    if (name !== id) inputVariantCount += 1;
  }
  const opaque = Object.entries(defs)
    .filter(([, def]) => Object.keys(def).length === 0)
    .map(([id]) => id);

  // 4. JSON Schema 合集
  const ref = (name: string) => ({ $ref: DEFS_PREFIX + name });
  const isNoContent = (e: EndpointEntry) => {
    const def = defs[e.response];
    return def !== undefined && def.type === 'null';
  };
  const endpointDocs = endpoints.map((e) => {
    const doc: Json = {
      id: e.id,
      method: e.def.method,
      path: e.def.path,
      auth: e.def.auth,
      summary: e.def.summary,
      successStatus: isNoContent(e) ? 204 : 200,
    };
    for (const [part] of REQUEST_PARTS) {
      const id = e.request[part];
      if (id !== undefined) doc[part] = ref(inputName(id));
    }
    doc.response = ref(e.response);
    return doc;
  });

  const jsonSchema: Json = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://weiban.invalid/contracts/${contractVersion}/json-schema.json`,
    title: '微伴接口与事件契约',
    description:
      '由 packages/contracts（Zod）自动生成，不要手改。$defs：全部具名定义；endpoints：每个 HTTP 接口的路由与各部分定义。',
    contractVersion,
    endpoints: endpointDocs,
    $defs: defs,
  };

  // 5. OpenAPI 3.1
  const components = rewriteRefs(defs, COMPONENTS_PREFIX, (id) => id) as Record<string, Json>;
  const paths: Record<string, Record<string, Json>> = {};
  let operationCount = 0;

  const parametersOf = (id: string | undefined, location: 'path' | 'query', endpointId: string) => {
    if (id === undefined) return [];
    const schema = components[inputName(id)];
    if (schema === undefined || schema.type !== 'object' || !isRecord(schema.properties)) {
      throw new Error(`${endpointId} 的 ${location} 参数必须是对象 schema`);
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    return Object.entries(schema.properties).map(([name, propSchema]) => ({
      name,
      in: location,
      required: location === 'path' ? true : required.includes(name),
      schema: propSchema,
    }));
  };

  for (const e of endpoints) {
    const openApiPath = e.def.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const pathNames = [...e.def.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const pathParams = parametersOf(e.request.params, 'path', e.id);
    const declared = pathParams.map((p) => p.name);
    if (
      pathNames.length !== declared.length ||
      pathNames.some((name) => name === undefined || !declared.includes(name))
    ) {
      throw new Error(`${e.id}：路径 ${e.def.path} 的参数与 params 定义不一致`);
    }
    const parameters = [...pathParams, ...parametersOf(e.request.query, 'query', e.id)];

    const success = isNoContent(e)
      ? { '204': { description: '成功，无内容' } }
      : {
          '200': {
            description: '成功',
            content: { 'application/json': { schema: { $ref: COMPONENTS_PREFIX + e.response } } },
          },
        };

    const operation: Json = {
      operationId: e.id,
      tags: [e.group],
      summary: e.def.summary,
      'x-weiban-auth': e.def.auth,
      security: e.def.auth === 'none' ? [] : [{ session: [] }],
      responses: {
        ...success,
        default: {
          description: '失败（统一错误格式，engineering-standards.md 第 4 节）',
          content: { 'application/json': { schema: { $ref: `${COMPONENTS_PREFIX}ApiError` } } },
        },
      },
    };
    if (parameters.length > 0) operation.parameters = parameters;
    const bodyId = e.request.body;
    if (bodyId !== undefined) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': { schema: { $ref: COMPONENTS_PREFIX + inputName(bodyId) } },
        },
      };
    }

    const method = e.def.method.toLowerCase();
    const pathItem = (paths[openApiPath] ??= {});
    if (pathItem[method] !== undefined)
      throw new Error(`重复的接口：${e.def.method} ${e.def.path}`);
    pathItem[method] = operation;
    operationCount += 1;
  }

  const openApi: Json = {
    openapi: '3.1.0',
    info: {
      title: '微伴 API',
      version: contractVersion,
      description:
        '由 packages/contracts 自动生成，不要手改。WebSocket 帧（Client* / Server*）与领域事件（Events.*）见 components。',
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    tags: [...new Set(endpoints.map((e) => e.group))].map((name) => ({ name })),
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        session: {
          type: 'http',
          scheme: 'bearer',
          description: '登录 / 注册返回的会话令牌；管理接口需要管理会话（kind = admin）',
        },
      },
    },
  };

  return {
    jsonSchema,
    openApi,
    report: {
      schemaCount: Object.keys(defs).length,
      inputVariantCount,
      endpointCount: endpoints.length,
      pathCount: Object.keys(paths).length,
      operationCount,
      aliases,
      opaque,
    },
  };
}
