# 旧服务器真实盘点与迁移批准清单（2026-10-23）

> 本页只读采集自旧服务器现有数据库，**未读取任何 API Key、备注、私聊或声音绑定**，未修改旧机任何文件/权限/服务。这是「盘点」，不是已经迁移。

## 1. 旧机环境预检（只读）

| 项目 | 实际情况 | 结论 |
|---|---|---|
| 登录 | `ubuntu` + 既有私钥（`root` 直登被拒） | 可用；后续执行须保持只读边界 |
| Node | v22.22.3 | 可跑导出器；`node:sqlite` 存在但为实验特性 |
| better-sqlite3 | `/opt/weiban-server/node_modules/better-sqlite3` 存在 | **优先用它**，不依赖实验 API、不安装任何依赖 |
| OpenSSL | 3.0.13 | 支持所需的 CMS 认证加密 |
| 数据库 | `/opt/weiban-server/weiban.db`，约 1.69 GB，**权限 0666** | 只读打开可行；0666 属旧机既有安全问题，本批**未擅自修改**，建议由账号持有人另行收紧 |

导出器已用**标准输入方式**在旧机实际跑通 `--dry-run`（不落脚本文件）：结果为 `providers=8, endpoints=24, secretsRead=false, databaseReadOnly=true`，且表结构与导出器契约逐列吻合（不一致会直接拒绝，不会降级成 `SELECT *`）。

## 2. 非秘密元数据盘点

- 供应商 8 个，**全部为启用状态**：MiMo 1、OpenAI 兼容 3、通义百炼 3、硅基流动 1。
- 端点 24 个，`provider_id` 全部有效（0 个孤立端点）：文字 10 启用 / 2 停用；识图 1 停用；语音转写 2 启用 / 1 停用；声线克隆 2 启用 / 1 停用；实时通话 1 启用 / 3 停用；语音合成 1 启用。另有 6 个端点声明 `vision_direct`。
- 涉及的接口主机（私有工作区域名已打码，完整值只在受控运维渠道提供）：
  - 官方：`api.xiaomimimo.com`、`dashscope.aliyuncs.com`、`api.siliconflow.cn`、`openrouter.ai`
  - 两个百炼私有工作区：`ws-****.cn-beijing.maas.aliyuncs.com`
  - 两个来源不明的第三方中转：`api.b.ai`、`la-api.****.top`

## 3. 真实模型名（用于核对协议，不代表已授权可用）

- 文字：`mimo-v2.6-flash`、`mimo-v2.5`、`deepseek-v4.1-flash`、`gpt-6-luna`、`stealth/union-alpha` 以及若干 OpenRouter 免费模型（`z-ai/glm-5.2:free`、`nvidia/nemotron-*` 等）。
- 语音：`mimo-v2.5`、`mimo-v2.5-asr`、`mimo-v2.5-tts`、`mimo-v2.5-tts-voiceclone`、`FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR`、`qwen-audio-3.0-tts-plus`、`qwen-audio-3.0-tts-flash`、`qwen-audio-3.0-realtime-plus`、`qwen3.5-omni-plus-realtime`、`qwen3-omni-flash-realtime`。

## 4. 建议的批准清单（需总经理确认后才做真实导出）

**建议第一批迁入（一律停用待核，仅账号与最小模型元数据）**

1. `api.xiaomimimo.com`（MiMo）
2. `dashscope.aliyuncs.com`（通义百炼，官方地址）
3. `api.siliconflow.cn`（硅基流动）
4. `openrouter.ai`（聚合平台）

**建议暂不迁**

- 两个 `ws-****.maas.aliyuncs.com` 私有工作区：属工作区专属配置，需先确认归属与是否仍在使用。
- `api.b.ai`、`la-api.****.top`：来源/运营方不明，且与旧项目自建中转有关，先核实再定。
- **声线克隆相关端点**：即使账号可迁，克隆凭据与 753 条旧音色绑定**默认不迁**；本人声音授权缺失时不得开通克隆。
- `qwen-audio-3.0-tts-flash`：新平台规则已把它列为退役模型，不能原样导入；需换成仍在售的型号。
- `gpt-6-luna`、`stealth/union-alpha` 等无法从旧项目源码确认协议/计费口径的模型：只登记为待核，不设默认、不定价。

## 5. 真实迁移前仍缺的条件

1. 总经理确认第 4 节的批准范围（尤其两个中转站的取舍）。
2. 在新服务器执行一次接收方 `prepare`：需要正常管理员身份 + 这次实际加密备份的回执标识，随后把**公开证书**交到旧机（交接方式仍待审定，不擅自扩大旧业务目录写权限）。
3. 真实导出→密文 SHA 核对→`plan` 干跑→`apply` 停用入库，再逐项做协议、计费与系统音色验证；克隆、真人声音继续排除。
4. 价格/余额/默认模型/用户选择一律不迁；旧 0666 权限问题另行处理。
