SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE personal_trip_profiles (
 subject text NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
 trip_id text NOT NULL CHECK (length(trip_id) BETWEEN 1 AND 120),
 revision uuid NOT NULL,
 preferences jsonb NOT NULL CHECK (jsonb_typeof(preferences)='object' AND pg_column_size(preferences)<=32768),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subject,trip_id)
);
CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON personal_trip_profiles
 FOR EACH ROW EXECUTE FUNCTION capture_roamie_audit();
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='roamie_app') THEN
  GRANT SELECT, INSERT, UPDATE ON personal_trip_profiles TO roamie_app;
  REVOKE DELETE ON personal_trip_profiles FROM roamie_app;
 END IF;
END $$;
