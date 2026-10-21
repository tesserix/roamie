SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE phrasebook_contributions (
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
 phrase_id bigint NOT NULL REFERENCES phrasebook(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subject,phrase_id)
);
CREATE INDEX phrasebook_contributions_phrase ON phrasebook_contributions(phrase_id);
REVOKE ALL ON phrasebook_contributions FROM roamie_app;
GRANT SELECT,INSERT ON phrasebook_contributions TO roamie_app;

CREATE TABLE ocr_resources (
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
 request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 100),
 upload_id text CHECK (length(upload_id) BETWEEN 1 AND 200),
 job_id text CHECK (length(job_id) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subject,request_key)
);
REVOKE ALL ON ocr_resources FROM roamie_app;
GRANT SELECT,INSERT,UPDATE ON ocr_resources TO roamie_app;
