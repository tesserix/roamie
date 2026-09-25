SET lock_timeout = '5s';
SET statement_timeout = '30s';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE trip_groups (
  id uuid PRIMARY KEY,
  owner_subject text NOT NULL CHECK (length(owner_subject) BETWEEN 1 AND 200),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  request_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_subject, request_key)
);
CREATE TABLE group_memberships (
  group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, subject)
);
CREATE INDEX group_memberships_subject ON group_memberships(subject, group_id) WHERE active;
CREATE TABLE group_participants (
  group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  subject text,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, id),
  UNIQUE (group_id, subject),
  FOREIGN KEY (group_id, subject) REFERENCES group_memberships(group_id, subject) ON DELETE RESTRICT
);
CREATE TABLE group_invitations (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_by text,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (group_id, created_by) REFERENCES group_memberships(group_id, subject) ON DELETE RESTRICT
);
CREATE INDEX group_invitations_group ON group_invitations(group_id);
CREATE TABLE group_itineraries (
  group_id uuid PRIMARY KEY REFERENCES trip_groups(id) ON DELETE CASCADE,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND pg_column_size(document) <= 262144),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (group_id, updated_by) REFERENCES group_memberships(group_id, subject) ON DELETE RESTRICT
);
CREATE TABLE group_expenses (
  group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  payer_id uuid NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN -1000000000 AND 1000000000 AND amount_minor <> 0),
  occurred_on date NOT NULL,
  request_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, id),
  UNIQUE (group_id, created_by, request_key),
  FOREIGN KEY (group_id, payer_id) REFERENCES group_participants(group_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (group_id, created_by) REFERENCES group_memberships(group_id, subject) ON DELETE RESTRICT
);
CREATE INDEX group_expenses_payer ON group_expenses(group_id, payer_id);
CREATE TABLE group_expense_splits (
  group_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN -1000000000 AND 1000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, expense_id, participant_id),
  FOREIGN KEY (group_id, expense_id) REFERENCES group_expenses(group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, participant_id) REFERENCES group_participants(group_id, id) ON DELETE RESTRICT
);
CREATE INDEX group_expense_splits_participant ON group_expense_splits(group_id, participant_id);
CREATE TABLE group_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
  actor_subject text NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_audit_group ON group_audit(group_id, id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roamie_app') THEN
    GRANT USAGE ON SCHEMA public TO roamie_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roamie_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roamie_app;
    REVOKE UPDATE, DELETE ON group_audit FROM roamie_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roamie_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO roamie_app;
  END IF;
END $$;
