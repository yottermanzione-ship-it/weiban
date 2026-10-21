-- 10-21 试用反馈第四轮 H1-1（契约 3.27）：删除「关系类型」选择，恋爱表达只随好感度阶段解锁。
-- ① 手选的「情侣暧昧」情景预设不再提供：私聊改为「自动」（TA 按好感度阶段与当下状态调整），群聊改为「日常聊天」。
-- ② contacts.contacts.relationship_type 列保留（不再读写），以便回滚。
UPDATE ai_runtime.companion_settings SET scenario_mode = 'auto', updated_at = now() WHERE scenario_mode = 'romance';
UPDATE ai_runtime.group_companion_settings SET scenario_mode = 'daily', updated_at = now() WHERE scenario_mode = 'romance';
