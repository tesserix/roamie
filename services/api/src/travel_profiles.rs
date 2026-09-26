use crate::{
    auth::Customer,
    error::{Error, Result},
    AppState,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    allergies: Vec<String>,
    diets: Vec<String>,
    budget_minor: Option<i64>,
    #[serde(default = "default_currency")]
    currency: String,
    accessibility_requirements: Vec<String>,
    preferences: Vec<String>,
    #[serde(default = "default_language")]
    language: String,
    start_date: Option<String>,
    end_date: Option<String>,
    photo_consent: bool,
    selected_photo_ids: Vec<String>,
}
fn default_currency() -> String {
    "AUD".into()
}
fn default_language() -> String {
    "en".into()
}
impl Preferences {
    fn validate(&self) -> Result<()> {
        let list_ok = |values: &[String], limit: usize| {
            values.len() <= limit
                && values.iter().all(|v| {
                    !v.trim().is_empty() && v.len() <= 200 && !v.chars().any(char::is_control)
                })
        };
        if !list_ok(&self.allergies, 20)
            || !list_ok(&self.diets, 12)
            || !list_ok(&self.accessibility_requirements, 12)
            || !list_ok(&self.preferences, 20)
            || !list_ok(&self.selected_photo_ids, 15)
            || self.currency.len() != 3
            || !self.currency.bytes().all(|b| b.is_ascii_uppercase())
            || !(2..=35).contains(&self.language.len())
            || self.budget_minor.is_some_and(|v| v < 0)
        {
            return Err(Error::Invalid("Invalid travel preferences.".into()));
        }
        for date in [&self.start_date, &self.end_date].into_iter().flatten() {
            time::Date::parse(
                date,
                time::macros::format_description!("[year]-[month]-[day]"),
            )
            .map_err(|_| Error::Invalid("Invalid travel dates.".into()))?;
        }
        if matches!((&self.start_date,&self.end_date),(Some(start),Some(end)) if end<start) {
            return Err(Error::Invalid("Trip ends before it starts.".into()));
        }
        if !self.photo_consent && !self.selected_photo_ids.is_empty() {
            return Err(Error::Invalid("Photo consent is required.".into()));
        }
        Ok(())
    }
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    expected_revision: Option<Uuid>,
    preferences: Preferences,
}
#[derive(Debug, Serialize)]
pub struct SavedProfile {
    pub trip_id: String,
    pub revision: Uuid,
    pub preferences: Preferences,
}
impl SavedProfile {
    pub fn snapshot(&self) -> Result<serde_json::Map<String, Value>> {
        let mut value = serde_json::to_value(&self.preferences)
            .map_err(|_| Error::Unavailable("Profile storage"))?
            .as_object()
            .cloned()
            .ok_or(Error::Unavailable("Profile storage"))?;
        value.insert("trip_id".into(), Value::String(self.trip_id.clone()));
        value.insert("revision".into(), Value::String(self.revision.to_string()));
        Ok(value)
    }
}
fn pool(state: &AppState) -> Result<&PgPool> {
    state
        .database
        .as_ref()
        .map(|db| &db.pool)
        .ok_or(Error::Unavailable("Profile storage"))
}
fn validate_trip(trip: &str) -> Result<()> {
    if trip.is_empty() || trip.len() > 120 || trip.chars().any(char::is_control) {
        return Err(Error::Invalid("Invalid trip identity.".into()));
    }
    Ok(())
}
pub async fn load(pool: &PgPool, subject: &str, trip: &str) -> Result<SavedProfile> {
    validate_trip(trip)?;
    let row: Option<(Uuid, Value)> = sqlx::query_as(
        "SELECT revision, preferences FROM personal_trip_profiles WHERE subject=$1 AND trip_id=$2",
    )
    .bind(subject)
    .bind(trip)
    .fetch_optional(pool)
    .await?;
    let (revision, preferences) = row.ok_or(Error::ProfileChanged)?;
    let preferences: Preferences =
        serde_json::from_value(preferences).map_err(|_| Error::Unavailable("Profile storage"))?;
    preferences.validate()?;
    Ok(SavedProfile {
        trip_id: trip.into(),
        revision,
        preferences,
    })
}
pub async fn save(
    pool: &PgPool,
    subject: &str,
    trip: &str,
    input: SaveRequest,
) -> Result<SavedProfile> {
    validate_trip(trip)?;
    input.preferences.validate()?;
    let revision = Uuid::now_v7();
    let preferences = serde_json::to_value(&input.preferences)
        .map_err(|_| Error::Invalid("Invalid preferences.".into()))?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(subject)
        .execute(&mut *tx)
        .await?;
    let updated = if let Some(expected) = input.expected_revision {
        sqlx::query("UPDATE personal_trip_profiles SET preferences=$3, revision=$4, updated_at=now() WHERE subject=$1 AND trip_id=$2 AND revision=$5")
            .bind(subject).bind(trip).bind(&preferences).bind(revision).bind(expected).execute(&mut *tx).await?.rows_affected()
    } else {
        sqlx::query("INSERT INTO personal_trip_profiles(subject,trip_id,preferences,revision) VALUES($1,$2,$3,$4) ON CONFLICT(subject,trip_id) DO NOTHING")
            .bind(subject).bind(trip).bind(&preferences).bind(revision).execute(&mut *tx).await?.rows_affected()
    };
    if updated != 1 {
        return Err(Error::ProfileChanged);
    }
    tx.commit().await?;
    Ok(SavedProfile {
        trip_id: trip.into(),
        revision,
        preferences: input.preferences,
    })
}
pub async fn get(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(trip): Path<String>,
) -> Result<impl axum::response::IntoResponse> {
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(load(pool(&state)?, &customer.sub, &trip).await?),
    ))
}
pub async fn put(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(trip): Path<String>,
    Json(input): Json<SaveRequest>,
) -> Result<impl axum::response::IntoResponse> {
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(save(pool(&state)?, &customer.sub, &trip, input).await?),
    ))
}

pub async fn verify(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(profile): Json<Value>,
) -> std::result::Result<impl axum::response::IntoResponse, axum::response::Response> {
    use axum::response::IntoResponse;
    if !state
        .trip_manager
        .as_ref()
        .is_some_and(|manager| manager.authenticate(&headers))
    {
        return Err(crate::auth::AuthError::Required.into_response());
    }
    async fn verified(state: &AppState, profile: Value) -> Result<Uuid> {
        let subject = profile
            .get("subject")
            .and_then(Value::as_str)
            .ok_or(Error::ProfileChanged)?;
        let trip = profile
            .get("trip_id")
            .and_then(Value::as_str)
            .ok_or(Error::ProfileChanged)?;
        let saved = load(pool(state)?, subject, trip).await?;
        let mut expected = saved.snapshot()?;
        expected.insert("subject".into(), Value::String(subject.into()));
        if Value::Object(expected) != profile {
            return Err(Error::ProfileChanged);
        }
        Ok(saved.revision)
    }
    let revision = verified(&state, profile)
        .await
        .map_err(IntoResponse::into_response)?;
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({"revision":revision})),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn client_cannot_set_profile_subject_or_revision() {
        assert!(serde_json::from_value::<Preferences>(json!({"subject":"victim"})).is_err());
        assert!(serde_json::from_value::<Preferences>(json!({"revision":"chosen"})).is_err());
    }

    #[test]
    fn preferences_reject_invalid_money_and_oversized_lists() {
        let negative: Preferences = serde_json::from_value(json!({"budget_minor":-1})).unwrap();
        assert!(negative.validate().is_err());
        let oversized: Preferences =
            serde_json::from_value(json!({"allergies":vec!["nuts";21]})).unwrap();
        assert!(oversized.validate().is_err());
        let valid: Preferences =
            serde_json::from_value(json!({"allergies":["peanuts"],"currency":"AUD"})).unwrap();
        assert!(valid.validate().is_ok());
    }
    #[tokio::test]
    #[ignore = "requires the isolated ROAMIE_TEST_DATABASE_URL; run in database CI"]
    async fn database_profiles_isolate_users_and_reject_stale_revisions() {
        use std::str::FromStr;
        let options = sqlx::postgres::PgConnectOptions::from_str(
            &std::env::var("ROAMIE_TEST_DATABASE_URL").expect("isolated test database"),
        )
        .unwrap();
        let db = crate::database::Database::connect(options).await.unwrap();
        db.migrate().await.unwrap();
        let first = format!("profile-test-{}", Uuid::now_v7());
        let second = format!("profile-test-{}", Uuid::now_v7());
        for subject in [&first, &second] {
            sqlx::query("INSERT INTO accounts(subject,issuer,email,display_name) VALUES($1,'https://auth.example',$2,'Test')").bind(subject).bind(format!("{subject}@example.test")).execute(&db.pool).await.unwrap();
        }
        let initial = SaveRequest {
            expected_revision: None,
            preferences: serde_json::from_value(json!({"allergies":["peanuts"]})).unwrap(),
        };
        let saved = save(&db.pool, &first, "same-trip", initial).await.unwrap();
        assert!(matches!(
            load(&db.pool, &second, "same-trip").await,
            Err(Error::ProfileChanged)
        ));
        let second_profile = save(
            &db.pool,
            &second,
            "same-trip",
            SaveRequest {
                expected_revision: None,
                preferences: serde_json::from_value(json!({"diets":["vegan"]})).unwrap(),
            },
        )
        .await
        .unwrap();
        let updated = save(
            &db.pool,
            &first,
            "same-trip",
            SaveRequest {
                expected_revision: Some(saved.revision),
                preferences: serde_json::from_value(json!({"allergies":["peanuts","sesame"]}))
                    .unwrap(),
            },
        )
        .await
        .unwrap();
        assert_ne!(updated.revision, saved.revision);
        assert_eq!(
            load(&db.pool, &second, "same-trip").await.unwrap().revision,
            second_profile.revision
        );
        assert!(matches!(
            save(
                &db.pool,
                &first,
                "same-trip",
                SaveRequest {
                    expected_revision: Some(saved.revision),
                    preferences: serde_json::from_value(json!({})).unwrap()
                }
            )
            .await,
            Err(Error::ProfileChanged)
        ));
        assert_eq!(
            load(&db.pool, &first, "same-trip")
                .await
                .unwrap()
                .preferences
                .allergies,
            vec!["peanuts", "sesame"]
        );
        assert!(matches!(
            save(
                &db.pool,
                &first,
                "same-trip",
                SaveRequest {
                    expected_revision: None,
                    preferences: serde_json::from_value(json!({})).unwrap()
                }
            )
            .await,
            Err(Error::ProfileChanged)
        ));
        let audits:i64 = sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE actor_subject=$1 AND entity_type='personal_trip_profiles'").bind(&first).fetch_one(&db.pool).await.unwrap();
        assert_eq!(audits, 2);
        for subject in [&first, &second] {
            sqlx::query("DELETE FROM accounts WHERE subject=$1")
                .bind(subject)
                .execute(&db.pool)
                .await
                .unwrap();
        }
    }
}
