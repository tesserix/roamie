use crate::{
    auth::Customer,
    error::{Error, Result},
    AppState,
};
use axum::{
    extract::State,
    http::{header, HeaderMap},
    Extension, Json,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;

pub struct Manager {
    origin: String,
    api_key: String,
    signing_key: String,
    gateway_token: String,
    identity_key: String,
    http: reqwest::Client,
    slots: Semaphore,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    profile: Map<String, Value>,
    specialist: String,
    request: Value,
}

impl Manager {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let Ok(origin) = std::env::var("TRIP_MANAGER_ORIGIN") else {
            return Ok(None);
        };
        let origin_url = reqwest::Url::parse(&origin)?;
        anyhow::ensure!(
            origin_url.as_str() == "http://roamie-trip-manager.roamie.svc.cluster.local:8080/",
            "trip manager origin must be the private service"
        );
        let required = |name: &str| -> anyhow::Result<String> {
            let value = std::env::var(name)?;
            anyhow::ensure!(value.len() >= 32, "{name} requires at least 32 characters");
            Ok(value)
        };
        Ok(Some(Self {
            origin: origin.trim_end_matches('/').into(),
            api_key: required("TRIP_MANAGER_API_KEY")?,
            signing_key: required("TRIP_MANAGER_SIGNING_KEY")?,
            gateway_token: required("TRIP_MANAGER_GATEWAY_TOKEN")?,
            identity_key: required("TRIP_MANAGER_IDENTITY_KEY")?,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(55))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            slots: Semaphore::new(8),
        }))
    }

    fn snapshot(
        &self,
        mut input: Request,
        subject: &str,
        now: u64,
    ) -> Result<(Vec<u8>, String, String)> {
        if input.profile.contains_key("subject") {
            return Err(Error::Invalid("Profile identity is server-managed.".into()));
        }
        let revision = input
            .profile
            .get("revision")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() <= 120)
            .ok_or_else(|| Error::Invalid("A current profile revision is required.".into()))?
            .to_owned();
        input
            .profile
            .insert("subject".into(), Value::String(subject.into()));
        let value = json!({"profile":input.profile,"specialist":input.specialist,"request":input.request,
            "issued_at":now,"expires_at":now+120,
            "delegated_identity_digest":hex::encode(Sha256::digest(self.gateway_token.as_bytes()))});
        let bytes =
            serde_json::to_vec(&value).map_err(|_| Error::Invalid("Invalid profile.".into()))?;
        if bytes.len() > 32768 {
            return Err(Error::Invalid("Profile is too large.".into()));
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(self.signing_key.as_bytes())
            .map_err(|_| Error::Unavailable("Trip manager"))?;
        mac.update(&bytes);
        Ok((bytes, hex::encode(mac.finalize().into_bytes()), revision))
    }

    fn personal_identity(&self, subject: &str, trip_id: &str) -> Result<String> {
        let material = serde_json::to_vec(&json!(["roamie", subject, trip_id]))
            .map_err(|_| Error::Unavailable("Trip manager"))?;
        let mut mac = Hmac::<Sha256>::new_from_slice(self.identity_key.as_bytes())
            .map_err(|_| Error::Unavailable("Trip manager"))?;
        mac.update(&material);
        Ok(format!(
            "trip-manager-{}",
            hex::encode(mac.finalize().into_bytes())
        ))
    }

    pub fn authenticate(&self, headers: &HeaderMap) -> bool {
        let Some(supplied) = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        else {
            return false;
        };
        if supplied.len() > 1024 {
            return false;
        }
        let Ok(mut expected) = Hmac::<Sha256>::new_from_slice(self.api_key.as_bytes()) else {
            return false;
        };
        expected.update(self.api_key.as_bytes());
        let Ok(mut verifier) = Hmac::<Sha256>::new_from_slice(self.api_key.as_bytes()) else {
            return false;
        };
        verifier.update(supplied.as_bytes());
        verifier
            .verify_slice(&expected.finalize().into_bytes())
            .is_ok()
    }

    async fn recommend(&self, input: Request, subject: &str) -> Result<Value> {
        let _permit = self
            .slots
            .try_acquire()
            .map_err(|_| Error::Unavailable("Trip manager"))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Unavailable("Trip manager"))?
            .as_secs();
        let trip_id = input
            .profile
            .get("trip_id")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::Invalid("Trip identity is required.".into()))?;
        let manager_id = self.personal_identity(subject, trip_id)?;
        let (bytes, signature, revision) = self.snapshot(input, subject, now)?;
        let mut reply = self
            .http
            .post(format!("{}/v1/trip-manager", self.origin))
            .bearer_auth(&self.api_key)
            .header("content-type", "application/json")
            .header("X-Roamie-Profile-Signature", signature)
            .header("X-Roamie-Gateway-Token", &self.gateway_token)
            .body(bytes)
            .send()
            .await
            .map_err(|_| Error::Unavailable("Trip manager"))?;
        if !reply.status().is_success() {
            return Err(Error::Unavailable("Trip manager"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = reply
            .chunk()
            .await
            .map_err(|_| Error::Unavailable("Trip manager"))?
        {
            if bytes.len() + chunk.len() > 131072 {
                return Err(Error::Unavailable("Trip manager"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| Error::Unavailable("Trip manager"))?;
        if value.get("profile_revision").and_then(Value::as_str) != Some(&revision)
            || value.get("manager_id").and_then(Value::as_str) != Some(&manager_id)
        {
            return Err(Error::Unavailable("Trip manager"));
        }
        Ok(value)
    }
}

pub async fn recommend(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Json(mut input): Json<Request>,
) -> Result<impl axum::response::IntoResponse> {
    let manager = state
        .trip_manager
        .as_ref()
        .ok_or(Error::Unavailable("Trip manager"))?;
    let pool = &state
        .database
        .as_ref()
        .ok_or(Error::Unavailable("Profile storage"))?
        .pool;
    let trip_id = input
        .profile
        .get("trip_id")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::Invalid("Trip identity is required.".into()))?
        .to_owned();
    let saved = crate::travel_profiles::load(pool, &customer.sub, &trip_id).await?;
    if input.profile.contains_key("subject")
        || input.profile.get("revision").and_then(Value::as_str)
            != Some(&saved.revision.to_string())
    {
        return Err(Error::ProfileChanged);
    }
    input.profile = saved.snapshot()?;
    let result = manager.recommend(input, &customer.sub).await?;
    if crate::travel_profiles::load(pool, &customer.sub, &trip_id)
        .await?
        .revision
        != saved.revision
    {
        return Err(Error::ProfileChanged);
    }
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(result),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manager() -> Manager {
        Manager {
            origin: "http://unused".into(),
            api_key: "a".repeat(32),
            signing_key: "b".repeat(32),
            gateway_token: "c".repeat(32),
            identity_key: "d".repeat(32),
            http: reqwest::Client::new(),
            slots: Semaphore::new(1),
        }
    }
    #[tokio::test]
    async fn profile_verifier_requires_the_manager_workload_key() {
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use tower::ServiceExt;
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        Arc::get_mut(&mut state).unwrap().trip_manager = Some(manager());
        for (key, expected) in [
            ("bad".into(), StatusCode::UNAUTHORIZED),
            ("a".repeat(32), StatusCode::SERVICE_UNAVAILABLE),
        ] {
            let response = crate::router(state.clone())
                .oneshot(
                    Request::post("/internal/v1/travel/profile/verify")
                        .header("content-type", "application/json")
                        .header("authorization", format!("Bearer {key}"))
                        .body(Body::from(r#"{"subject":"user","trip_id":"trip"}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }
    #[test]
    fn personal_identity_matches_the_manager_contract_and_is_user_trip_scoped() {
        let manager = manager();
        let id = manager.personal_identity("verified", "東京").unwrap();
        assert_eq!(
            id,
            "trip-manager-eec1e0a022fe5a46c471ddeb38811901e1bda2af56938a7908b3fb6b0850d7e6"
        );
        assert_ne!(id, manager.personal_identity("other", "東京").unwrap());
        assert_ne!(id, manager.personal_identity("verified", "other").unwrap());
    }
    #[test]
    fn snapshot_binds_authenticated_subject_token_and_exact_bytes() {
        let input = serde_json::from_value(json!({"profile":{"trip_id":"trip","revision":"r2"},"specialist":"food","request":{"prompt":"dinner"}})).expect("input");
        let manager = manager();
        let (body, signature, revision) = manager
            .snapshot(input, "verified-subject", 100)
            .expect("snapshot");
        let value: Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(value["profile"]["subject"], "verified-subject");
        assert_eq!(value["issued_at"], 100);
        assert_eq!(value["expires_at"], 220);
        assert_eq!(
            value["delegated_identity_digest"],
            hex::encode(Sha256::digest("c".repeat(32).as_bytes()))
        );
        assert_eq!(revision, "r2");
        let mut verifier = Hmac::<Sha256>::new_from_slice("b".repeat(32).as_bytes()).expect("key");
        verifier.update(&body);
        verifier
            .verify_slice(&hex::decode(signature).expect("hex"))
            .expect("valid signature");
    }
    #[tokio::test]
    async fn signed_request_reaches_manager_and_revision_is_verified() {
        use axum::{body::Bytes, http::HeaderMap, routing::post, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listen");
        let address = listener.local_addr().expect("address");
        let app = Router::new().route(
            "/v1/trip-manager",
            post(|headers: HeaderMap, bytes: Bytes| async move {
                assert_eq!(
                    headers["authorization"],
                    format!("Bearer {}", "a".repeat(32))
                );
                let signature = headers["x-roamie-profile-signature"]
                    .to_str()
                    .expect("signature");
                let mut mac =
                    Hmac::<Sha256>::new_from_slice("b".repeat(32).as_bytes()).expect("key");
                mac.update(&bytes);
                mac.verify_slice(&hex::decode(signature).expect("hex"))
                    .expect("signature");
                let snapshot: Value = serde_json::from_slice(&bytes).expect("snapshot");
                assert_eq!(snapshot["profile"]["subject"], "verified");
                Json(json!({"manager_id":manager().personal_identity("verified","trip").expect("identity"),"profile_revision":"r2","response":{"status":"no_matches"}}))
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("server");
        });
        let mut client = manager();
        client.origin = format!("http://{address}");
        let input = serde_json::from_value(json!({"profile":{"trip_id":"trip","revision":"r2"},"specialist":"food","request":{"prompt":"dinner"}})).expect("input");
        let result = client.recommend(input, "verified").await.expect("response");
        assert_eq!(result["response"]["status"], "no_matches");
        server.abort();
        let _ = server.await;
    }

    #[test]
    fn client_cannot_choose_profile_subject() {
        let input = serde_json::from_value(json!({"profile":{"subject":"victim","revision":"r2"},"specialist":"food","request":{}})).expect("input");
        assert!(matches!(
            manager().snapshot(input, "attacker", 100),
            Err(Error::Invalid(_))
        ));
    }
}
