use std::{sync::Arc, time::Duration};

use gcp_auth::TokenProvider;
use serde_json::{json, Value};

use crate::{
    error::{Error, Result},
    lang::Lang,
};

pub struct Translation {
    http: reqwest::Client,
    auth: tokio::sync::OnceCell<Arc<dyn TokenProvider>>,
    base: String,
}

impl Translation {
    pub fn new(http: reqwest::Client, project: &str) -> Self {
        Self {
            http,
            base: format!(
                "https://translation.googleapis.com/v3/projects/{project}/locations/global"
            ),
            auth: tokio::sync::OnceCell::new(),
        }
    }

    #[cfg(test)]
    pub fn with_auth(http: reqwest::Client, base: String, auth: Arc<dyn TokenProvider>) -> Self {
        Self {
            http,
            auth: tokio::sync::OnceCell::new_with(Some(auth)),
            base,
        }
    }

    async fn post(&self, operation: &str, body: Value) -> Result<Value> {
        tokio::time::timeout(Duration::from_secs(9), async {
            let auth = self.auth.get_or_try_init(gcp_auth::provider).await?;
            let token = auth
                .token(&["https://www.googleapis.com/auth/cloud-platform"])
                .await?;
            for attempt in 0..2 {
                let response = self
                    .http
                    .post(format!("{}:{operation}", self.base))
                    .timeout(Duration::from_secs(4))
                    .bearer_auth(token.as_str())
                    .json(&body)
                    .send()
                    .await;
                let mut response = match response {
                    Ok(response)
                        if attempt == 0
                            && (response.status().is_server_error()
                                || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS) =>
                    {
                        continue
                    }
                    Ok(response) => response,
                    Err(_) if attempt == 0 => continue,
                    Err(_) => return Err(Error::Upstream("translation transport".into())),
                };
                if !response.status().is_success() {
                    return Err(Error::Upstream("translation provider".into()));
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await? {
                    if bytes.len() + chunk.len() > 64 * 1024 {
                        return Err(Error::Upstream("translation response too large".into()));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                return serde_json::from_slice(&bytes)
                    .map_err(|_| Error::Upstream("invalid translation response".into()));
            }
            Err(Error::Upstream("translation provider".into()))
        })
        .await
        .map_err(|_| Error::Upstream("translation deadline".into()))?
    }

    pub async fn detect(&self, text: &str) -> Result<(Lang, f32)> {
        let response = self
            .post(
                "detectLanguage",
                json!({"content":text,"mimeType":"text/plain"}),
            )
            .await?;
        let first = &response["languages"][0];
        let code = first["languageCode"]
            .as_str()
            .ok_or_else(|| Error::Upstream("missing detected language".into()))?;
        let code = match code {
            "tl" => "fil",
            "iw" => "he",
            "zh-CN" | "zh-TW" => "zh",
            code => code,
        };
        let language =
            Lang::parse(code).ok_or_else(|| Error::Upstream("invalid detected language".into()))?;
        let confidence = first["confidence"]
            .as_f64()
            .filter(|v| (0.0..=1.0).contains(v))
            .ok_or_else(|| Error::Upstream("invalid language confidence".into()))?;
        Ok((language, confidence as f32))
    }

    pub async fn translate(&self, text: &str, source: &Lang, target: &Lang) -> Result<String> {
        if source == target {
            return Ok(text.to_owned());
        }
        let response = self.post("translateText", json!({"contents":[text],"sourceLanguageCode":source.as_str(),"targetLanguageCode":target.as_str(),"mimeType":"text/plain"})).await?;
        let translation = response["translations"][0]["translatedText"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| Error::Upstream("empty translation".into()))?;
        if translation.chars().count() > 4000 {
            return Err(Error::Upstream("translation too long".into()));
        }
        Ok(translation.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, Json, Router};
    use gcp_auth::Token;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestToken;
    #[async_trait::async_trait]
    impl TokenProvider for TestToken {
        async fn token(&self, _: &[&str]) -> std::result::Result<Arc<Token>, gcp_auth::Error> {
            Ok(Arc::new(
                serde_json::from_value(json!({"access_token":"synthetic","expires_in":3600}))
                    .unwrap(),
            ))
        }
        async fn project_id(&self) -> std::result::Result<Arc<str>, gcp_auth::Error> {
            Ok("test".into())
        }
    }

    async fn provider(status: StatusCode, response: Value) -> (Translation, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let hits = calls.clone();
        let app = Router::new().fallback(
            move |headers: axum::http::HeaderMap, Json(body): Json<Value>| {
                let response = response.clone();
                hits.fetch_add(1, Ordering::SeqCst);
                async move {
                    assert_eq!(headers["authorization"], "Bearer synthetic");
                    assert_eq!(body["mimeType"], "text/plain");
                    (status, Json(response))
                }
            },
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/translation", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (
            Translation::with_auth(reqwest::Client::new(), base, Arc::new(TestToken)),
            calls,
        )
    }

    #[tokio::test]
    async fn provider_language_aliases_are_canonical_and_invalid_confidence_fails_closed() {
        for (code, expected) in [
            ("tl", "fil"),
            ("iw", "he"),
            ("zh-CN", "zh"),
            ("zh-TW", "zh"),
            ("ne", "ne"),
        ] {
            let (client, _) = provider(
                StatusCode::OK,
                json!({"languages":[{"languageCode":code,"confidence":0.98}]}),
            )
            .await;
            let (language, confidence) = client.detect("synthetic phrase").await.unwrap();
            assert_eq!(language.as_str(), expected);
            assert_eq!(confidence, 0.98);
        }
        for response in [
            json!({}),
            json!({"languages":[]}),
            json!({"languages":[{"languageCode":"english","confidence":1}]}),
            json!({"languages":[{"languageCode":"en","confidence":1.1}]}),
            json!({"languages":[{"languageCode":"en"}]}),
        ] {
            let (client, _) = provider(StatusCode::OK, response).await;
            assert!(client.detect("Hello").await.is_err());
        }
    }

    #[tokio::test]
    async fn translation_preserves_unicode_and_same_language_avoids_provider() {
        let (client, calls) = provider(
            StatusCode::OK,
            json!({"translations":[{"translatedText":"ট্রেন চারটায় ছাড়ে, পাঁচটায় নয়।"}]}),
        )
        .await;
        let en = Lang::parse("en").unwrap();
        let bn = Lang::parse("bn").unwrap();
        assert_eq!(
            client
                .translate("The train leaves at four, not five.", &en, &bn)
                .await
                .unwrap(),
            "ট্রেন চারটায় ছাড়ে, পাঁচটায় নয়।"
        );
        assert_eq!(client.translate("Hello", &en, &en).await.unwrap(), "Hello");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        for response in [
            json!({}),
            json!({"translations":[{"translatedText":" "}]}),
            json!({"translations":[{"translatedText":"x".repeat(4001)}]}),
            json!({"translations":[{"translatedText":"x".repeat(65536)}]}),
        ] {
            let (client, _) = provider(StatusCode::OK, response).await;
            assert!(client.translate("Hello", &en, &bn).await.is_err());
        }
    }

    #[tokio::test]
    async fn transient_provider_failures_retry_once_and_permission_errors_do_not() {
        for (status, count) in [
            (StatusCode::TOO_MANY_REQUESTS, 2),
            (StatusCode::SERVICE_UNAVAILABLE, 2),
            (StatusCode::FORBIDDEN, 1),
        ] {
            let (client, calls) = provider(
                status,
                json!({"error":{"message":"private provider diagnostics"}}),
            )
            .await;
            let error = client.detect("Hello").await.unwrap_err();
            assert_eq!(calls.load(Ordering::SeqCst), count);
            assert!(!error.to_string().contains("private"));
        }
        let calls = Arc::new(AtomicUsize::new(0));
        let hits = calls.clone();
        let app = Router::new().fallback(move || {
            let hit = hits.fetch_add(1, Ordering::SeqCst);
            async move {
                if hit == 0 {
                    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({})))
                } else {
                    (
                        StatusCode::OK,
                        Json(json!({"languages":[{"languageCode":"en","confidence":1.0}]})),
                    )
                }
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/translation", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Translation::with_auth(reqwest::Client::new(), base, Arc::new(TestToken));
        assert_eq!(client.detect("Hello").await.unwrap().0.as_str(), "en");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn the_deadline_also_bounds_credential_discovery() {
        struct StalledToken;
        #[async_trait::async_trait]
        impl TokenProvider for StalledToken {
            async fn token(&self, _: &[&str]) -> std::result::Result<Arc<Token>, gcp_auth::Error> {
                std::future::pending().await
            }
            async fn project_id(&self) -> std::result::Result<Arc<str>, gcp_auth::Error> {
                Ok("test".into())
            }
        }
        let client = Translation::with_auth(
            reqwest::Client::new(),
            "http://unused/translation".into(),
            Arc::new(StalledToken),
        );
        let start = tokio::time::Instant::now();
        assert!(client.detect("Hello").await.is_err());
        assert_eq!(start.elapsed(), Duration::from_secs(9));
    }
}
