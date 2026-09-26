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
    if authorized(&state, &headers).is_none() {
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

fn authorized(state: &AppState, headers: &HeaderMap) -> Option<()> {
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
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanningQuery {
    destination: String,
}

pub async fn planning(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PlanningQuery>,
) -> std::result::Result<Json<serde_json::Value>, axum::response::Response> {
    use axum::response::IntoResponse;
    if authorized(&state, &headers).is_none() {
        return Err(AuthError::Required.into_response());
    }
    if query.destination.trim().is_empty()
        || query.destination.len() > 200
        || query.destination.chars().any(char::is_control)
    {
        return Err(crate::Error::Invalid("Choose a valid destination.".into()).into_response());
    }
    let mut places = Vec::new();
    for (kind, search) in [
        ("activities", "tourist attractions"),
        ("food", "restaurants"),
        ("accommodation", "hotels"),
    ] {
        let found =
            crate::trips::search_places(&state, &format!("{search} in {}", query.destination))
                .await
                .map_err(IntoResponse::into_response)?;
        for place in found.into_values() {
            places.push(serde_json::json!({"id":place.id,"name":place.name,"mapsUri":place.maps_uri,"lat":place.lat,"lng":place.lng,"kind":kind}));
        }
    }
    Ok(Json(serde_json::json!({"places":places})))
}
