# 服务单位单价合并接口：契约变更申请与批准范围

日期：2026-10-22。依据总经理本轮明确实施授权，由开发接管者登记申请和批准范围；独立验收另行安排，不冒称已验收。

## 申请 / 批准

批准在契约 3.36 为现有后台模型合并 listModels/upsertModel 增加可选 serviceRates，不新增 HTTP 路由。底层已有计价单位及扣费规则不变，不伪造 token 价格。

- 响应 serviceRates?: 数组，元素 `{ unit, price, cost?, hasTimeBands? }`，price/cost 为元/该单位。无服务价返回空数组；旧端口无读取能力时省略。
- 请求 serviceRates?: 1..5 项，同 unit 不重复；unit 仅 search_call / tts_10k_chars / asr_minute / realtime_minute / image；price 非负且不超过100000；cost 可省略或 null，默认为售价。hasTimeBands 只在响应出现。
- 省略数组不改服务价格。提交某单位会替换该模型该单位全部行（包括分时价）为全天价；未提交单位、token 价格、其他模型完整保留。重复提交无变化不发版本。UI 对分时价明确提醒。
- BillingModelRatePort 可选增加 getActiveServiceRates 和 publishModelServiceRates，内部金额为安全整数微元。接口不可用时写请求明确失败，不静默丢弃。
- ModelAdminService 先发布单价再保存目录，沿用 token 写入顺序与失败语义。搜索能力模型可仅凭 search_call 服务价格启用，不要求伪造 token 价格。校验提交单位适配模型能力/场景。
- 公共 PriceUnit schema 移至无模型依赖的 src/price-unit.ts，原 http/billing.ts re-export，避免循环 import。
- token、服务价格、删除模型及高级价目表发布共用事务 advisory 发布锁，包括尚无 active 版本时；复制最新版，避免并发丢价。全部实际发布写审计。

## 影响与边界

影响 contracts、server billing/model-access、后台模型表单（主 agent 实施）。不改质量/status/既有 handoff，不部署、不执行 Gradle/APK；纯生成物由主 agent 统一 generate。DB 本机未启动，真实 DB 测试仅扩展，不得声称通过。保留当前主线已有所有功能。

## 开发自测（2026-10-23 凌晨）

- contracts 与 server typecheck 通过；改动源文件/测试文件定向 ESLint 通过。
- 新增三个单元测试文件共 11 项通过：契约范围/重复/边界/响应标记、模型合并读写顺序/无 token 搜索/成本默认/服务缺失失败、真实服务的微元校验/按单位复制保留/分时覆盖/幂等审计。
- 扩展现有 billing 真实 PostgreSQL 测试两项：按 unit 替换并保留其它价格、分时与审计/幂等；无 active 版本的并发 token+service 发布保留全部价格并让纯搜索模型被识别为有价。DB 未启动，因此这两项未运行，不记为通过。
- 未调用付费供应商；未提交、部署或构建 APK；纯生成物留给整合主 agent。
