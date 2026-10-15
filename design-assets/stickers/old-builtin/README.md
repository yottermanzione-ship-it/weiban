# 旧版基础表情素材与导入（A4 配套）

本目录含旧版微伴 16 张基础 SVG，逐项定义来源为旧项目 `server/lib/chat/sticker_catalog.js` 的 `SVG_STICKERS` / `faceSvg()`，原文件来源 `server/public/stickers/builtin/`。它们是旧项目代码生成的几何表情，没有真人肖像。清单含含义、文件名与规范 LF 文本的 SHA-256。

未发现旧项目单独 LICENSE 文件，因此不据此宣称外部素材有统一授权。本批只迁入上述项目代码生成的 SVG，不迁入目录中的 Operit / ChineseBQB 等外部梗图包；那些素材的许可/肖像来源须另核实。

## 当前状态

素材和导入程序已准备，离线校验/PNG 转换实际通过；尚未上传香港或写库。页面继续用新版素材库和我的表情持久接口，默认选已导入的「微伴预设表情」包。没有伪造生产 stickerId/mediaId，也没有把静态素材当成可收藏的表情记录。

## 离线预览

在仓库根目录，使用项目已配置 Node/pnpm 环境：

```powershell
pnpm --filter @weiban/web exec node scripts/import-old-stickers.mjs
```

不带 `--apply` 只读取清单、检查 SHA-256、将 SVG 转成 PNG，完全不请求服务器，也不需要令牌。SVG 按 LF 规范计算摘要，Windows/Linux 检出换行不会误报；上传 PNG 是为了符合现有媒体类型要求。

## 香港导入（待主负责人安排）

1. 按 `docs/ops/hk-server.md` 完成香港数据库与对象文件备份，确认恢复路径；本批没有执行备份/上传。
2. 用已有部署 SSH 密钥建立后台隧道（本地 9081 → 香港 127.0.0.1:8081）。
3. 在进程环境设置 `WEIBAN_STICKER_API_URL=http://127.0.0.1:9081` 和已有管理员会话 `WEIBAN_ADMIN_TOKEN`。不要新建账号、不要写进命令历史/仓库、不要打印令牌。
4. 在仓库根执行下面一条；使用同一 journal 文件续跑，不要多机或并行运行：

```powershell
pnpm --filter @weiban/web exec node scripts/import-old-stickers.mjs --apply --journal C:/wb-dev/wb-a4-ui/.data/old-stickers-hk.json
```

5. 完成后移除进程里的管理员令牌环境变量，并通过后台/用户页查看表情包，实际发一张、收藏/重进核查持久性。该真实导入验证属于后续导入/部署阶段。

复用现有管理员 API：GET/POST `/api/v1/admin/stickers/packs`，POST `/api/v1/admin/media?purpose=sticker_library`，POST `/api/v1/admin/stickers/packs/{packId}/stickers`。只使用 API 返回的真实 UUID；包名存在就复用，同含义条目已存在就跳过。已经上传但未加进包的媒体 UUID 按素材摘要存到本地 journal，失败后续跑复用，journal 原子落盘、绑定服务器 origin 和 packId，换服务器需用新 journal。上传响应丢失可能留下未被登记的孤立媒体，脚本不会擅自删除它；表情创建响应丢失时重跑可由同含义条目识别跳过。

脚本输出只有校验数量、进度和 HTTP 状态；不输出会话、响应正文或签名 URL。默认 journal 在已忽略的 `.data/` 下；自定义路径也应放生成物目录，不提交仓库。
