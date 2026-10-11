# AI评测集：考题登记与结果汇总

`src/registry.ts`登记当前84题：L2记忆/人设42题、L3推演14题、L3主动6题、L4群聊5题、L4社交6题、L6宠物4题、L7玩法7题。初版T-043的37题与T-046新增5题都保留。统一入口`EVAL_SUITES`和`EVAL_CASES`，考题版本`EVAL_CASE_VERSION`，引用`docs/ai/eval-plan.md`。这仍未覆盖完整19类评测集，不能拿题量或工程测试宣称人设质量通过。

角色登记`EVAL_CHARACTERS`：S-01～S-06引用已有原创成年样本卡；R-01明确对应评测计划中的虚构示例明星“林夏予”，仅假设按真人celebrity规则分类，不代表现实人物。C-01为儿童边界对照“罗小黑”，已有`child`编号兼容映射到C-01。全部角色仅用于评测，禁止上架；未知编号返回undefined，不能默认成S-01。R-01/C-01的完整受控卡片、真人样本来源及运行时UUID仍须由实际评测准备，登记编号不代表已有发布通过的预设。

`src/index.ts` 只核对固定包含/禁止内容；缺独立评审人及1～5分评审证据时返回 `needs_review`，有规则失败时始终失败。≥4分仅是单题判分，完整发布门槛还要按eval-plan分组汇总、硬边界100%、人工抽查与供应商执行记录。真实模型调用由服务器通过ModelGatewayPort完成，不在这个包加入SDK、密钥或计费出口。

`summarizeEvalRun`汇总全部登记题，记录`caseId/caseVersion/evalCharacterId/characterId/personaVersion/modelKey/promptTemplateVersion/outputEvidenceRef/output/judge`。重复或未知题判失败；漏题、缺版本/角色匹配/输出依据/评审记待评审；规则失败优先，硬题失败单独列出。仅全部登记题有合格依据时返回`passed_registered_cases`，scope固定为`registered_cases_only`，不返回产品发布许可。汇总器不核实外部证据文件真伪或评审身份，实际运行仍须保存并由独立审查者检查原始输出与身份。

`pnpm test` 已纳入规则检查运行器的工程回归。当前未运行真实供应商、盲评或1000轮质量测试。判卷记录必须保存角色/personaVersion、模型键、promptTemplateVersion、考题版本、评审身份和输出证据；不得将固定假上游回答当作独立质量结论。

`test/registry.test.ts`中“全部登记题通过”的输出和身份全部为显式fixture，仅验证汇总器状态分支，不是模型评测结果。真实安全关怀、真人/儿童/成人硬边界、媒体/语音、行为规划盲评以及剩余eval-plan分组门槛尚须完整执行。
