SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE accounts (
 subject text PRIMARY KEY CHECK (length(subject) BETWEEN 1 AND 200),
 issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
 email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
 display_name text NOT NULL CHECK (length(display_name)<=120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_unique_email ON accounts(lower(email));

CREATE TABLE travel_styles (
 code text PRIMARY KEY,
 label text NOT NULL,
 sort_order smallint NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO travel_styles(code,label,sort_order) VALUES
 ('relaxed','Relaxed',1),('adventure','Adventure',2),('culture','Culture',3),
 ('food','Food and local flavours',4),('nature','Nature',5),('family','Family',6),
 ('nightlife','Nightlife',7),('accessible','Accessible travel',8);

CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_subject text NOT NULL,
 database_actor text NOT NULL,
 operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
 entity_type text NOT NULL,
 entity_id text NOT NULL,
 group_id uuid,
 changed_columns text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_actor_cursor ON audit_events(actor_subject,id);
CREATE INDEX audit_events_group_cursor ON audit_events(group_id,id) WHERE group_id IS NOT NULL;
CREATE INDEX audit_events_entity ON audit_events(entity_type,entity_id,id);

CREATE FUNCTION capture_roamie_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 previous jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 current_row jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
 identity_row jsonb := CASE WHEN TG_OP='DELETE' THEN previous ELSE current_row END;
 changed text[];
BEGIN
 SELECT coalesce(array_agg(key ORDER BY key),'{}'::text[]) INTO changed
 FROM jsonb_object_keys(previous || current_row) AS keys(key)
 WHERE previous->key IS DISTINCT FROM current_row->key;
 INSERT INTO public.audit_events(actor_subject,database_actor,operation,entity_type,entity_id,group_id,changed_columns)
 VALUES(coalesce(nullif(current_setting('roamie.actor',true),''),'database:'||session_user),session_user,TG_OP,TG_TABLE_NAME,
 coalesce(identity_row->>'id',identity_row->>'subject',identity_row->>'group_id',identity_row->>'code'),
 CASE WHEN TG_TABLE_NAME='trip_groups' THEN (identity_row->>'id')::uuid ELSE (identity_row->>'group_id')::uuid END,changed);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION capture_roamie_audit() FROM PUBLIC;

DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['accounts','trip_groups','group_memberships','group_participants','group_invitations','group_itineraries','group_expenses','group_expense_splits','travel_styles'] LOOP
 EXECUTE format('CREATE TRIGGER capture_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_roamie_audit()',target);
 END LOOP;
END $$;

CREATE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'audit records are append-only' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prevent_audit_mutation() FROM PUBLIC;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER immutable_group_audit BEFORE UPDATE OR DELETE ON group_audit
 FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER no_truncate_group_audit BEFORE TRUNCATE ON group_audit
 FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();

REVOKE ALL ON audit_events,travel_styles FROM roamie_app;
REVOKE ALL ON SEQUENCE audit_events_id_seq FROM roamie_app;
GRANT SELECT ON audit_events,travel_styles TO roamie_app;
GRANT SELECT,INSERT,UPDATE ON accounts TO roamie_app;
REVOKE DELETE ON accounts FROM roamie_app;
