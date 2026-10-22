#!/usr/bin/env bash
set -euo pipefail
export PGHOST=127.0.0.1
export PGPORT="${ROAMIE_CI_POSTGRES_PORT:-5432}"
export PGUSER=postgres
if [[ -z "${PGPASSWORD:-}" ]]; then
  printf '%s\n' 'Missing CI Postgres configuration.' >&2
  exit 1
fi

psql -X -q -v ON_ERROR_STOP=1 -v runtime_password="$PGPASSWORD" postgres >&2 <<'SQL'
SELECT 'CREATE DATABASE roamie_ci' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='roamie_ci') \gexec
SELECT format('CREATE ROLE roamie_app LOGIN PASSWORD %L', :'runtime_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='roamie_app') \gexec
SQL
python3 - <<'PY'
import os
from urllib.parse import quote
password = os.environ['PGPASSWORD']
port = int(os.environ['PGPORT'])
print(f'ROAMIE_TEST_DATABASE_URL=postgres://postgres:{quote(password, safe="")}@127.0.0.1:{port}/roamie_ci')
print(f'ROAMIE_TEST_RUNTIME_PASSWORD={password}')
PY
