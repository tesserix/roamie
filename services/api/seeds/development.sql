\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() !~ '^roamie_.*test$' THEN
  RAISE EXCEPTION 'development seeds require an isolated roamie_*test database';
 END IF;
END $$;
SELECT set_config('roamie.actor','seed:development',true);
INSERT INTO accounts(subject,issuer,email,display_name) VALUES
 ('demo-traveller','https://identity.example','demo-traveller@example.invalid','Demo traveller')
ON CONFLICT DO NOTHING;
INSERT INTO trip_groups(id,owner_subject,title,request_key) VALUES
 ('0195a100-0000-7000-8000-000000000001','demo-traveller','Synthetic Kyoto trip','0195a100-0000-7000-8000-000000000002')
ON CONFLICT DO NOTHING;
INSERT INTO group_memberships(group_id,subject,display_name) VALUES
 ('0195a100-0000-7000-8000-000000000001','demo-traveller','Demo traveller')
ON CONFLICT DO NOTHING;
INSERT INTO group_participants(group_id,id,subject,name) VALUES
 ('0195a100-0000-7000-8000-000000000001','0195a100-0000-7000-8000-000000000003','demo-traveller','Demo traveller')
ON CONFLICT DO NOTHING;
INSERT INTO group_itineraries(group_id,document,updated_by) VALUES
 ('0195a100-0000-7000-8000-000000000001','{"title":"Synthetic Kyoto trip","days":[]}','demo-traveller')
ON CONFLICT DO NOTHING;
INSERT INTO group_expenses(group_id,id,payer_id,description,currency,amount_minor,occurred_on,request_key,request_hash,created_by) VALUES
 ('0195a100-0000-7000-8000-000000000001','0195a100-0000-7000-8000-000000000004','0195a100-0000-7000-8000-000000000003','Synthetic lunch','JPY',1200,'2026-10-01','0195a100-0000-7000-8000-000000000005',repeat('0',64),'demo-traveller')
ON CONFLICT DO NOTHING;
INSERT INTO group_expense_splits(group_id,expense_id,participant_id,amount_minor) VALUES
 ('0195a100-0000-7000-8000-000000000001','0195a100-0000-7000-8000-000000000004','0195a100-0000-7000-8000-000000000003',1200)
ON CONFLICT DO NOTHING;
COMMIT;
