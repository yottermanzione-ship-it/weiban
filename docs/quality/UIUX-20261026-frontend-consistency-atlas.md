# 用户端UI一致性分类图册

本轮按用户反馈纠偏：只看用户端菜单、输入、确定/保存/删除按钮；不是后台规范审计，不改业务代码。

- [直接浏览图册](<C:/wb-dev/logs/uiux-consistency-20261026/用户端UI分类图册.html>)：3大类18种现有样式，红框注释，同类对照，调用页可展开。
- 明确差异：同是删除确认，删除聊天红字、删除补充设定蓝字、清空经期使用页面内确认块；同为设置单选，底部列表与原生select并存；单字段编辑分EditPage与FormPage两套。
- 当前ClearInput已被昵称/备注/生日复用，SearchField也有公共实现，不能把所有差异都说成随机缺陷；图册区分已明确不一致与需约定的合理分型。
- [组件调用图](<C:/wb-dev/logs/uiux-consistency-20261026/component-map.json>)：122个源文件中594处原生input/textarea/select/button静态点位，14种重点组件按函数/别名/路由追踪；不是594个缺陷。
- [图证与注释坐标](<C:/wb-dev/logs/uiux-consistency-20261026/atlas-evidence.json>)，本轮13个真实界面状态补拍，旧图有相同源指纹支撑；[只读核对](<C:/wb-dev/logs/uiux-consistency-20261026/source-integrity.json>)变化0。
- 不改业务代码、不提交、不推送、不发布，不执行新设计/组件改造；原生安卓不在本轮截图范围。
