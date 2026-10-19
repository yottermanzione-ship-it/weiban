-- 角色生态 v1 平台参数（决策模型、四档次数、关掉的动作、唤醒时段）；只有一行 id = 'default'。
CREATE TABLE ai_runtime.ecology_config (
  id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL
);
-- 官方角色公共朋友圈（16 号 §4）：每角色每天生成一份，所有用户共用，平台承担。
CREATE TABLE ai_runtime.public_moment_drafts (
  character_id uuid NOT NULL,
  local_date text NOT NULL,
  status text NOT NULL,
  text text,
  source_kind text,
  source_id text,
  charged_micros bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (character_id, local_date)
);
