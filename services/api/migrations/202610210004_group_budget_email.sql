SET lock_timeout = '5s';
SET statement_timeout = '30s';
-- Forward-only: preserve reminder/audit history; disabling the sender stops delivery.
CREATE TABLE group_mail_outbox (
 group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 actor_subject text NOT NULL,
 from_id uuid NOT NULL,
 to_id uuid NOT NULL,
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
 recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254 AND recipient !~ '[[:cntrl:]]'),
 body text NOT NULL CHECK (length(body) BETWEEN 1 AND 16000),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','accepted','failed','cancelled')),
 provider_id text CHECK (length(provider_id)<=200),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(group_id,id),
 CHECK(from_id<>to_id),
 FOREIGN KEY(group_id,from_id) REFERENCES group_participants(group_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(group_id,to_id) REFERENCES group_participants(group_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(group_id,actor_subject) REFERENCES group_memberships(group_id,subject) ON DELETE RESTRICT
);
CREATE INDEX group_mail_outbox_due ON group_mail_outbox(next_attempt_at,created_at) WHERE status='queued';
CREATE INDEX group_mail_outbox_actor ON group_mail_outbox(actor_subject,created_at DESC);
CREATE INDEX group_mail_outbox_recipient ON group_mail_outbox(lower(recipient),created_at DESC);
CREATE INDEX group_mail_outbox_cooldown ON group_mail_outbox(group_id,from_id,to_id,currency,created_at DESC) WHERE status IN ('queued','accepted');
CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON group_mail_outbox
 FOR EACH ROW EXECUTE FUNCTION capture_roamie_audit();
GRANT SELECT,INSERT,UPDATE ON group_mail_outbox TO roamie_app;
