use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::PgPool;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Database {
    pub pool: PgPool,
}

impl Database {
    pub async fn from_env(development: bool) -> anyhow::Result<Option<Self>> {
        let Ok(host) = std::env::var("PGHOST") else {
            return Ok(None);
        };
        let local =
            host.starts_with('/') || matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1");
        anyhow::ensure!(
            !development || local,
            "development authentication requires a local database"
        );
        let mut options = PgConnectOptions::new()
            .host(&host)
            .port(
                std::env::var("PGPORT")
                    .unwrap_or_else(|_| "5432".into())
                    .parse()?,
            )
            .database(&std::env::var("PGDATABASE")?)
            .username(&std::env::var("PGUSER")?)
            .password(&std::env::var("PGPASSWORD").unwrap_or_default())
            .application_name("roamie-api")
            .options([
                ("statement_timeout", "10000"),
                ("lock_timeout", "3000"),
                ("idle_in_transaction_session_timeout", "15000"),
            ]);
        if local && development {
            options = options.ssl_mode(PgSslMode::Disable);
        } else {
            options = options
                .ssl_mode(PgSslMode::VerifyFull)
                .ssl_root_cert(std::env::var("PGSSLROOTCERT")?);
        }
        Ok(Some(Self::connect(options).await?))
    }

    pub async fn connect(options: PgConnectOptions) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(3))
            .idle_timeout(Duration::from_secs(120))
            .max_lifetime(Duration::from_secs(1800))
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    pub async fn healthy(&self) -> bool {
        sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .is_ok()
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    #[tokio::test]
    #[ignore = "requires the isolated ROAMIE_TEST_DATABASE_URL; run in database CI"]
    async fn database_migrations_apply_and_readiness_tracks_connectivity() {
        let options = PgConnectOptions::from_str(
            &std::env::var("ROAMIE_TEST_DATABASE_URL").expect("isolated test database"),
        )
        .expect("options");
        let database = Database::connect(options).await.expect("connect");
        database.migrate().await.expect("migrate");
        assert!(database.healthy().await);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('trip_groups','group_memberships','group_participants','group_invitations','group_itineraries','group_expenses','group_expense_splits','group_audit')").fetch_one(&database.pool).await.expect("tables");
        assert_eq!(count, 8);
        database
            .migrate()
            .await
            .expect("idempotent migration replay");
        database.pool.close().await;
        assert!(!database.healthy().await);
    }
    #[tokio::test]
    #[ignore = "requires the isolated ROAMIE_TEST_DATABASE_URL; run in database CI"]
    async fn database_rejects_unbalanced_expenses_atomically() {
        let options = PgConnectOptions::from_str(
            &std::env::var("ROAMIE_TEST_DATABASE_URL").expect("test database"),
        )
        .expect("options");
        let database = Database::connect(options).await.expect("connect");
        database.migrate().await.expect("migrate");
        let id = uuid::Uuid::now_v7();
        let mut tx = database.pool.begin().await.expect("transaction");
        sqlx::query("INSERT INTO trip_groups(id,owner_subject,title,request_key) VALUES($1,'test-owner','Test',$1)").bind(id).execute(&mut *tx).await.expect("group");
        sqlx::query("INSERT INTO group_memberships(group_id,subject,display_name) VALUES($1,'test-owner','Owner')").bind(id).execute(&mut *tx).await.expect("member");
        sqlx::query("INSERT INTO group_participants(group_id,id,subject,name) VALUES($1,$1,'test-owner','Owner')").bind(id).execute(&mut *tx).await.expect("participant");
        sqlx::query("INSERT INTO group_expenses(group_id,id,payer_id,description,currency,amount_minor,occurred_on,request_key,request_hash,created_by) VALUES($1,$1,$1,'Meal','USD',100,'2026-10-01',$1,repeat('a',64),'test-owner')").bind(id).execute(&mut *tx).await.expect("expense");
        sqlx::query("INSERT INTO group_expense_splits(group_id,expense_id,participant_id,amount_minor) VALUES($1,$1,$1,99)").bind(id).execute(&mut *tx).await.expect("split");
        assert!(
            tx.commit().await.is_err(),
            "a mismatched split must fail at commit"
        );
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM trip_groups WHERE id=$1")
            .bind(id)
            .fetch_one(&database.pool)
            .await
            .expect("count");
        assert_eq!(count, 0, "the entire transaction must roll back");
    }
    #[tokio::test]
    #[ignore = "requires isolated Postgres and runtime role"]
    async fn runtime_role_has_dml_but_cannot_change_schema_or_migrations() {
        let options = PgConnectOptions::from_str(
            &std::env::var("ROAMIE_TEST_DATABASE_URL").expect("test database"),
        )
        .expect("options");
        let database = Database::connect(options.clone())
            .await
            .expect("owner connect");
        database.migrate().await.expect("migrate");
        let runtime = Database::connect(
            options
                .username("roamie_app")
                .password(&std::env::var("ROAMIE_TEST_RUNTIME_PASSWORD").unwrap_or_default()),
        )
        .await
        .expect("runtime connect");
        let id = uuid::Uuid::now_v7();
        let mut tx = runtime.pool.begin().await.expect("transaction");
        sqlx::query("INSERT INTO trip_groups(id,owner_subject,title,request_key) VALUES($1,'test-owner','Test',$1)").bind(id).execute(&mut *tx).await.expect("group");
        sqlx::query("INSERT INTO group_memberships(group_id,subject,display_name) VALUES($1,'test-owner','Owner')").bind(id).execute(&mut *tx).await.expect("member");
        sqlx::query("INSERT INTO group_participants(group_id,id,subject,name) VALUES($1,$1,'test-owner','Owner')").bind(id).execute(&mut *tx).await.expect("participant");
        sqlx::query("INSERT INTO group_expenses(group_id,id,payer_id,description,currency,amount_minor,occurred_on,request_key,request_hash,created_by) VALUES($1,$1,$1,'Meal','USD',100,'2026-10-01',$1,repeat('a',64),'test-owner')").bind(id).execute(&mut *tx).await.expect("expense");
        sqlx::query("INSERT INTO group_expense_splits(group_id,expense_id,participant_id,amount_minor) VALUES($1,$1,$1,100)").bind(id).execute(&mut *tx).await.expect("balanced split");
        tx.commit().await.expect("balanced commit");
        for query in [
            "CREATE TABLE forbidden_schema_change(id int)",
            "DELETE FROM _sqlx_migrations",
            "DELETE FROM group_audit",
            "UPDATE group_audit SET action='tampered'",
        ] {
            let error = sqlx::query(query)
                .execute(&runtime.pool)
                .await
                .expect_err("privilege denied");
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("42501")
            );
        }
        let total: i64 = sqlx::query_scalar(
            "SELECT amount_minor FROM group_expenses WHERE group_id=$1 AND id=$1",
        )
        .bind(id)
        .fetch_one(&runtime.pool)
        .await
        .expect("read persisted amount");
        assert_eq!(total, 100);
    }
}
