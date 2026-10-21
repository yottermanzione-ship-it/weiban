DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM client_logs.events) OR EXISTS(SELECT 1 FROM client_logs.ticket_events)
 OR EXISTS(SELECT 1 FROM client_logs.sessions) OR EXISTS(SELECT 1 FROM client_logs.group_users)
 OR EXISTS(SELECT 1 FROM client_logs.rate_windows WHERE user_id IS NOT NULL) THEN
  RAISE EXCEPTION 'client logs contain user data; back up and migrate forward';
 END IF;
END $$;
DROP SCHEMA client_logs CASCADE;
