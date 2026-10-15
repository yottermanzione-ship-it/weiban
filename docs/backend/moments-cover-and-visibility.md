# A8 朋友圈封面与角色可见性（3.13）

任务卡授权最小扩展。Profile 新增可选 `momentsCoverMediaId?: UUID | null`，PATCH profile 可传该字段，null 恢复默认。0095 在 identity.profiles 增可空列；新私有上传用途 moments_cover。绑定在既有 profile 行锁内校验本人 ready/用途，替换或恢复后仅删除已无该封面引用的旧媒体（专用用途不能绑定为头像/动态）；沿 media.deleteObject(tx) 提交后物理删除及失败重试、注销 ownerId 清理。沿 identity.profile_updated/settings.updated 同步，网页重新拉真实资料。旧响应缺字段仍默认渐变，角色未设封面保留默认，不生成图片。

新增内部 MomentsReadPort.getPostVisibleToCharacter，复用现有 characterAccess 的本人动态/active联系人/selected检查，在同一事务锁动态并组装DTO；不把owner视角正文先交AI再检查。runReact先用此入口，模型调用前再核当前可见性与replyTarget仍存在；最终writer保留同一校验。post_created 的 visibleCharacterIds 明确空就无人，不回退全部角色。selected发布契约最少1人，但旧事件/删除联系人等边界仍不能用空推断公开。无需新权限模型。

本批不增加模型调用，不实现全局生态开关/新模型档位/积分冻结；这些沿后续统一后端批次。Git合入不改数据库；部署到数据库环境时先备份再执行0095，q-features下一迁移从0096继续。
