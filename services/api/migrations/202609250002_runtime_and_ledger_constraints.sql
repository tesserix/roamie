SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE FUNCTION check_expense_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_group uuid;
  target_expense uuid;
  expected bigint;
  actual bigint;
  split_count bigint;
BEGIN
  target_group := COALESCE(NEW.group_id, OLD.group_id);
  IF TG_TABLE_NAME = 'group_expenses' THEN
    target_expense := COALESCE(NEW.id, OLD.id);
  ELSE
    target_expense := COALESCE(NEW.expense_id, OLD.expense_id);
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.group_id<>OLD.group_id THEN
      RAISE EXCEPTION 'expense group is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='group_expenses' THEN
      IF NEW.id<>OLD.id THEN
        RAISE EXCEPTION 'expense identity is immutable' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.expense_id<>OLD.expense_id THEN
      RAISE EXCEPTION 'split expense is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT amount_minor INTO expected FROM group_expenses WHERE group_id=target_group AND id=target_expense FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(sum(amount_minor),0), count(*) INTO actual, split_count
      FROM group_expense_splits WHERE group_id=target_group AND expense_id=target_expense;
    IF split_count=0 OR actual<>expected THEN
      RAISE EXCEPTION 'expense splits must equal the expense total' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER group_expense_total
AFTER INSERT OR UPDATE ON group_expenses DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_expense_total();
CREATE CONSTRAINT TRIGGER group_split_total
AFTER INSERT OR UPDATE OR DELETE ON group_expense_splits DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_expense_total();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roamie_app') THEN
    GRANT USAGE ON SCHEMA public TO roamie_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON trip_groups, group_memberships, group_participants,
      group_invitations, group_itineraries, group_expenses, group_expense_splits TO roamie_app;
    GRANT SELECT, INSERT ON group_audit TO roamie_app;
    GRANT USAGE, SELECT ON SEQUENCE group_audit_id_seq TO roamie_app;
    REVOKE ALL ON _sqlx_migrations FROM roamie_app;
  END IF;
END $$;
