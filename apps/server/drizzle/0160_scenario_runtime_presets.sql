-- 可空扩展：原枚举继续承担模型路由和隐私范围，自定义编号只选择额外风格。
ALTER TABLE ai_runtime.companion_settings ADD COLUMN scenario_preset_id text;
ALTER TABLE ai_runtime.group_companion_settings ADD COLUMN scenario_preset_id text;
