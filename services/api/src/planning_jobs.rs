use crate::{auth::Customer, trip_manager, AppState};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    Extension, Json,
};
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Serialize, FromRow)]
pub struct Job {
    pub id: Uuid,
    pub profile_revision: Uuid,
    pub status: String,
    pub attempts: i32,
    pub result: Option<Value>,
    pub error_code: Option<String>,
    pub input: Value,
}

#[derive(Debug, FromRow)]
struct Claimed {
    id: Uuid,
    subject: String,
    trip_id: String,
    profile_revision: Uuid,
    attempts: i32,
    lease_token: Uuid,
    input: Value,
}

async fn enqueue(
    pool: &PgPool,
    subject: &str,
    trip: &str,
    revision: Uuid,
    input: &Value,
) -> Result<Job> {
    let bytes = serde_json::to_vec(input)
        .map_err(|_| Error::Invalid("Invalid planning request.".into()))?;
    if bytes.len() > 32768 {
        return Err(Error::Invalid("Planning request is too large.".into()));
    }
    let hash = hex::encode(Sha256::digest(bytes));
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT subject FROM accounts WHERE subject=$1 FOR UPDATE")
        .bind(subject)
        .fetch_one(&mut *tx)
        .await?;
    let matching: Option<Uuid> = sqlx::query_scalar("SELECT id FROM trip_planning_jobs WHERE subject=$1 AND trip_id=$2 AND profile_revision=$3 AND request_hash=$4")
        .bind(subject).bind(trip).bind(revision).bind(&hash).fetch_optional(&mut *tx).await?;
    if let Some(id) = matching {
        let job=sqlx::query_as::<_,Job>("SELECT id,profile_revision,status,attempts,result,error_code,input FROM trip_planning_jobs WHERE id=$1 AND subject=$2")
            .bind(id).bind(subject).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        return Ok(job);
    }
    sqlx::query("UPDATE trip_planning_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE subject=$1 AND trip_id=$2 AND status IN ('queued','running')")
        .bind(subject).bind(trip).execute(&mut *tx).await?;
    let count: i64=sqlx::query_scalar("SELECT count(*) FROM trip_planning_jobs WHERE subject=$1 AND status IN ('queued','running')")
        .bind(subject).fetch_one(&mut *tx).await?;
    if count >= 2 {
        return Err(Error::Busy);
    }
    let job=sqlx::query_as::<_,Job>("INSERT INTO trip_planning_jobs(id,subject,trip_id,profile_revision,request_hash,input) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,profile_revision,status,attempts,result,error_code,input")
        .bind(Uuid::now_v7()).bind(subject).bind(trip).bind(revision).bind(hash).bind(input).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(job)
}

async fn load(pool: &PgPool, subject: &str, trip: &str) -> Result<Option<Job>> {
    Ok(sqlx::query_as("SELECT j.id,j.profile_revision,CASE WHEN j.status IN ('queued','running') AND j.expires_at<=now() THEN 'failed' ELSE j.status END AS status,j.attempts,j.result,CASE WHEN j.status IN ('queued','running') AND j.expires_at<=now() THEN 'expired' ELSE j.error_code END AS error_code,j.input FROM trip_planning_jobs j JOIN personal_trip_profiles p ON p.subject=j.subject AND p.trip_id=j.trip_id AND p.revision=j.profile_revision WHERE j.subject=$1 AND j.trip_id=$2 ORDER BY j.created_at DESC,j.id DESC LIMIT 1")
        .bind(subject).bind(trip).fetch_optional(pool).await?)
}

async fn claim(pool: &PgPool) -> Result<Option<Claimed>> {
    sqlx::query("UPDATE trip_planning_jobs SET status='failed',error_code='expired',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status IN ('queued','running') AND (expires_at<=now() OR (attempts>=3 AND lease_until<=now()))")
        .execute(pool).await?;
    Ok(sqlx::query_as("WITH next AS (SELECT id FROM trip_planning_jobs WHERE status IN ('queued','running') AND available_at<=now() AND (lease_until IS NULL OR lease_until<=now()) AND attempts<3 AND expires_at>now() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE trip_planning_jobs j SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '120 seconds',updated_at=now() FROM next WHERE j.id=next.id RETURNING j.id,j.subject,j.trip_id,j.profile_revision,j.attempts,j.lease_token,j.input")
        .bind(Uuid::now_v7()).fetch_optional(pool).await?)
}

async fn finish(pool: &PgPool, job: &Claimed, result: Result<Value>) -> Result<bool> {
    let (status, value, error) = match result {
        Ok(value) => ("completed", Some(value), None),
        Err(Error::ProfileChanged) => ("failed", None, Some("profile_changed")),
        Err(Error::Invalid(_)) => ("failed", None, Some("invalid")),
        Err(_) if job.attempts < 3 => ("queued", None, Some("unavailable")),
        Err(_) => ("failed", None, Some("unavailable")),
    };
    let changed=sqlx::query("UPDATE trip_planning_jobs SET status=$3,result=$4,error_code=$5,lease_token=NULL,lease_until=NULL,available_at=now()+interval '5 seconds',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'")
        .bind(job.id).bind(job.lease_token).bind(status).bind(value).bind(error).execute(pool).await?.rows_affected()==1;
    if changed {
        tracing::info!(job_id=%job.id,attempt=job.attempts,status,"trip planning attempt finished");
    }
    Ok(changed)
}

fn pool(state: &AppState) -> Result<&PgPool> {
    state
        .database
        .as_ref()
        .map(|db| &db.pool)
        .ok_or(Error::Unavailable("Planning storage"))
}

pub async fn start(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(trip): Path<String>,
    headers: HeaderMap,
    Json(mut input): Json<trip_manager::Request>,
) -> Result<impl axum::response::IntoResponse> {
    let manager = state
        .trip_manager
        .as_ref()
        .ok_or(Error::Unavailable("Trip manager"))?;
    if !manager.can_serve_customer(&headers) {
        return Err(Error::Unavailable("Trip manager"));
    }
    if input.specialist != "trip-planner"
        || input.request.get("plan_options").and_then(Value::as_bool) != Some(true)
        || input.profile.get("trip_id").and_then(Value::as_str) != Some(trip.as_str())
        || input.profile.contains_key("subject")
    {
        return Err(Error::Invalid(
            "A trip planning request is required.".into(),
        ));
    }
    let saved = crate::travel_profiles::load(pool(&state)?, &customer.sub, &trip).await?;
    if input.profile.get("revision").and_then(Value::as_str)
        != Some(saved.revision.to_string().as_str())
    {
        return Err(Error::ProfileChanged);
    }
    input.profile = saved.snapshot()?;
    let input = serde_json::to_value(input)
        .map_err(|_| Error::Invalid("Invalid planning request.".into()))?;
    let job = enqueue(pool(&state)?, &customer.sub, &trip, saved.revision, &input).await?;
    Ok((
        StatusCode::ACCEPTED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(job),
    ))
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(trip): Path<String>,
) -> Result<impl axum::response::IntoResponse> {
    let job = load(pool(&state)?, &customer.sub, &trip)
        .await?
        .ok_or(Error::NotFound)?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(job)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cancellation {
    id: Uuid,
}

pub async fn cancel(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(trip): Path<String>,
    Json(input): Json<Cancellation>,
) -> Result<impl axum::response::IntoResponse> {
    sqlx::query("UPDATE trip_planning_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE subject=$1 AND trip_id=$2 AND id=$3 AND status IN ('queued','running')")
        .bind(&customer.sub).bind(&trip).bind(input.id).execute(pool(&state)?).await?;
    let job = load(pool(&state)?, &customer.sub, &trip)
        .await?
        .ok_or(Error::NotFound)?;
    if job.id != input.id {
        return Err(Error::NotFound);
    }
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(job)))
}

async fn process(state: &AppState) -> Result<bool> {
    let pool = pool(state)?;
    sqlx::query("DELETE FROM trip_planning_jobs WHERE id IN (SELECT id FROM trip_planning_jobs WHERE created_at<now()-interval '24 hours' ORDER BY created_at LIMIT 100)").execute(pool).await?;
    let Some(job) = claim(pool).await? else {
        return Ok(false);
    };
    let result = async {
        let saved = crate::travel_profiles::load(pool, &job.subject, &job.trip_id).await?;
        if saved.revision != job.profile_revision {
            return Err(Error::ProfileChanged);
        }
        let mut input: trip_manager::Request = serde_json::from_value(job.input.clone())
            .map_err(|_| Error::Invalid("Invalid planning request.".into()))?;
        input.profile = saved.snapshot()?;
        let result = state
            .trip_manager
            .as_ref()
            .ok_or(Error::Unavailable("Trip manager"))?
            .recommend(input, &job.subject)
            .await?;
        if crate::travel_profiles::load(pool, &job.subject, &job.trip_id)
            .await?
            .revision
            != job.profile_revision
        {
            return Err(Error::ProfileChanged);
        }
        Ok(result)
    }
    .await;
    finish(pool, &job, result).await?;
    Ok(true)
}

pub async fn run(state: Arc<AppState>, shutdown: watch::Receiver<bool>) {
    if state.database.is_none() || state.trip_manager.is_none() {
        return;
    }
    let mut workers = tokio::task::JoinSet::new();
    for _ in 0..2 {
        let state = state.clone();
        let mut shutdown = shutdown.clone();
        workers.spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(2));
            loop {
                tokio::select! {
                    _=shutdown.changed()=>break,
                    _=tick.tick()=>{
                        let result=tokio::select! {
                            _=shutdown.changed()=>break,
                            result=process(&state)=>result,
                        };
                        if result.is_err() {tracing::warn!("trip planning worker unavailable");}
                    }
                }
            }
        });
    }
    while workers.join_next().await.is_some() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    static JOB_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn retries_survive_worker_restart_and_cannot_overwrite_a_new_lease() {
        let _guard = JOB_TESTS.lock().await;
        let pool = sqlx::PgPool::connect(&std::env::var("ROAMIE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let subject = format!("planning-{}", uuid::Uuid::now_v7());
        sqlx::query(
            "INSERT INTO accounts(subject,issuer,email,display_name) VALUES($1,'qa',$2,'QA')",
        )
        .bind(&subject)
        .bind(format!("{subject}@example.test"))
        .execute(&pool)
        .await
        .unwrap();
        let revision = uuid::Uuid::now_v7();
        sqlx::query("INSERT INTO personal_trip_profiles(subject,trip_id,revision,preferences) VALUES($1,'trip',$2,'{}')")
            .bind(&subject).bind(revision).execute(&pool).await.unwrap();
        let input = serde_json::json!({"profile":{"trip_id":"trip","revision":revision},"specialist":"trip-planner","request":{"prompt":"Tokyo","plan_options":true}});
        let first = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        let replay = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        assert_eq!(first.id, replay.id);
        assert!(load(&pool, "other-user", "trip").await.unwrap().is_none());
        let (one, two) = tokio::join!(claim(&pool), claim(&pool));
        let mut claimed_jobs = vec![one.unwrap(), two.unwrap()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        assert_eq!(
            claimed_jobs.len(),
            1,
            "only one concurrent worker may claim the job"
        );
        let claimed = claimed_jobs.pop().unwrap();
        assert_eq!(claimed.id, first.id);
        assert!(claim(&pool).await.unwrap().is_none());
        sqlx::query(
            "UPDATE trip_planning_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        )
        .bind(first.id)
        .execute(&pool)
        .await
        .unwrap();
        let recovered = claim(&pool).await.unwrap().unwrap();
        assert_eq!(recovered.attempts, 2);
        assert!(
            !finish(&pool, &claimed, Ok(serde_json::json!({"stale":true})))
                .await
                .unwrap()
        );
        assert!(
            finish(&pool, &recovered, Ok(serde_json::json!({"approved":true})))
                .await
                .unwrap()
        );
        let saved = load(&pool, &subject, "trip").await.unwrap().unwrap();
        assert_eq!(saved.status, "completed");
        assert_eq!(saved.result, Some(serde_json::json!({"approved":true})));
    }
    async fn fixture() -> (PgPool, String, Uuid, Value) {
        let pool = PgPool::connect(&std::env::var("ROAMIE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let subject = format!("planning-{}", Uuid::now_v7());
        sqlx::query(
            "INSERT INTO accounts(subject,issuer,email,display_name) VALUES($1,'qa',$2,'QA')",
        )
        .bind(&subject)
        .bind(format!("{subject}@example.test"))
        .execute(&pool)
        .await
        .unwrap();
        let revision = Uuid::now_v7();
        sqlx::query("INSERT INTO personal_trip_profiles(subject,trip_id,revision,preferences) VALUES($1,'trip',$2,'{}')").bind(&subject).bind(revision).execute(&pool).await.unwrap();
        let input = serde_json::json!({"profile":{"trip_id":"trip","revision":revision},"specialist":"trip-planner","request":{"prompt":"Tokyo","plan_options":true}});
        (pool, subject, revision, input)
    }

    fn customer(subject: &str) -> Customer {
        Customer {
            sub: subject.into(),
            email: "qa@example.test".into(),
            name: "QA".into(),
            email_verified: true,
            organization: "qa".into(),
        }
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn transient_failures_retry_at_most_three_times() {
        let _guard = JOB_TESTS.lock().await;
        let (pool, subject, revision, input) = fixture().await;
        let initial = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        for attempt in 1..=3 {
            let job = claim(&pool).await.unwrap().unwrap();
            assert_eq!(job.id, initial.id);
            assert_eq!(job.attempts, attempt);
            finish(&pool, &job, Err(Error::Unavailable("Trip manager")))
                .await
                .unwrap();
            sqlx::query(
                "UPDATE trip_planning_jobs SET available_at=now()-interval '1 second' WHERE id=$1",
            )
            .bind(initial.id)
            .execute(&pool)
            .await
            .unwrap();
        }
        assert!(claim(&pool).await.unwrap().is_none());
        let job = load(&pool, &subject, "trip").await.unwrap().unwrap();
        assert_eq!(job.status, "failed");
        assert_eq!(job.error_code.as_deref(), Some("unavailable"));
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn cancel_and_read_are_user_scoped_and_cancel_fences_the_worker() {
        let _guard = JOB_TESTS.lock().await;
        let (pool, subject, revision, input) = fixture().await;
        let initial = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        let job = claim(&pool).await.unwrap().unwrap();
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        Arc::get_mut(&mut state).unwrap().database =
            Some(crate::database::Database { pool: pool.clone() });
        assert!(matches!(
            get(
                State(state.clone()),
                Extension(customer("other")),
                Path("trip".into())
            )
            .await,
            Err(Error::NotFound)
        ));
        assert!(matches!(
            cancel(
                State(state.clone()),
                Extension(customer("other")),
                Path("trip".into()),
                Json(Cancellation { id: initial.id })
            )
            .await,
            Err(Error::NotFound)
        ));
        assert_eq!(
            load(&pool, &subject, "trip").await.unwrap().unwrap().status,
            "running"
        );
        cancel(
            State(state),
            Extension(customer(&subject)),
            Path("trip".into()),
            Json(Cancellation { id: initial.id }),
        )
        .await
        .unwrap();
        assert!(!finish(&pool, &job, Ok(serde_json::json!({"late":true})))
            .await
            .unwrap());
        assert_eq!(
            load(&pool, &subject, "trip").await.unwrap().unwrap().status,
            "cancelled"
        );
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn changed_profile_prevents_processing_and_hides_stale_results() {
        let _guard = JOB_TESTS.lock().await;
        let (pool, subject, revision, input) = fixture().await;
        let job = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        sqlx::query("UPDATE personal_trip_profiles SET revision=$2 WHERE subject=$1")
            .bind(&subject)
            .bind(Uuid::now_v7())
            .execute(&pool)
            .await
            .unwrap();
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        Arc::get_mut(&mut state).unwrap().database =
            Some(crate::database::Database { pool: pool.clone() });
        assert!(process(&state).await.unwrap());
        assert!(load(&pool, &subject, "trip").await.unwrap().is_none());
        let outcome: (String, String) =
            sqlx::query_as("SELECT status,error_code FROM trip_planning_jobs WHERE id=$1")
                .bind(job.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(outcome, ("failed".into(), "profile_changed".into()));
    }
    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn real_worker_persists_a_later_success_after_transient_http_failure() {
        let _guard = JOB_TESTS.lock().await;
        use std::sync::atomic::{AtomicUsize, Ordering};
        let (pool, subject, revision, input) = fixture().await;
        let initial = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        let manager = crate::trip_manager::tests::manager_at("http://unused");
        let identity = manager.personal_identity(&subject, "trip").unwrap();
        let counter = Arc::new(AtomicUsize::new(0));
        let calls = counter.clone();
        let app=axum::Router::new().route("/v1/trip-manager",axum::routing::post(move || {
            let attempt=calls.fetch_add(1,Ordering::SeqCst);
            let identity=identity.clone();
            async move {
                if attempt==0 {(StatusCode::SERVICE_UNAVAILABLE,Json(serde_json::json!({"detail":"temporary"})))}
                else {(StatusCode::OK,Json(serde_json::json!({"manager_id":identity,"profile_revision":revision,"review_run_ids":["pre","post"]})))}
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        let writable = Arc::get_mut(&mut state).unwrap();
        writable.database = Some(crate::database::Database { pool: pool.clone() });
        writable.trip_manager = Some(crate::trip_manager::tests::manager_at(&origin));
        assert!(process(&state).await.unwrap());
        assert_eq!(
            load(&pool, &subject, "trip").await.unwrap().unwrap().status,
            "queued"
        );
        sqlx::query(
            "UPDATE trip_planning_jobs SET available_at=now()-interval '1 second' WHERE id=$1",
        )
        .bind(initial.id)
        .execute(&pool)
        .await
        .unwrap();
        assert!(process(&state).await.unwrap());
        let job = load(&pool, &subject, "trip").await.unwrap().unwrap();
        assert_eq!(job.status, "completed");
        assert_eq!(job.attempts, 2);
        assert_eq!(
            job.result.unwrap()["review_run_ids"],
            serde_json::json!(["pre", "post"])
        );
        assert_eq!(counter.load(Ordering::SeqCst), 2);
        server.abort();
        let _ = server.await;
    }
    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn expired_jobs_are_terminal_even_when_workers_are_offline() {
        let _guard = JOB_TESTS.lock().await;
        let (pool, subject, revision, input) = fixture().await;
        let job = enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE trip_planning_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
        )
        .bind(job.id)
        .execute(&pool)
        .await
        .unwrap();
        let visible = load(&pool, &subject, "trip").await.unwrap().unwrap();
        assert_eq!(visible.status, "failed");
        assert_eq!(visible.error_code.as_deref(), Some("expired"));
    }
    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn per_user_capacity_does_not_allow_more_than_two_active_trips() {
        let _guard = JOB_TESTS.lock().await;
        let (pool, subject, revision, input) = fixture().await;
        enqueue(&pool, &subject, "trip", revision, &input)
            .await
            .unwrap();
        for trip in ["second", "third"] {
            sqlx::query("INSERT INTO personal_trip_profiles(subject,trip_id,revision,preferences) VALUES($1,$2,$3,'{}')").bind(&subject).bind(trip).bind(revision).execute(&pool).await.unwrap();
        }
        enqueue(&pool, &subject, "second", revision, &input)
            .await
            .unwrap();
        let third = enqueue(&pool, &subject, "third", revision, &input).await;
        sqlx::query(
            "UPDATE trip_planning_jobs SET status='cancelled' WHERE subject=$1 AND status='queued'",
        )
        .bind(&subject)
        .execute(&pool)
        .await
        .unwrap();
        assert!(matches!(third, Err(Error::Busy)));
        use axum::response::IntoResponse;
        let response = third.unwrap_err().into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        let bytes = axum::body::to_bytes(response.into_body(), 8192)
            .await
            .unwrap();
        assert!(!String::from_utf8(bytes.to_vec())
            .unwrap()
            .contains("memories"));
    }
}
