# 积分上限组件自查入口（待实际浏览器）

本地真实组件加模拟API；不连接真实钱包、供应商或数据库。入口HTML和TSX经Vite取回200只证明模块可取，不代表GUI通过。子代理IAB实际返回notavailable，由主会话代点；尚无本轮GUI截图。

- 后台：http://127.0.0.1:5193/points-preview.html#/models?tab=models
- 网页：http://127.0.0.1:5193/points-preview.html?web=1#/prices
- Vite进程本轮63641，服务不保证跨会话一直运行；恢复命令在apps/web运行 `pnpm exec vite --config points-preview.config.ts --host 127.0.0.1`。
- 4临时文件为apps/web/points-preview.html、points-preview.tsx、points-preview-api.ts、points-preview.config.ts。只供本地自查，不混入产品入口。
- 独立origin localStorage键weiban:points-preview-20261016，无敏感样例数据。

## 主会话待点步骤

1. 模型列表看到“需配置计费上限”。编辑模型，展开第1条路由计费上限，输入非法JSON保存应在当前表单报错并保留草稿。
2. 页顶折叠区有可复制的格式样例（example.com占位，仅样例，不是供应商证据）。用此格式填入，打开页顶“下一次写入失败”后保存，失败保留JSON与其它草稿；再次保存成功，列表刷新后重开核JSON持久。
3. 改该路由账号或模型名应清空旧证据，取消关闭后重开仍读已保存值；可再新增备用路由并独立配置，核请求routes和primary.billingBounds。
4. 用量概览/调用记录明示已核部分、待核笔数和风险上限；点记录展开看待核风险；旧用量页点“汇总”“明细”也显示待核，风险不并入已核成本。
5. 切网页价格看“标准用量示例”和保守预留解释；到导入确认看“保守预留上限”与说明，保留原文开关可操作，生成按钮模拟积分不足，不发真实模型。
6. 宽窄屏实际滚动和按钮点按；若需要长按，仅检普通文本/输入不产生意外产品菜单，不冒称Safari手势通过。

请求记录面板可读出模拟method/path/body；保存按钮仅更新本地样例。后台上限JSON形状用真实契约校验，保存失败/未来核准日期仍为模拟响应。全套生产CSS分别加载，useRemote相对client别名及build常量已配。

只挂载真实ModelManagementPage、UsagePage、PricesPage和JobStep；未挂整个App/Auth/导入流水/聊天，不声称后台真实保存、价格发布、模型调用、冻结扣费、迁移0101/0102、崩溃并发或压缩语音可用已验。
