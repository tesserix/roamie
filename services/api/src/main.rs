mod account_deletion;
mod accounts;
mod audio;
#[cfg(test)]
mod audit_tests;
mod auth;
#[cfg(test)]
mod auth_tests;
mod cache;
mod database;
mod decisions;
mod destinations;
mod documents;
mod error;
mod fx;
mod gateway;
mod gemini;
mod group_budget;
mod group_budget_api;
mod lang;
mod mail;
mod memories;
mod money;
mod nearby;
mod ocr;
mod phrasebook;
mod planning_jobs;
mod privacy;
mod receipts;
mod signs;
mod speech;
mod statements;
mod talk;
#[cfg(test)]
mod tests;
mod translate;
mod travel_mcp;
mod travel_profiles;
mod trip_manager;
mod trips;

use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Extension, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use error::{Error, Result};

struct AppState {
    mail: Option<mail::Sender>,
    trip_manager: Option<trip_manager::Manager>,
    travel_mcp_key: Option<String>,
    auth: Option<auth::Verifier>,
    development_auth_disabled: bool,
    database: Option<database::Database>,
    http: reqwest::Client,
    ai: Option<gemini::Gemini>,
    fx: fx::Fx,
    places: Option<nearby::Places>,
    ocr: Option<ocr::Ocr>,
    jev: Option<decisions::Jev>,
    memories: memories::Renderer,
    audio: audio::Gate,
    talk_turns: cache::Recent<talk::TurnResponse>,
    text_translations: cache::Recent<translate::TextResponse>,
    phrasebook: Option<phrasebook::Phrasebook>,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let development_auth_disabled =
        auth::development_mode(&env_or("AUTH_ENABLED", "true"), cfg!(debug_assertions))?;
    let database = database::Database::from_env(development_auth_disabled).await?;
    anyhow::ensure!(
        cfg!(debug_assertions) || database.is_some(),
        "database configuration required in release builds"
    );
    if std::env::args().nth(1).as_deref() == Some("migrate") {
        database
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("database configuration required"))?
            .migrate()
            .await?;
        tracing::info!("database migrations complete");
        return Ok(());
    }
    let auth = if development_auth_disabled {
        None
    } else {
        Some(auth::Verifier::new(auth::Config::from_env()?)?)
    };
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()?;
    let gateway = gateway::Gateway::from_env()?;
    anyhow::ensure!(
        cfg!(debug_assertions) || gateway.is_some(),
        "AI_GATEWAY_ORIGIN required in release builds"
    );
    let model = match &gateway {
        Some(_) => gemini::GATEWAY_MODEL.to_owned(),
        None => env_or("GEMINI_MODEL", "gemini-2.5-flash"),
    };
    let ai = if let Some(gateway) = gateway.clone() {
        Some(gemini::Gemini::with_gateway(gateway))
    } else {
        gemini::Gemini::new(
            http.clone(),
            &env_or("GCP_PROJECT", "tesseracthub-480811"),
            &env_or("VERTEX_LOCATION", "global"),
            &model,
        )
        .await
        .inspect_err(|_| tracing::warn!("development model credentials unavailable"))
        .ok()
    };
    let places = std::env::var("PLACES_API_KEY")
        .ok()
        .filter(|k| !k.is_empty())
        .map(|key| nearby::Places {
            key,
            base: nearby::PLACES_BASE.into(),
        });
    if places.is_none() {
        tracing::warn!("PLACES_API_KEY unset; nearby will return 503");
    }
    let ocr = if std::env::var("OCR_UPLOAD_URL").is_ok() {
        Some(ocr_from_env(&http)?)
    } else {
        None
    };
    let jev = gateway.map(decisions::Jev::with_gateway);
    anyhow::ensure!(
        ocr.is_none() || jev.is_some(),
        "AI_GATEWAY_ORIGIN required when OCR is configured"
    );
    let phrasebook = database
        .as_ref()
        .map(|db| phrasebook::Phrasebook::new(db.pool.clone(), &model));
    audio::check_runtime().expect("speech detection runtime must initialize");
    let state = Arc::new(AppState {
        mail: mail::Sender::from_env()?,
        trip_manager: trip_manager::Manager::from_env()?,
        travel_mcp_key: std::env::var("TRAVEL_MCP_API_KEY").ok(),
        auth,
        development_auth_disabled,
        database,
        ocr,
        jev,
        http,
        ai,
        fx: fx::Fx::new(fx::FX_BASE),
        places,
        memories: memories::Renderer::new(),
        audio: audio::Gate::new(),
        talk_turns: cache::Recent::default(),
        text_translations: cache::Recent::default(),
        phrasebook,
    });

    let host = if development_auth_disabled {
        "127.0.0.1"
    } else {
        "0.0.0.0"
    };
    let addr = format!("{host}:{}", env_or("PORT", "8080"));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "roamie-api listening");
    let (jobs_stop, jobs_shutdown) = tokio::sync::watch::channel(false);
    let mail = tokio::spawn(mail::run(state.clone(), jobs_shutdown.clone()));
    let jobs = tokio::spawn(planning_jobs::run(state.clone(), jobs_shutdown));
    let served = axum::serve(listener, router(state))
        .with_graceful_shutdown(async move {
            shutdown().await;
            let _ = jobs_stop.send(true);
        })
        .await;
    jobs.await?;
    mail.await?;
    served?;
    Ok(())
}

fn timeout(seconds: u64) -> TimeoutLayer {
    TimeoutLayer::with_status_code(StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(seconds))
}

fn router(state: Arc<AppState>) -> Router {
    let v1 = Router::new()
        .route(
            "/groups",
            get(group_budget_api::list)
                .post(group_budget_api::create)
                .layer(RequestBodyLimitLayer::new(8192)),
        )
        .route("/groups/{id}", get(group_budget_api::get))
        .route("/groups/{id}/join", post(group_budget_api::join))
        .route(
            "/groups/{id}/commands",
            post(group_budget_api::command).layer(RequestBodyLimitLayer::new(16384)),
        )
        .route(
            "/trips/{trip}/planning",
            get(planning_jobs::get)
                .post(planning_jobs::start)
                .delete(planning_jobs::cancel)
                .layer(RequestBodyLimitLayer::new(32768)),
        )
        .route(
            "/trips/{trip}/profile",
            get(travel_profiles::get)
                .put(travel_profiles::put)
                .layer(RequestBodyLimitLayer::new(32768)),
        )
        .route("/talk/turn", post(talk_turn))
        .route(
            "/talk/speech",
            post(speech::synthesize).layer(RequestBodyLimitLayer::new(8192)),
        )
        .route("/translate/text", post(translate_text))
        .route("/destinations/search", post(destinations::search))
        .route("/nearby", get(nearby_search))
        .route("/fx", get(fx_latest))
        .route("/auth/me", get(accounts::me))
        .route("/auth/audit", get(accounts::audit))
        .route(
            "/auth/deletion-request",
            get(account_deletion::get)
                .post(account_deletion::create)
                .layer(RequestBodyLimitLayer::new(1024)),
        )
        .route("/reference/trip-styles", get(accounts::styles))
        .route("/trips/plan", post(trips::plan))
        .route("/memories/capabilities", post(memories::capabilities))
        .layer(timeout(60))
        .layer(axum::extract::DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(RequestBodyLimitLayer::new(12 * 1024 * 1024))
        .route(
            "/trip-manager",
            post(trip_manager::recommend)
                .layer::<_, std::convert::Infallible>(RequestBodyLimitLayer::new(32768))
                .layer(timeout(90)),
        )
        .route(
            "/signs/translate",
            post(sign_translate)
                .layer::<_, std::convert::Infallible>(axum::extract::DefaultBodyLimit::max(
                    12 * 1024 * 1024,
                ))
                .layer::<_, std::convert::Infallible>(RequestBodyLimitLayer::new(12 * 1024 * 1024))
                .layer(timeout(90)),
        )
        .route(
            "/receipts/extract",
            post(receipt_extract)
                .layer::<_, std::convert::Infallible>(axum::extract::DefaultBodyLimit::max(
                    12 * 1024 * 1024,
                ))
                .layer::<_, std::convert::Infallible>(RequestBodyLimitLayer::new(12 * 1024 * 1024))
                .layer(timeout(90)),
        )
        .route(
            "/statements/extract",
            post(statement_extract)
                .layer::<_, std::convert::Infallible>(axum::extract::DefaultBodyLimit::max(
                    12 * 1024 * 1024,
                ))
                .layer::<_, std::convert::Infallible>(RequestBodyLimitLayer::new(12 * 1024 * 1024))
                .layer(timeout(90)),
        )
        // Rendering outlasts the standard budget but must finish inside Cloudflare's 100s origin limit.
        .route(
            "/memories/render",
            post(memories::render)
                .layer::<_, std::convert::Infallible>(axum::extract::DefaultBodyLimit::max(
                    18 * 1024 * 1024,
                ))
                .layer::<_, std::convert::Infallible>(RequestBodyLimitLayer::new(18 * 1024 * 1024))
                .layer(timeout(90)),
        )
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::require_customer,
        ));
    Router::new()
        .route("/internal/v1/travel/nearby", get(travel_mcp::nearby))
        .route("/internal/v1/travel/planning", get(travel_mcp::planning))
        .route(
            "/internal/v1/travel/profile/verify",
            post(travel_profiles::verify).layer(RequestBodyLimitLayer::new(32768)),
        )
        .route("/privacy", get(privacy::privacy))
        .route("/account-deletion", get(privacy::account_deletion))
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readiness))
        .route("/v1/auth/config", get(auth::configuration))
        .layer(timeout(60))
        .layer(RequestBodyLimitLayer::new(12 * 1024 * 1024))
        .nest("/v1", v1)
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

fn ocr_from_env(http: &reqwest::Client) -> anyhow::Result<ocr::Ocr> {
    let var = |k: &str| std::env::var(k).map_err(|_| anyhow::anyhow!("{k} unset"));
    let tenant = env_or("OCR_TENANT", "ten_roamie_public");
    anyhow::ensure!(
        ocr::valid_tenant(&tenant),
        "OCR_TENANT must match ten_[A-Za-z0-9_]{{1,64}}"
    );
    Ok(ocr::Ocr {
        http: http.clone(),
        upload_base: var("OCR_UPLOAD_URL")?,
        job_base: var("OCR_JOB_URL")?,
        key_id: var("OCR_KEY_ID")?,
        secret: hex::decode(var("OCR_KEY_SECRET")?.trim())?,
        tenant,
        deadline: Duration::from_secs(env_or("OCR_DEADLINE_SECS", "40").parse()?),
        owner: None,
    })
}

async fn shutdown() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install ctrl-c handler")
    };
    let term = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}

async fn talk_turn(
    State(s): State<Arc<AppState>>,
    Extension(customer): Extension<auth::Customer>,
    Json(req): Json<talk::TurnRequest>,
) -> Result<Json<talk::TurnResponse>> {
    req.utterance()?;
    if let Some(audio) = &req.audio {
        s.audio.verify(audio).await?;
    }
    let ai = s.ai.as_ref().ok_or(Error::Unavailable("Translation"))?;
    let key = req.cache_key().map(|k| cache::key(&customer.sub, &k));
    if let Some(hit) = key.as_ref().and_then(|k| s.talk_turns.get(k)) {
        return Ok(Json(hit));
    }
    let turn = talk::interpret(ai, s.jev.as_ref(), &req).await?;
    if let Some(book) = &s.phrasebook {
        book.for_customer(&customer.sub)
            .remember(vec![turn.phrase()]);
    }
    if let Some(key) = key {
        s.talk_turns.put(key, turn.clone());
    }
    Ok(Json(turn))
}

async fn translate_text(
    State(s): State<Arc<AppState>>,
    Extension(customer): Extension<auth::Customer>,
    Json(req): Json<translate::TextRequest>,
) -> Result<Json<translate::TextResponse>> {
    let ai = s.ai.as_ref().ok_or(Error::Unavailable("Translation"))?;
    let key = cache::key(&customer.sub, &req.cache_key());
    if let Some(hit) = s.text_translations.get(&key) {
        return Ok(Json(hit));
    }
    let book = s
        .phrasebook
        .as_ref()
        .map(|book| book.for_customer(&customer.sub));
    let translated = translate::text(ai, book.as_ref(), &req).await?;
    s.text_translations.put(key, translated.clone());
    Ok(Json(translated))
}

async fn sign_translate(
    State(s): State<Arc<AppState>>,
    Extension(customer): Extension<auth::Customer>,
    Json(req): Json<signs::SignRequest>,
) -> Result<Json<signs::SignResponse>> {
    let (Some(ocr), Some(jev), Some(ai)) = (s.ocr.as_ref(), s.jev.as_ref(), s.ai.as_ref()) else {
        return Err(Error::Unavailable("Photo translation"));
    };
    let ocr = customer_ocr(&s, ocr, &customer.sub)?;
    let translated = signs::translate(&ocr, jev, ai, &req).await?;
    if let Some(book) = &s.phrasebook {
        book.for_customer(&customer.sub)
            .remember(translated.phrases(&req.to));
    }
    Ok(Json(translated))
}

async fn receipt_extract(
    State(s): State<Arc<AppState>>,
    Extension(customer): Extension<auth::Customer>,
    Json(req): Json<receipts::ReceiptRequest>,
) -> Result<Json<receipts::Receipt>> {
    let ai =
        s.ai.as_ref()
            .ok_or(Error::Unavailable("Receipt scanning"))?;
    let ocr = s
        .ocr
        .as_ref()
        .map(|ocr| customer_ocr(&s, ocr, &customer.sub))
        .transpose()?;
    Ok(Json(
        receipts::extract(ai, ocr.as_ref(), s.jev.as_ref(), &req).await?,
    ))
}

async fn statement_extract(
    State(s): State<Arc<AppState>>,
    Extension(customer): Extension<auth::Customer>,
    Json(req): Json<statements::StatementRequest>,
) -> Result<Json<statements::Statement>> {
    let ai =
        s.ai.as_ref()
            .ok_or(Error::Unavailable("Statement import"))?;
    let ocr = s
        .ocr
        .as_ref()
        .map(|ocr| customer_ocr(&s, ocr, &customer.sub))
        .transpose()?;
    Ok(Json(
        statements::extract(ai, ocr.as_ref(), s.jev.as_ref(), &req).await?,
    ))
}

fn customer_ocr(state: &AppState, ocr: &ocr::Ocr, subject: &str) -> Result<ocr::Ocr> {
    match &state.database {
        Some(db) => Ok(ocr.for_customer(db.pool.clone(), subject)),
        None if cfg!(debug_assertions) && state.development_auth_disabled => Ok(ocr.clone()),
        None => Err(Error::Unavailable("Document ownership storage")),
    }
}

async fn nearby_search(
    State(s): State<Arc<AppState>>,
    Query(q): Query<nearby::Query>,
) -> Result<Json<nearby::Results>> {
    let places = s.places.as_ref().ok_or(Error::Unavailable("Nearby"))?;
    Ok(Json(nearby::search(&s.http, places, &q).await?))
}

#[derive(Deserialize)]
struct FxQuery {
    base: money::Currency,
}

async fn fx_latest(
    State(s): State<Arc<AppState>>,
    Query(q): Query<FxQuery>,
) -> Result<Json<fx::Rates>> {
    Ok(Json(s.fx.latest(&s.http, q.base).await?))
}

async fn readiness(State(state): State<Arc<AppState>>) -> StatusCode {
    match &state.database {
        Some(database) if !database.healthy().await => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::OK,
    }
}
