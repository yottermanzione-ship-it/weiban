# 玩法独立探针记录

- 固定业务目标 `0bf2434cdc080b9920c27a6db40e0d7b371c7fc1`；专用库 wbqa_probe_20261104，不使用共享库。
- `pnpm exec vitest run --config docs/quality/reproductions/2026-11-04-acceptance/play-probe.config.ts --reporter verbose`
- 最终运行：2026-11-04 17:52:27，北京时间；47.09 秒，3 通过、2 失败、0 跳过，退出 1。两项失败为同一缺陷 Q-031 的普通/健康对照，不能算成两个问题。
- 普通提醒：n=0、health=0、healthSetting=false、consumed=true。
- 健康提醒：n=0、health=0、healthSetting=true、consumed=true。
- 两者原格式发送键均实际被拒绝，合法键的对照发送成功；不是缺少联系人、数据库或模型配置的准备失败。扫描后已处理状态推进但无目标消息。
- 通过：专注重试/账号隔离/到点结束；健康授权和数据清理；宠物重试与每日加分上限。宠物图鉴为直接写入独立库的合成测试材料，图片不存在且使用产品兜底链接，不把图片功能记为通过。
- 准备纠错：授权字段是 authorizedCharacterIds；消息键列是 client_msg_id；PetDetail 本身带 petId。已纠正 QA 脚本后重跑，不登记这些为产品故障。
- 后续质量脚本整理仅补类型、去除多余初始化、格式化，不修改测试断言或业务代码。报告辅助纳入独立 ESLint 检查；业务基线检查另隔离本轮 QA 脚本。
