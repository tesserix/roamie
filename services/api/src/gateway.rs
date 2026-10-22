use std::{future::Future, time::Duration};

use crate::error::{Error, Result};

tokio::task_local! {
    static IDENTITY: Identity;
}

struct Identity {
    token: String,
    capability: String,
}

pub async fn scope<T>(token: String, capability: String, future: impl Future<Output = T>) -> T {
    IDENTITY.scope(Identity { token, capability }, future).await
}

#[derive(Clone)]
pub struct Gateway {
    http: reqwest::Client,
    origin: String,
}

impl Gateway {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        Self::from_origin(std::env::var("AI_GATEWAY_ORIGIN").ok().as_deref())
    }

    fn from_origin(origin: Option<&str>) -> anyhow::Result<Option<Self>> {
        let Some(origin) = origin else {
            return Ok(None);
        };
        anyhow::ensure!(
            origin == "http://roamie-ai.agentgateway-system.svc.cluster.local:8080",
            "AI_GATEWAY_ORIGIN must be the private Roamie gateway"
        );
        Ok(Some(Self {
            http: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            origin: origin.to_owned(),
        }))
    }

    pub async fn post(
        &self,
        path: &str,
        body: Vec<u8>,
        deadline: Duration,
    ) -> Result<reqwest::Response> {
        let (token, capability) = IDENTITY
            .try_with(|identity| (identity.token.clone(), identity.capability.clone()))
            .map_err(|_| Error::Unavailable("AI gateway identity"))?;
        self.http
            .post(format!("{}{path}", self.origin))
            .bearer_auth(token)
            .header("x-roamie-ai-service", "roamie-api")
            .header("x-roamie-ai-capability", capability)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .timeout(deadline)
            .body(body)
            .send()
            .await
            .map_err(|_| Error::Unavailable("AI gateway"))
    }

    #[cfg(test)]
    pub fn for_test(origin: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            origin,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::post, Json, Router};
    use serde_json::Value;

    #[test]
    fn gateway_origin_cannot_redirect_credentials_to_another_service() {
        for origin in [
            "https://evil.invalid",
            "http://roamie-api:8080",
            "",
            "http://roamie-ai.agentgateway-system.svc.cluster.local:8080?key=x",
        ] {
            assert!(Gateway::from_origin(Some(origin)).is_err(), "{origin}");
        }
        assert!(Gateway::from_origin(Some(
            "http://roamie-ai.agentgateway-system.svc.cluster.local:8080"
        ))
        .unwrap()
        .is_some());
        assert!(Gateway::from_origin(None).unwrap().is_none());
    }

    #[tokio::test]
    async fn gateway_requests_require_verified_request_context_and_keep_accounts_separate() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().route("/v1/decisions", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
            assert_eq!(headers["x-roamie-ai-service"], "roamie-api");
            assert_eq!(headers["x-roamie-ai-capability"], "receipts/extract");
            assert!(headers.get("x-roamie-user-id").is_none());
            Json(serde_json::json!({"token":headers["authorization"].to_str().unwrap(),"body":body}))
        }));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Gateway {
            http: reqwest::Client::new(),
            origin,
        };
        assert!(client
            .post("/v1/decisions", b"{}".to_vec(), Duration::from_secs(1))
            .await
            .is_err());
        let call = |token: &str| {
            scope(token.into(), "receipts/extract".into(), async {
                client
                    .post("/v1/decisions", b"{}".to_vec(), Duration::from_secs(1))
                    .await
                    .unwrap()
                    .json::<Value>()
                    .await
                    .unwrap()
            })
        };
        let (a, b) = tokio::join!(call("account-a"), call("account-b"));
        assert_eq!(a["token"], "Bearer account-a");
        assert_eq!(b["token"], "Bearer account-b");
        assert!(client
            .post("/v1/decisions", b"{}".to_vec(), Duration::from_secs(1))
            .await
            .is_err());
        server.abort();
        let _ = server.await;
    }
}
