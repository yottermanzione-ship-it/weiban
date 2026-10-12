CREATE TABLE ai_runtime.quirk_actions (
  plan_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  local_date text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('read_delay','shy_typing','recall','typo')),
  respond_at timestamptz NOT NULL,
  typing_cycles integer NOT NULL CHECK (typing_cycles BETWEEN 0 AND 2),
  typing_consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  CHECK (local_date ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE INDEX quirk_actions_owner_day_idx ON ai_runtime.quirk_actions (user_id, character_id, local_date);
