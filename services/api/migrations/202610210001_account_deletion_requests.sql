SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE account_deletion_requests (
 id uuid PRIMARY KEY,
 subject text NOT NULL UNIQUE CHECK (length(subject) BETWEEN 1 AND 200),
 issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
 contact_email text NOT NULL CHECK (length(contact_email) BETWEEN 3 AND 254),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 due_at timestamptz NOT NULL DEFAULT now()+interval '720 hours',
 completed_at timestamptz,
 completion_reference text,
 CHECK (due_at = requested_at + interval '720 hours'),
 CHECK ((status='completed')=(completed_at IS NOT NULL)),
 CHECK ((status='completed')=(completion_reference IS NOT NULL)),
 CHECK (completion_reference IS NULL OR length(completion_reference) BETWEEN 1 AND 200)
);
CREATE INDEX account_deletion_requests_pending ON account_deletion_requests(due_at) WHERE status='pending';
CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON account_deletion_requests
 FOR EACH ROW EXECUTE FUNCTION capture_roamie_audit();
REVOKE ALL ON account_deletion_requests FROM roamie_app;
GRANT SELECT ON account_deletion_requests TO roamie_app;
GRANT INSERT (id,subject,issuer,contact_email) ON account_deletion_requests TO roamie_app;
