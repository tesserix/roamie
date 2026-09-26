use crate::{
    error::{Error, Result},
    AppState,
};
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Search {
    query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Destination {
    pub place_id: String,
    pub name: String,
    pub label: String,
    pub country_code: String,
    pub country: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub latitude: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub longitude: Option<f64>,
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    Json(input): Json<Search>,
) -> Result<Json<Vec<Destination>>> {
    let query = input.query.trim();
    if query.chars().count() < 2 || query.len() > 160 || query.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "Enter a destination of 2–160 characters.".into(),
        ));
    }
    let config = state
        .places
        .as_ref()
        .ok_or(Error::Unavailable("Destination search"))?;
    let response = state
        .http
        .post(format!("{}/places:searchText", config.base))
        .timeout(std::time::Duration::from_secs(10))
        .header("X-Goog-Api-Key", &config.key)
        .header(
            "X-Goog-FieldMask",
            "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location",
        )
        .json(&json!({"textQuery":query,"pageSize":5,"languageCode":"en"}))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(Error::Upstream("destination search unavailable".into()));
    }
    let data: Value = response.json().await?;
    let mut destinations = Vec::new();
    for place in data["places"].as_array().into_iter().flatten().take(5) {
        let country = place["addressComponents"].as_array().and_then(|parts| {
            parts.iter().find(|part| {
                part["types"]
                    .as_array()
                    .is_some_and(|types| types.iter().any(|kind| kind == "country"))
            })
        });
        let Some(country) = country else { continue };
        let (Some(id), Some(name), Some(label), Some(code), Some(country_name)) = (
            place["id"].as_str(),
            place["displayName"]["text"].as_str(),
            place["formattedAddress"].as_str(),
            country["shortText"].as_str(),
            country["longText"].as_str(),
        ) else {
            continue;
        };
        if id.is_empty()
            || id.len() > 200
            || name.is_empty()
            || name.len() > 160
            || label.is_empty()
            || label.len() > 160
            || code.len() != 2
            || !code.bytes().all(|b| b.is_ascii_uppercase())
            || country_name.is_empty()
            || country_name.len() > 100
        {
            continue;
        }
        if destinations.iter().any(|d: &Destination| d.place_id == id) {
            continue;
        }
        destinations.push(Destination {
            place_id: id.into(),
            name: name.into(),
            label: label.into(),
            country_code: code.into(),
            country: country_name.into(),
            latitude: place["location"]["latitude"]
                .as_f64()
                .filter(|v| (-90.0..=90.0).contains(v)),
            longitude: place["location"]["longitude"]
                .as_f64()
                .filter(|v| (-180.0..=180.0).contains(v)),
        });
    }
    Ok(Json(destinations))
}
