SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE trip_planning_jobs (
 id uuid PRIMARY KEY,
 subject text NOT NULL,
 trip_id text NOT NULL,
 profile_revision uuid NOT NULL,
 request_hash text NOT NULL CHECK (length(request_hash)=64),
 input jsonb NOT NULL CHECK (jsonb_typeof(input)='object' AND pg_column_size(input)<=32768),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
 lease_token uuid,
 lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 result jsonb CHECK (pg_column_size(result)<=131072),
 error_code text CHECK (error_code IN ('unavailable','profile_changed','invalid','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(subject,trip_id) REFERENCES personal_trip_profiles(subject,trip_id) ON DELETE CASCADE,
 UNIQUE(subject,trip_id,profile_revision,request_hash),
 CHECK ((status='completed')=(result IS NOT NULL))
);
CREATE INDEX trip_planning_jobs_by_trip ON trip_planning_jobs(subject,trip_id,created_at DESC);
CREATE UNIQUE INDEX trip_planning_jobs_one_active ON trip_planning_jobs(subject,trip_id)
 WHERE status IN ('queued','running');
CREATE INDEX trip_planning_jobs_pending ON trip_planning_jobs(available_at,lease_until)
 WHERE status IN ('queued','running');
CREATE INDEX trip_planning_jobs_retention ON trip_planning_jobs(created_at);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='roamie_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON trip_planning_jobs TO roamie_app;
 END IF;
END $$;
