# T-038 好友申请、通讯录与删除恢复

Codex；2026-10-06；状态开发自测完成，发布后远端CI待核验。持续开发授权，活动分支dev/codex-product-continuation，main只读。

依据D-L1-03、CHR-01～06/GRW-01、P26/P30、ADR0004/0005，contracts contacts/characters/chat/identity/media/events/sync。

实现：独立contacts schema；P26计入pending+active的50角色上限，3～30秒持久延迟任务与过期保留任务；本人加密打招呼、当地日期/默认关系、备注/本人头像/称呼、同事务建聊天与系统提示/同步、软删除30天与恢复/重新认识/立即清除，真实联系人接入角色广场added及下架可见性。角色与contact通过组合根装配，避免构造循环，contacts读端不依赖characters。

配套申请依据：总经理持续授权含契约配套，CharacterReadPort新增canAdd(userId,characterId,tx?)，仅内部可用性检查，不查询他模块schema；characters在调用方事务锁自己角色行，避免待接受角色下架与建聊天交错。网络契约2.1不变。

验收：实际PG/Nest/持久队列；边界3/30秒、并发50上限、重复/迟到任务、软删恢复不丢历史、fresh/过期清空、用户隔离/媒体归属/账号删除、角色added与下架可见性、完整更新与无正文事件；整仓和浏览器/生产/远端CI。AI首句在下一T039订阅accepted事件生成，T038不伪装模型已调用或完整产品已完成。

前轮T037本机8e324b72f597bed571677181cc3eeb89ebef5c2d，远端9d129d42ad02667607a7ec198ab11b6ac406f6a6，tree均d84ee67563dd9cbcf6ed0fd41ac3d0a9bcf91ccd；本机362测试/5+6浏览器/11迁移生产恢复通过，push37453560145及PR37453566816均success，已读取。不是独立QA。

运行结果：9条好友实际PG/HTTP与1条独立worker/真实pg-boss队列测试通过；申请web应用关闭后worker自动接受，实际耗时满足P30范围，系统消息与新会话一起提交。头像归属/用途/恢复默认、第一条角色消息后清除加密问候已执行。整仓、生产和浏览器回归进行中，不把专项结果当作整仓通过。恢复会话切回normal，保留旧adult历史，防止重加时自动进入成人情景。

整仓36文件372测试、零跳过，格式/lint/146模块504依赖无循环/全仓类型/tokens通过；网页5组及后台6组浏览器通过，Kotlin/图标/tokens生成无差异。生产首轮初始服务正常，临时恢复Postgres不健康，尚不计完整通过。连续COPY全部源码再安装依赖造成每次文档/代码变动重装；Dockerfile把8个工作区package清单和锁文件置于独立安装层，随后复制源码，避免重复大层。部署演练失败时先取临时Postgres末80行诊断再删除仅本次项目，仍不输出秘密文件/环境。仅清理5个明确属于T037的旧BuildKit记录，保留数据库及当前镜像；新Dockerfile完整部署演练复跑中。

最后复查P30批量吞吐：默认单消费者每2秒一项不能覆盖50个并发申请。平台JobQueue.work增加有范围校验的单队列轮询/并发选项，其他队列默认不变；contacts接受用0.5秒/4消费者。真实PG四任务同时消费与非法参数测试，以及跨应用持久接受专项共6项通过。再次整仓与生产验证，不沿用修改前结果。Docker依赖安装层已独立；上轮实际耗尽磁盘、创建migrate容器失败，不计通过；仅再清理9个本项目前轮与3个过期构建记录，保留依赖缓存/镜像/数据库。

最终代码重新执行：pnpm check 36文件374测试、零跳过，格式/lint/边界/全仓类型/tokens通过；网页5组、后台6组浏览器及生成检查通过。生产最终演练12项迁移、双域静态页/安全头、健康、age加密备份/空卷恢复、5.000001元余额与加密媒体、非空目标拒绝全部通过。日志分别weiban-t038-root-verified.log、weiban-t038-web-browser.log、weiban-t038-admin-browser.log、weiban-t038-generated.log、weiban-t038-deploy-verified.log（本机/tmp）。新增9条好友、1条跨应用接受和2条队列选项测试；开发自测，不是独立QA。接续T039 AI，不修改main或合并PR。
