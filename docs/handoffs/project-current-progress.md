# 微伴当前进度

更新：2026-10-12 18:10。快速状态以本文为准，详细历史证据见 T-102、T-103 和活动交接。

| 项目 | 当前状态 |
|---|---|
| 本机运行 | http://localhost:8080 用户端；http://localhost:8081 管理后台；新版双端登录/刷新/健康通过 |
| 已部署业务 | a5c41cc09aaff01fa1f108fc36ae066dd27572f3；部署源码2271bd2d607bcb132932c27a557fe413e66bc7d3，含成人检查及首次配置后恢复 |
| AI接入 | 15:43实际上游0条；后台URL/密码字段/价格/目录及成人内容检查复选框可用，用户自行填写 |
| 完整PR CI | 38217389396：check成功，87文件665项、网页27/后台8及生产加密恢复通过；安卓失败 |
| 同源push CI | 38217385274：安卓成功；网页头像主题颜色失败（26通过/1失败），并非全轮通过 |
| Windows全量 | 87文件665项中664通过/1失败；推送回执2002ms超2000ms目标2ms，未放宽目标 |
| 当前开发 | 安卓完整聊天24项/ktlint/detekt通过；头像真实保存主题1项通过；推送5项通过、1975ms；间歇性及时延稳定性未关闭 |

全部为开发自测；项目尚未完成，不等同于独立验收。

## 可恢复断点

- 副本 C:\wb-dev\codex-closeout，分支 codex/product-closeout。上一检查点2271bd2d607bcb132932c27a557fe413e66bc7d3；本轮仅三项测试fixture与部署/交接文档修正，业务仍a5c41cc。共享main未修改。最新提交SHA通过git及PR19确认，不能把旧CI当新提交完整通过。
- 首次设置/替换检查默认模型发布事务内 adult_checker_configured 事件，真实事件分发入队恢复任务；同一等待回复计划保留ID并递增retryEpoch。缺配置不发送未经检查内容。专用复核删除safetyPriority，不能继承关怀透支；原白名单保留。最新665项CI覆盖正确空capabilities夹具和新断言。
- 本机镜像 app sha256:1c857b35e6e9a193698636363eb74cbf8bf0cef116aaf68fd1e6c707db52ac93；edge sha256:bd3b11eb5de19fcf0425b9ea848a447b87aa079acb76fb3de174e388bc0410c7。版本记录 C:\wb-local\deployment-version.txt；旧版本另存deployment-history。升级前加密备份20261012-151746-ccbf4979079540299ae212cf8b58d8bd。
- 升级证据 adult-checker-local-upgrade-round1.log、adult-checker-local-login-round1.log、adult-checker-local-config-round1.log，位于 C:\wb-dev\closeout-logs。原账号、卷、密钥保留；未创建模型/供应商、未调用真实AI。
- Windows完整回归已终态1447.32s，失败是回执耗时断言，非未收到回执；同断言被waitFor重复等待至超时。Linux CI同用例通过；仍保留本机失败，不算满足全部时延验收。
- 安卓PR失败XML证实列表宽320/高78、有下一页按钮且请求2条，但无角色子节点，先前补宽不能算全部关闭。另有旧19c联系人打开超时；两类原因仍待验证。当前cleanup修正只是消除代码中确定的关闭顺序/协程生命周期风险，不提前归因为全部超时根因。
- role-fixture-lifetime-round1 因缺空行ktlint失败，未执行测试。round2真实终态成功2m4；fresh XML 4项零失败/错误/跳过，30.54s。网页profile-theme-persist-round1实际1项通过7.2s/整轮1.6m，仍核对精确颜色/64px尺寸/圆角。两句柄均已结束，不复用。
- role-fixture-lifetime-full-round1实际BUILD SUCCESSFUL 2m9，完整聊天8套24项零失败/错误/跳过，ktlint/detekt通过；fresh XML已复制到同名-xml目录。不是全安卓126项或真机验证。句柄57744已结束。
- 推送诊断改动不放宽2000ms或取消厂商HTTP/重复发送断言，只将已落库且不会变化的回执时延移出waitFor，避免固定数值失败被伪装成等待超时。push-latency-diagnostic-round1实际5项通过20.22s；直接读取本条回执为1975ms，仅剩25ms余量，保留此前2002ms失败和时延稳定性待验，不能凭这次通过关闭。服务端类型及改动eslint/格式通过。句柄34967已结束。
- 无存活测试句柄。下一步推送本轮提交并观察新CI；进一步核查冷启动时延预算与安卓间歇性，补成人群聊/主动/通话的真实边界专项，再推进完整评测材料/执行路径。不要因单轮绿色反复重跑无变化全量，使用具体失败及变更范围决定检查。

仍待完成：上述回归失败定位；群聊/主动/成人通话专项；完整19类AI材料、执行器与真实模型质量/费用；安卓真机及厂商推送；异机离线密钥保管；另一位审查者独立验收。现有287题/18套和模拟判分不证明这些事项完成。
