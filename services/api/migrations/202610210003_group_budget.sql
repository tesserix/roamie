SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE trip_groups ADD COLUMN currency text NOT NULL DEFAULT 'AUD' CHECK (currency ~ '^[A-Z]{3}$'),
 ADD COLUMN creation_hash text CHECK (creation_hash ~ '^[0-9a-f]{64}$'),
 ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE group_participants ADD COLUMN email text NOT NULL DEFAULT '' CHECK (length(email) <= 254 AND email !~ '[[:cntrl:]]'),
 ADD COLUMN whatsapp text NOT NULL DEFAULT '' CHECK (whatsapp = '' OR whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
 ADD COLUMN invited_until timestamptz;
CREATE UNIQUE INDEX group_participant_contact_email ON group_participants(group_id,lower(email)) WHERE email<>'';
CREATE INDEX group_participant_email_invites ON group_participants(lower(email), group_id) WHERE subject IS NULL AND invited_until IS NOT NULL;
ALTER TABLE group_expenses ADD COLUMN split_method text NOT NULL DEFAULT 'exact' CHECK (split_method IN ('equal','percentage','exact')),
 ADD COLUMN split_input jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(split_input)='array' AND jsonb_array_length(split_input)<=20),
 ADD COLUMN home_currency text CHECK (home_currency ~ '^[A-Z]{3}$'),
 ADD COLUMN home_minor bigint CHECK (home_minor BETWEEN 0 AND 9007199254740991),
 ADD COLUMN rate_as_of text CHECK (length(rate_as_of)<=120);
CREATE TABLE group_settlements (
 group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 from_id uuid NOT NULL,
 to_id uuid NOT NULL,
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
 occurred_on date NOT NULL,
 created_by text NOT NULL,
 voided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(group_id,id),
 CHECK (from_id<>to_id),
 FOREIGN KEY(group_id,from_id) REFERENCES group_participants(group_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(group_id,to_id) REFERENCES group_participants(group_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(group_id,created_by) REFERENCES group_memberships(group_id,subject) ON DELETE RESTRICT
);
CREATE INDEX group_settlements_from ON group_settlements(group_id,from_id);
CREATE INDEX group_settlements_to ON group_settlements(group_id,to_id);
CREATE TABLE group_budget_commands (
 group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 actor_subject text NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(group_id,id),
 FOREIGN KEY(group_id,actor_subject) REFERENCES group_memberships(group_id,subject) ON DELETE RESTRICT
);
CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON group_settlements
 FOR EACH ROW EXECUTE FUNCTION capture_roamie_audit();
CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON group_budget_commands
 FOR EACH ROW EXECUTE FUNCTION capture_roamie_audit();
GRANT SELECT,INSERT,UPDATE ON group_settlements TO roamie_app;
GRANT SELECT,INSERT ON group_budget_commands TO roamie_app;
