# q-features 组件样例恢复与待验证记录

2026-10-16浏览器宿主不可用。主会话用实际URL创建IAB仍返回notavailable，Codex打开浏览器为queued。**没有GUI截图或通过结论。** 入口HTTP200仅证明Vite静态HTML/模块可取，不是产品API/数据库验证。

当前本地4文件保留在apps/web/q-preview*，Vite端口5190。此目录为同一时刻的可恢复文本快照，扩展名fixture.txt不参与生产编译。先读本说明，再在独立worktree运行本目录restore-preview.ps1（参数Worktree，默认C:\wb-dev\wb-qfeat），之后到apps/web执行命令：

```powershell
pnpm exec vite --config q-preview.config.ts --host 127.0.0.1
```

网页：http://127.0.0.1:5190/q-preview.html#/me/status
后台：http://127.0.0.1:5190/q-preview.html?admin=1#/admin-support

样例只在专用origin的localStorage键weiban:q-preview-20261016保存无敏感虚构数据，没有生产身份、真实工单、钱包或支付。实际API全部由专用模块mock；截图上传XMLHttpRequest未mock，不应以此样例验证上传链。顶部外置请求面板可读出模拟method/path/params/body。网页全套生产CSS与后台自己的生产CSS分开加载，含构建常量及useRemote相对client别名。未挂载整个App/Auth/ChatProvider，整壳和真实登录/同步未验证；App新路由ownHeader仅源码核对。

## 恢复后逐项实际操作（全部待做）

1. 状态：编辑预设/文字/有效期，下一写入失败开关验证草稿，再保存/清除；当前状态首次回填，后台刷新不覆盖草稿。定时/恢复过期逻辑仅源码，真实服务器时区/DST未执行。
2. 帮助反馈：提交、列表、详情、补充；投诉角色顶部专用链接；后台同origin工单可回复、失败保文案、解决/重开。用户详情support事件订阅真实hook，样例发对应事件。图片上传不在此样例验证范围。
3. 商店：免费添加两包、整理上移/移除，切panel看真实StickerPanel已装包；详情静态预览。未停用包安装管理的后端依据仅源码，此样例未模拟停用编辑结果持久化。
4. 插件：微信/QQ/微博三项点击comingsoon提示。
5. 申请：先选顶部场景，输入角色名与可选说明；免费0、PRO+周免费、超额200、提交时报价变化、积分不足、旧编号分别操作。场景下拉改变会重挂申请表单，应先选择再输入。旧编号失败后先点产品“更换新编号”，再点顶部“换编号后允许受理”（仅改变本地受理条件，保留表单），再次明确提交。比较clientRequestId与expectedPointsCost。成功页为明确标注的样例回执，非生产申请详情。
6. 后台会员：未来datetime-local、下一写入失败保留输入、重试、撤销确认；不代表真实会员存储/到期/登录已验证。后台商店元数据表单也可操作，mock保存结果未完整持久化。
7. 标题：真实ChatHeading独立挂载，改标题/备注、typing、群标题、active与显示偏好；Name实际备注解析链和整个聊天未挂载，不可写整chat通过。长按、滑动、窄屏布局、返回都须实际点按后再记。

不得将此样例当真实HTTP、PG、迁移0097~0100、冻结/扣款/退款、会员到期、通知推送、多端同步、Safari真机、模型上下文端到端证据。浏览器恢复后先确认首屏/console，再操作；前端冻结涵盖全部Vite依赖与格式化，直到主会话明确GUI完成。
