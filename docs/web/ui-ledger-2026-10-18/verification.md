# UI逐条证据索引（2026-10-18核查版）

本文件替换基线旧“已确认落地”清单。旧稿仍可从Git基线2e92c92查看；其中先前agent的截图02/06/09/10/11、地区/头像/加载占位等声明未由本轮重新点按，不再当通过记录。

唯一逐ID账本为[ledger.json](ledger.json)，185需动作映射见[evidence-map.json](evidence-map.json)，可筛选页面为[index.html](index.html)。核查结论、统计差异与优先级见[audit.md](audit.md)。不要同时维护另一套“完成数”。

## 字段的严格含义

| 字段/状态 | 含义 |
| --- | --- |
| sourceRow / originalMap | 08号2026-10-14原稿，保留状态/备注/来源/skin/kernel等全部字段；不表示今天的实现 |
| annotation | 总经理原文决定，逐行或导出总说明继承均给出处；未单列记录保留directVerdict=未批注 |
| planReferences | 11号A排期、历史B讨论引用；已排入A不等于实施或验收 |
| productDecision | C1已定方向及C9冻结/未定细节；不将全部B重新当未拍板 |
| 未核 | 没有逐行实施证据，或仅有候选资料尚不足以核对 |
| 源码已核待点按 | 本轮读过指定片段，只能证明该窄范围源码事实 |
| 历史截图待复点 | 交接已指向旧样例/图片，本轮未逐张复看，也未重走界面 |
| 后端冻结 | 需求方向可已定，内核/真实能力按C9暂缓；不说明UI已完成 |
| 产品待定 | 指明尚未定的字段/动作等细节，不泛指所有B项 |

## 已核窄范围及边界

- chat-heading.tsx：CharacterStatus挂在标题，typing分支只有真实typing副标题；不等于状态接口/情景模型实测。
- chat.tsx：语音菜单有既有原文转文字，10号后文已推翻旧不要；不新增ASR能力。
- chat-settings.tsx：muted/pinned按键busy；关系表单、旧TA的日常仍在；不等于本轮点按稳定或成长系统完成。
- ecology.tsx：本机localStorage、硬编码动作记录、样例费用，页尾明确是预览。/models链接终点和声明的生态选择不一致，属纯UI下一步。
- scenario.tsx与models.tsx：私密模型缺失去/models，但页中只提供chat选择，属引导终点不匹配。
- A4/A7/A9等历史交接仅作为指定ID证据入口，实际后端/模型/Safari等限制原样保留；未凭目录存在、grep命中或task排期销账。

## 本轮检查

仅生成器Node语法、HTML内嵌JS语法、401原始行完整性、185动作ID集合、引用文件/片段和可复现生成核对。具体命令与退出状态登记audit.md末尾；没有写跑产品测试套件、没有GUI点按或截图、没有修改app/server/contracts。
