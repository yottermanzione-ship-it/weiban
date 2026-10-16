ALTER TABLE model_access.model_catalog ADD COLUMN billing_bounds jsonb;
ALTER TABLE model_access.model_routes ADD COLUMN billing_bounds jsonb;
CREATE TABLE model_access.generation_attempts (
 id uuid PRIMARY KEY,generation_id uuid NOT NULL,user_id uuid NOT NULL,ordinal integer NOT NULL,
 model_key text NOT NULL,upstream_id uuid NOT NULL,upstream_model_id text NOT NULL,usage_record_id uuid,hold_id uuid,phase text NOT NULL,
 bound_snapshot jsonb NOT NULL,reported_usage jsonb,usage_state text NOT NULL DEFAULT 'unknown',error_code text,created_at timestamptz NOT NULL,finished_at timestamptz,
 CONSTRAINT generation_attempts_generation_ordinal_key UNIQUE(generation_id,ordinal));
CREATE INDEX generation_attempts_user_idx ON model_access.generation_attempts(user_id);
CREATE INDEX generation_attempts_usage_idx ON model_access.generation_attempts(usage_record_id);
CREATE TABLE model_access.platform_purpose_limits(user_id uuid NOT NULL,purpose text NOT NULL,day date NOT NULL,count integer NOT NULL,minute_starts timestamptz NOT NULL,minute_count integer NOT NULL,PRIMARY KEY(user_id,purpose));
