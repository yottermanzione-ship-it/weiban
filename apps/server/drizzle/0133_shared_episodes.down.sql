DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ai_runtime.shared_episodes) OR EXISTS(SELECT 1 FROM ai_runtime.shared_episode_months) THEN
  RAISE EXCEPTION 'shared episodes contain user data; back up and migrate forward';
 END IF;
END $$;
DROP TABLE ai_runtime.shared_episode_states;
DROP TABLE ai_runtime.shared_episode_months;
DROP TABLE ai_runtime.shared_episodes;
