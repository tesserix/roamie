mod error;
mod fx;
mod gemini;
mod lang;
mod money;
mod nearby;
mod receipts;
mod talk;

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
    http: reqwest::Client,
    ai: gemini::Gemini,
    fx: fx::Fx,
    places_key: Option<String>,
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

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()?;
    let ai = gemini::Gemini::new(
        http.clone(),
        &env_or("GCP_PROJECT", "tesseracthub-480811"),
        &env_or("VERTEX_LOCATION", "global"),
        &env_or("GEMINI_MODEL", "gemini-2.5-flash"),
    )
    .await?;
    let places_key = std::env::var("PLACES_API_KEY")
        .ok()
        .filter(|k| !k.is_empty());
    if places_key.is_none() {
        tracing::warn!("PLACES_API_KEY unset; nearby will return 503");
    }
    let state = Arc::new(AppState {
        http,
        ai,
        fx: fx::Fx::default(),
        places_key,
    });

    let v1 = Router::new()
        .route("/talk/turn", post(talk_turn))
        .route("/receipts/extract", post(receipt_extract))
        .route("/nearby", get(nearby_search))
        .route("/fx", get(fx_latest));
    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .nest("/v1", v1)
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(12 * 1024 * 1024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{}", env_or("PORT", "8080"));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "roamie-api listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
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
    Ok(Json(talk::interpret(&s.ai, &req).await?))
}

async fn receipt_extract(
    State(s): State<Arc<AppState>>,
    Json(req): Json<receipts::ReceiptRequest>,
) -> Result<Json<receipts::Receipt>> {
    Ok(Json(receipts::extract(&s.ai, &req).await?))
}

async fn nearby_search(
    State(s): State<Arc<AppState>>,
    Query(q): Query<nearby::Query>,
) -> Result<Json<nearby::Results>> {
    let key = s
        .places_key
        .as_deref()
        .ok_or(Error::Unavailable("Nearby"))?;
    Ok(Json(nearby::search(&s.http, key, &q).await?))
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
