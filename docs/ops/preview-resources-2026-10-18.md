# 2026-10-18 预览资源接入记录

范围：C10 授权的本机 5173/3000 + 香港独立临时库 DR-001。现网旧版 152.136.111.51 只读查询；香港重构生产库未写入、未迁移、未部署。记录属于开发自测。

## 现网只读核实

- 真实在用旧版的 Bai 提供商为 `https://api.b.ai/v1`，配置模型 `mimo-v2.6-flash`。不是 api.abliteration.ai。
- SQLite 只读聚合：source=upload 173 张、27 个上传用户，27 张公开；source=library 120 条。不能将总 293 条收藏记录说成上传量，不能把香港新环境的零记录说成现网无人上传。
- 只复用 Bai 必需连接配置和旧版内置 SVG 素材。不复制真实用户聊天、私有上传、声音克隆数据。

## 已完成的预览数据

- 写入前临时库备份：`/srv/weiban/dryrun-backups/ui-preview-before-seed-20261018-223128.dump`（624KB，0600）。
- 既有管理员账号：6 张默认内置表情、3 张个人表情、商店「旧版精选表情」3 张。素材为旧版 smile/laugh/cry/angry/heart/hug SVG，经 sharp 转为 PNG，通过既有上传/素材接口入库。
- 原创预设程澈、温言、苏乔走申请接口添加；到达 accept_after 后以 background=false 的单次应用上下文调用既有 ContactsCommands.accept，三个均 active。未启动全量后台调度。
- 浏览器实操：个人表情加载/查看/关闭/整理选择/移到最前/完成；商店列表封面、数量和已添加标记；包详情查看/ESC 关闭/免费添加后变为「移除表情包」。没有删除用户素材。
- 本机 SSH 隧道数据库偶发连接池连接超时，个人表情一次 500，重试后恢复。不能把本轮重试成功记为连接稳定性通过。

## Bai：连接配置已录入，真实生成未通过

- 本机安全文件位于 `C:/wb-dev/secrets/`，连接与幂等资源清单均在仓库外；未在仓库保存密钥或会话 token。
- Bai GET /models 200，包含当前配置模型；DR-001 上游「Bai-预览」并发 1、每分钟 6 次。
- 模型键 `preview/bai-mimo-flash`，只配置 chat 默认，不设置生态/规划/识图等后台默认。供应商上限依据 https://docs.b.ai/llmservice/models/mimo-v2.6-flash/ 与 https://docs.b.ai/llmservice/api/；本机保守限制输出 2048、图片 0。
- 临时库原无价目表，启用模型必须有价格；为保留既有冻结/结算路径，登记了仅用于预览验证的名义倍率：输入 1.12、缓存 0.0224、输出 2.24 元/百万 token，销售与成本列相同。数值是官方标准美元参考价乘固定测试系数 8，并非汇率、账号实际成本、产品定价或会员决定；不复制到生产。未给真实用户发余额、未收用户费用。
- 只通过既有模型网关进行 admin_upstream_test / platform 调用。首个真实请求 network_error（约26秒），未获得供应商用量；现有保护机制将路由标记 pauseReason=usage_unknown。第二个幂等键请求被保护拒绝，未新增供应商 attempt。未绕过暂停、未直连补发生成请求；需要后续先核对供应商用量，再通过正常管理流程恢复。
- 当前 APP_ROLE=web 不消费日常回复队列，角色接入不代表自动聊天已完成。真实生成、聊天队列消费与聊天气泡 UI 仍待验证。

## 本机操作资料

仓库外操作脚本：`C:/wb-dev/scripts/weiban-ui-resources-20261018.mjs`、`preview-model-config.mjs`、`preview-gateway-probe-20261018.ts`（后者需在 server 包内解析依赖）。资源清单以 `preview-resource-manifest-20261018.json` 为准；其中角色 pending 是最初申请时快照，最终以服务查询和本记录 active 为准。
