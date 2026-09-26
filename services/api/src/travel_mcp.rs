use crate::{auth::AuthError, nearby, AppState};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap},
    Json,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;

pub async fn nearby(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<nearby::Query>,
) -> std::result::Result<Json<nearby::Results>, axum::response::Response> {
    use axum::response::IntoResponse;
    let authorize = || -> Option<()> {
        let key = state
            .travel_mcp_key
            .as_ref()
            .filter(|key| key.len() >= 32)?;
        let value = headers
            .get(header::AUTHORIZATION)?
            .to_str()
            .ok()?
            .strip_prefix("Bearer ")?;
        if value.len() > 1024 {
            return None;
        }
        let mut expected = Hmac::<Sha256>::new_from_slice(key.as_bytes()).ok()?;
        expected.update(key.as_bytes());
        let mut supplied = Hmac::<Sha256>::new_from_slice(key.as_bytes()).ok()?;
        supplied.update(value.as_bytes());
        supplied
            .verify_slice(&expected.finalize().into_bytes())
            .ok()
    };
    if authorize().is_none() {
        return Err(AuthError::Required.into_response());
    }
    let places = state
        .places
        .as_ref()
        .ok_or_else(|| crate::Error::Unavailable("Nearby").into_response())?;
    nearby::search(&state.http, places, &query)
        .await
        .map(Json)
        .map_err(IntoResponse::into_response)
}
