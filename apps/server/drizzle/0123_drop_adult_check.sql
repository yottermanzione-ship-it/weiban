-- 10-21 试用反馈第三轮 G1-1（契约 3.25）：私密模式不再调用「成人内容检查」模型，也不再限定走 OpenRouter。
-- 底线（不涉及未成年人、不涉及真人）改由角色资格规则 + 私密模式提示词保证。
-- ① 清掉平台内部模型里的成人内容检查配置；
UPDATE model_access.settings
SET value = jsonb_set(value, '{internal}', (value -> 'internal') - 'adult_check'), updated_at = now()
WHERE key = 'model_uses' AND value ? 'internal' AND (value -> 'internal') ? 'adult_check';
-- ② 旧检查留下的触发证据（加密的聊天片段）不再使用，删除。表结构保留（注销 / 删聊天的清理代码照常）。
DELETE FROM ai_runtime.adult_boundary_states;
