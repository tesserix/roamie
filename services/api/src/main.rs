mod accounts;
#[cfg(test)]
mod audit_tests;
mod auth;
#[cfg(test)]
mod auth_tests;
mod database;
mod error;
mod fx;
mod gemini;
mod lang;
mod money;
mod nearby;
mod ocr;
mod receipts;
mod signs;
mod talk;
#[cfg(test)]
mod tests;
mod translate;
mod travel_mcp;
mod trip_manager;

use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use error::{Error, Result};

struct AppState {
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
    let ai = gemini::Gemini::new(
        http.clone(),
        &env_or("GCP_PROJECT", "tesseracthub-480811"),
        &env_or("VERTEX_LOCATION", "global"),
        &env_or("GEMINI_MODEL", "gemini-2.5-flash"),
    )
    .await
    .inspect_err(
        |e| tracing::warn!(error = %e, "no Google credentials; talk and receipts will return 503"),
    )
    .ok();
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
    let ocr = ocr_from_env(&http)
        .inspect_err(
            |e| tracing::warn!(error = %e, "OCR not configured; sign translation will return 503"),
        )
        .ok();
    let state = Arc::new(AppState {
        trip_manager: trip_manager::Manager::from_env()?,
        travel_mcp_key: std::env::var("TRAVEL_MCP_API_KEY").ok(),
        auth,
        development_auth_disabled,
        database,
        ocr,
        http,
        ai,
        fx: fx::Fx::new(fx::FX_BASE),
        places,
    });

    let host = if development_auth_disabled {
        "127.0.0.1"
    } else {
        "0.0.0.0"
    };
    let addr = format!("{host}:{}", env_or("PORT", "8080"));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "roamie-api listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

fn router(state: Arc<AppState>) -> Router {
    let v1 = Router::new()
        .route(
            "/trip-manager",
            post(trip_manager::recommend).layer(RequestBodyLimitLayer::new(32768)),
        )
        .route("/talk/turn", post(talk_turn))
        .route("/translate/text", post(translate_text))
        .route("/signs/translate", post(sign_translate))
        .route("/receipts/extract", post(receipt_extract))
        .route("/nearby", get(nearby_search))
        .route("/fx", get(fx_latest))
        .route("/auth/me", get(accounts::me))
        .route("/auth/audit", get(accounts::audit))
        .route("/reference/trip-styles", get(accounts::styles))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::require_customer,
        ));
    Router::new()
        .route("/internal/v1/travel/nearby", get(travel_mcp::nearby))
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readiness))
        .route("/v1/auth/config", get(auth::configuration))
        .nest("/v1", v1)
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(12 * 1024 * 1024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            Duration::from_secs(60),
        ))
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
    Json(req): Json<talk::TurnRequest>,
) -> Result<Json<talk::TurnResponse>> {
    let ai = s.ai.as_ref().ok_or(Error::Unavailable("Translation"))?;
    Ok(Json(talk::interpret(ai, &req).await?))
}

async fn translate_text(
    State(s): State<Arc<AppState>>,
    Json(req): Json<translate::TextRequest>,
) -> Result<Json<translate::TextResponse>> {
    let ai = s.ai.as_ref().ok_or(Error::Unavailable("Translation"))?;
    Ok(Json(translate::text(ai, &req).await?))
}

async fn sign_translate(
    State(s): State<Arc<AppState>>,
    Json(req): Json<signs::SignRequest>,
) -> Result<Json<signs::SignResponse>> {
    let (Some(ocr), Some(ai)) = (s.ocr.as_ref(), s.ai.as_ref()) else {
        return Err(Error::Unavailable("Photo translation"));
    };
    Ok(Json(signs::translate(ocr, ai, &req).await?))
}

async fn receipt_extract(
    State(s): State<Arc<AppState>>,
    Json(req): Json<receipts::ReceiptRequest>,
) -> Result<Json<receipts::Receipt>> {
    let ai =
        s.ai.as_ref()
            .ok_or(Error::Unavailable("Receipt scanning"))?;
    Ok(Json(receipts::extract(ai, &req).await?))
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
