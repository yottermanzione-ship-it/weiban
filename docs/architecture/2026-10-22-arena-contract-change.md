# Arena / 自主图片契约配套变更申请与实施记录

依据总经理 2026-10-22 恢复实施及本轮任务卡，采用现有榜单接口的兼容扩展，不新增第三方前端直连、不引入完整 Arena 模型目录。

- ModelLeaderboardInfo 增可选 fetchedAt、method、lastError；source.asOf 只表示官方发布日期，不再使用抓取日期。
- ModelInfo 增可选 leaderboardChange（与上份有效快照、按当前可见模型集合比较；正数为上升；无可比数据为 null）。
- LeaderboardSnapshotStatus.snapshot 增可选 publishedAt、sourceUrl、totalRows，区分官方来源、发布日期与抓取时间。原始评分、厂商、票数和区间存现有 settings 快照，不作为模型目录导入。
- image_generation 枚举及上游能力保留兼容；不再是用户可配置场景，旧配置不再用于角色发图。网页、后台推荐入口配套移除。用户上传图片 vision 能力和 P3 公开作品检索保持原链路。
- 自主找图复用已有安全预览转存设施，所需端口窄扩展由图片链路补丁登记；不调用生图，也不产生生图费用。

本文件为本轮已授权需求的窄契约申请及实现说明；不是独立验收。涉及字段均兼容旧客户端，后端和网页/管理端一起验证。
