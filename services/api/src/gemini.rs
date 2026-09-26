use std::sync::Arc;

use gcp_auth::TokenProvider;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{Error, Result};

const SCOPES: &[&str] = &["https://www.googleapis.com/auth/cloud-platform"];

/// Gemini on Vertex AI. Every model call in Roamie goes through here.
pub struct Gemini {
    http: reqwest::Client,
    auth: Arc<dyn TokenProvider>,
    url: String,
}

impl std::fmt::Debug for Gemini {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gemini")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct Response {
    #[serde(default)]
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    content: Option<Content>,
}

#[derive(Deserialize)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Deserialize)]
struct Part {
    text: Option<String>,
}

impl Gemini {
    pub async fn new(
        http: reqwest::Client,
        project: &str,
        location: &str,
        model: &str,
    ) -> Result<Self> {
        let host = if location == "global" {
            "aiplatform.googleapis.com".to_string()
        } else {
            format!("{location}-aiplatform.googleapis.com")
        };
        let url = format!("https://{host}/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent");
        Ok(Self::with_auth(http, url, gcp_auth::provider().await?))
    }

    pub fn with_auth(http: reqwest::Client, url: String, auth: Arc<dyn TokenProvider>) -> Self {
        Self { http, auth, url }
    }

    pub fn inline(mime_type: &str, base64_data: &str) -> Value {
        json!({ "inlineData": { "mimeType": mime_type, "data": base64_data } })
    }

    pub fn text(text: impl Into<String>) -> Value {
        json!({ "text": text.into() })
    }

    /// Structured output: the model must answer with JSON matching `schema`.
    pub async fn json<T: DeserializeOwned>(
        &self,
        system: &str,
        parts: Vec<Value>,
        schema: Value,
    ) -> Result<T> {
        let token = self.auth.token(SCOPES).await?;
        let body = json!({
            "systemInstruction": { "parts": [{ "text": system }] },
            "contents": [{ "role": "user", "parts": parts }],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
                "responseSchema": schema,
                "thinkingConfig": { "thinkingBudget": 0 }
            }
        });
        let res = self
            .http
            .post(&self.url)
            // Multi-day plans take longer than the shared 25s client budget; stays inside the 60s route timeout.
            .timeout(std::time::Duration::from_secs(45))
            .bearer_auth(token.as_str())
            .json(&body)
            .send()
            .await?;
        let status = res.status();
        if !status.is_success() {
            let detail = res.text().await.unwrap_or_default();
            return Err(Error::Upstream(format!(
                "gemini {status}: {}",
                detail.chars().take(300).collect::<String>()
            )));
        }
        let reply: Response = res.json().await?;
        let text = reply
            .candidates
            .into_iter()
            .next()
            .and_then(|c| c.content)
            .and_then(|c| c.parts.into_iter().find_map(|p| p.text))
            .ok_or_else(|| Error::Upstream("gemini returned no content".into()))?;
        serde_json::from_str(&text).map_err(|e| Error::Upstream(format!("gemini json: {e}")))
    }
}
