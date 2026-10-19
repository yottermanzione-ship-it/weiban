-- 角色生态 v1：每次「醒来想一想」一行（运行记录 + 碎碎念）。碎碎念按用户密钥加密（ADR-0027），管理端看不到。
CREATE TABLE ai_runtime.ecology_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  origin text NOT NULL,
  -- 去重键：生态 = slot:{当地日期}:{序号}；用户要求 = req:{触发消息ID}:{动作}。
  run_key text NOT NULL,
  local_date text NOT NULL,
  status text NOT NULL,
  action_key text,
  action_summary text,
  outcome text,
  model_key text,
  charged_micros bigint NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  murmur_ciphertext bytea,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT ecology_runs_origin_check CHECK (origin IN ('ecology', 'user_request')),
  CONSTRAINT ecology_runs_key UNIQUE (user_id, character_id, run_key)
);
CREATE INDEX ecology_runs_pair_idx ON ai_runtime.ecology_runs (user_id, character_id, created_at DESC);
CREATE INDEX ecology_runs_created_idx ON ai_runtime.ecology_runs (created_at DESC);
CREATE INDEX ecology_runs_due_idx ON ai_runtime.ecology_runs (scheduled_at) WHERE status = 'scheduled';
-- 角色在生态里更新的状态 / 个性签名（只对该用户可见）。
CREATE TABLE ai_runtime.ecology_profiles (
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  status_text text,
  status_updated_at timestamptz,
  signature text,
  signature_updated_at timestamptz,
  PRIMARY KEY (user_id, character_id)
);
