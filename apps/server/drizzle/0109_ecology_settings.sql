-- 角色生态 v1（17 号 §1、§2）：用户级总开关 / 活跃程度 / 关掉的动作；每个角色一个开关（没有行 = 开）。
CREATE TABLE ai_runtime.ecology_settings (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  activity_level text NOT NULL DEFAULT 'often',
  disabled_actions text[] NOT NULL DEFAULT '{}',
  intro_seen boolean NOT NULL DEFAULT false,
  -- 积分不足静默暂停（16 号 §8）；充值后清空。
  paused_reason text,
  paused_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT ecology_settings_level_check CHECK (activity_level IN ('occasional', 'often', 'close', 'inseparable'))
);
CREATE INDEX ecology_settings_enabled_idx ON ai_runtime.ecology_settings (user_id) WHERE enabled;
CREATE TABLE ai_runtime.ecology_character_settings (
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, character_id)
);
