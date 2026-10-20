SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE phrasebook (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 surface text NOT NULL CHECK (surface IN ('talk','text','sign')),
 source_lang text NOT NULL CHECK (source_lang ~ '^[a-z]{2,3}$'),
 target_lang text NOT NULL CHECK (target_lang ~ '^[a-z]{2,3}$' AND target_lang<>source_lang),
 prompt_version smallint NOT NULL CHECK (prompt_version>0),
 model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
 source_digest bytea NOT NULL CHECK (length(source_digest)=32),
 translation_digest bytea NOT NULL CHECK (length(translation_digest)=32),
 source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 5000),
 translation text NOT NULL CHECK (length(translation) BETWEEN 1 AND 10000),
 romanized text NOT NULL DEFAULT '' CHECK (length(romanized)<=10000),
 source_romanized text NOT NULL DEFAULT '' CHECK (length(source_romanized)<=10000),
 alternatives text[] NOT NULL DEFAULT '{}' CHECK (cardinality(alternatives)<=2),
 confidence real CHECK (confidence BETWEEN 0 AND 1),
 review_required boolean NOT NULL DEFAULT false,
 uses bigint NOT NULL DEFAULT 1 CHECK (uses>0),
 first_seen timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now(),
 UNIQUE (source_digest,source_lang,target_lang,surface,prompt_version,model,translation_digest)
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='roamie_app') THEN
  GRANT SELECT,INSERT,UPDATE ON phrasebook TO roamie_app;
  REVOKE DELETE,TRUNCATE ON phrasebook FROM roamie_app;
 END IF;
END $$;
