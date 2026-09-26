use sqlx::{postgres::PgConnectOptions, Row};
use std::str::FromStr;

#[tokio::test]
#[ignore = "requires isolated Postgres and runtime role"]
async fn reference_seeds_replay_and_audits_cannot_be_forged_or_erased() {
    let options =
        PgConnectOptions::from_str(&std::env::var("ROAMIE_TEST_DATABASE_URL").expect("test DB"))
            .expect("options");
    let db = crate::database::Database::connect(options.clone())
        .await
        .expect("owner");
    db.migrate().await.expect("migrations");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM travel_styles")
        .fetch_one(&db.pool)
        .await
        .expect("reference seeds exist");
    assert_eq!(count, 8);
    db.migrate().await.expect("replay");
    let runtime = crate::database::Database::connect(
        options
            .username("roamie_app")
            .password(&std::env::var("ROAMIE_TEST_RUNTIME_PASSWORD").unwrap_or_default()),
    )
    .await
    .expect("runtime");
    let subject = format!("test-{}", uuid::Uuid::now_v7());
    let mut tx = runtime.pool.begin().await.expect("tx");
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(&subject)
        .execute(&mut *tx)
        .await
        .expect("actor");
    sqlx::query("INSERT INTO accounts(subject,issuer,email,display_name) VALUES($1,'https://identity.example',$2,'Synthetic traveller')").bind(&subject).bind(format!("{subject}@example.invalid")).execute(&mut *tx).await.expect("account");
    tx.commit().await.expect("commit");
    let audit = sqlx::query(
        "SELECT actor_subject,operation,entity_type FROM audit_events WHERE entity_id=$1",
    )
    .bind(&subject)
    .fetch_one(&db.pool)
    .await
    .expect("audit");
    assert_eq!(audit.get::<String, _>("actor_subject"), subject);
    assert_eq!(audit.get::<String, _>("operation"), "INSERT");
    assert_eq!(audit.get::<String, _>("entity_type"), "accounts");
    for sql in ["DELETE FROM audit_events", "UPDATE audit_events SET operation='DELETE'", "TRUNCATE audit_events", "INSERT INTO audit_events(actor_subject,operation,entity_type,entity_id,changed_columns) VALUES('forged','INSERT','accounts','fake','{}')", "DELETE FROM travel_styles"] {
        assert!(sqlx::query(sql).execute(&runtime.pool).await.is_err(),"allowed {sql}");
    }
    let error = sqlx::query("DELETE FROM audit_events WHERE entity_id=$1")
        .bind(&subject)
        .execute(&db.pool)
        .await
        .expect_err("owner cannot accidentally erase audits");
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("42501")
    );
}

async fn authenticated_request(
    subject: &str,
    email: &str,
    path: &str,
) -> (axum::http::StatusCode, serde_json::Value) {
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use std::sync::Arc;
    use tower::ServiceExt;
    let options =
        PgConnectOptions::from_str(&std::env::var("ROAMIE_TEST_DATABASE_URL").expect("test DB"))
            .expect("options");
    let db = crate::database::Database::connect(options)
        .await
        .expect("connect");
    db.migrate().await.expect("migrate");
    let mut state = crate::tests::state("http://unused", "http://unused", None);
    let state_mut = Arc::get_mut(&mut state).expect("unique");
    let mut profile = crate::auth_tests::profile();
    profile["sub"] = subject.into();
    profile["email"] = email.into();
    state_mut.auth = Some(crate::auth_tests::verifier(profile).0);
    state_mut.development_auth_disabled = false;
    let runtime_options =
        PgConnectOptions::from_str(&std::env::var("ROAMIE_TEST_DATABASE_URL").expect("test DB"))
            .expect("options")
            .username("roamie_app")
            .password(&std::env::var("ROAMIE_TEST_RUNTIME_PASSWORD").unwrap_or_default());
    state_mut.database = Some(
        crate::database::Database::connect(runtime_options)
            .await
            .expect("runtime"),
    );
    let jwt = crate::auth_tests::token(serde_json::json!({"sub":subject}));
    let response = crate::router(state)
        .oneshot(
            Request::builder()
                .uri(path)
                .header("Authorization", format!("Bearer {jwt}"))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.expect("body");
    (status, serde_json::from_slice(&bytes).unwrap_or_default())
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn verified_accounts_persist_with_unique_email_and_private_audit_history() {
    use axum::http::StatusCode;
    let alice = format!("alice-{}", uuid::Uuid::now_v7());
    let bob = format!("bob-{}", uuid::Uuid::now_v7());
    let email = format!("{alice}@example.invalid");
    assert_eq!(
        authenticated_request(&alice, &email, "/v1/auth/me").await.0,
        StatusCode::OK
    );
    let (status, audit) = authenticated_request(&alice, &email, "/v1/auth/audit").await;
    assert_eq!(status, StatusCode::OK);
    assert!(audit["items"]
        .as_array()
        .expect("audit list")
        .iter()
        .any(|e| e["entityId"] == alice));
    let bob_email = format!("{bob}@example.invalid");
    assert_eq!(
        authenticated_request(&bob, &bob_email, "/v1/auth/me")
            .await
            .0,
        StatusCode::OK
    );
    let (_, audit) = authenticated_request(&bob, &bob_email, "/v1/auth/audit").await;
    assert!(audit["items"]
        .as_array()
        .expect("own audit list")
        .iter()
        .all(|e| e["entityId"] != alice));
    assert_eq!(
        authenticated_request(&bob, &email.to_uppercase(), "/v1/auth/me")
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (status, seeds) = authenticated_request(&alice, &email, "/v1/reference/trip-styles").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(seeds.as_array().expect("styles").len(), 8);
}
