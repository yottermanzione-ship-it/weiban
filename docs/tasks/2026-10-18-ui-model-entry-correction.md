# UI模型入口纠偏

负责人：chat_forward串行续接；新独立副本C:\wb-dev\wb-ui-model-entry-1018，分支codex/ui-model-entry-1018，从local/trunk创建。不得再派子代理。

先读CLAUDE.md、docs/handoffs/2026-10-18-codex-resumption-audit.md、11号C9、docs/web/ui-ledger-2026-10-18/audit.md。最新约束：全站UI优先，后端与会员冻结。

已核实两个入口错误：ecology.tsx生态模型行和scenario.tsx私密模型未配置弹窗均指向/models，但models.tsx只保存chat选择且排除adult模型。此任务只消除误导，不实现生态/私密模型选择或任何模型权限。

1. 先读实际代码确认触发路径，保留已有有效聊天模型选择及既有私密安全检查。
2. 生态模型行改成准确的预览/未接通状态，移除会修改聊天模型的跳转；私密模型缺失提示取消“去选择”聊天模型的错误指引，给准确可理解说明。采用项目已有组件，不造费率或会员权益，不引入接口、后端或本机配置新业务逻辑。
3. 范围限两个页面及最小必要样式/交接文档。不整页重做，不改旧预览HTML作为替代。先提交WIP，再完成提交。
4. 不写/跑测试套件，跑web typecheck、对应文件lint和build。涉及点击必须CUA实际点按；目前浏览器连接不可用，若仍不可用明确登记GUI待核，不声称验收通过。不能用伪造浏览器结果或隐藏调用后端替代。
5. 交付完整SHA、diff范围、命令结果、GUI证据或准确环境阻塞、任务交接。未经PM复核不自行合并；缺GUI时先保留分支待核。

## 当前交付

最终e5adbecfd4cc264bf2cffd563e9c3e443263aed6已收，副本干净。PM已读业务diff与交接，代理报告web typecheck、两文件eslint、web build均exit 0。CUA浏览器库存仍空，GUI待核，分支未合入主线；恢复步骤见该分支docs/handoffs/2026-10-18-ui-model-entry-correction.md。后续合入同时更新台账旧源码引用，不将入口修正冒称模型能力实现或独立验收。
