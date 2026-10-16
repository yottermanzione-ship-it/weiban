# 生态不足提示一次：供积分分支合入

主会话独立C:\wb-dev\wb-ecology-notice / codex/ecology-insufficient-notice；基线0d8e9ff，任务815ba32，业务WIP6240a0d。不是完整积分交付，不先合主线；原积分代理合入后统一契约3.16与生成Android/最终构建。

- 新鉴权POST `/billing/ecology-insufficient-notice/consume`，从principal取userId，无客户端账户参数。单条条件UPDATE在账号行锁下清pending，条件为user账号+pending=true+since非空，返回一次文案与since；无钱包不创建，余额/冻结不改。使用已有0102字段，不加迁移。
- 网页Shell在资料完成、非引导时挂组件（会话key随账号变化）。启动与focus/visible/online消费；只联网且visible发请求，networkOnly避免POST响应落本地缓存，5秒内前台事件去重。结果再验原owner；未展示即变隐藏时仅暂存在当前组件，回前台再展示，卸载/切账号丢弃。网络错不弹额外错误；StrictMode清理后首轮不消费。
- 至多一次：服务器已清pending但回包丢失/会话更换可漏提醒，按已批工程方案接受；不伪称保证送达。触发不足周期与ecologyTask映射、合法正向入账清周期，由积分分支负责；此处不做全局生态开关或前台积分错误吞掉处理。

开发自查：server/web/contracts typecheck、相关5源文件eslint、depcruise（387模块/1680依赖）、server/web构建通过，web415261、SW16。契约生成通过（仍3.15基线，最终交付必须由积分分支升3.16再生成）。无测试套件、PG、迁移、实际HTTP、多设备或独立验收。

真实浏览器操作实际组件+ToastHost（StrictMode），会话/接口用本地fixture：首次请求一次/提示一次，组件重开后consume无notice且toast事件数不增加；模拟失败不弹错/不耗pending，再开可领；A延迟回包后切B，再送A回包无B提示；B新周期正常提示。6张PNG、请求+toast记录JSON和console在docs/web/ecology-notice-2026-10-16。02截图仍显示首次toast的剩余停留，记录证明没有第二次toast事件；不是重复弹出。控制台可能有开发入口HMR重建root告警，最终reload后的页面完成自查，非产品App启动告警。

恢复：复制同目录两个.fixture.txt到apps/web/notice-preview.html/tsx，Vite5202访问/notice-preview.html。样例不接DB/真实账号、未纳入产品入口；仅这两个自查源文件保持未跟踪。临时浏览器已关闭，5190原样例不改。合并后请重新检查App/服务装配及完整生成，暂不部署。
