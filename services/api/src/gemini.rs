use std::sync::Arc;

use gcp_auth::TokenProvider;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{Error, Result};

const SCOPES: &[&str] = &["https://www.googleapis.com/auth/cloud-platform"];

/// Gemini on Vertex AI. Every model call in Roamie goes through here.
pub struct Gemini {
    transport: Transport,
}

enum Transport {
    Vertex {
        http: reqwest::Client,
        auth: Arc<dyn TokenProvider>,
        url: String,
    },
    Gateway(crate::gateway::Gateway),
}

impl std::fmt::Debug for Gemini {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gemini")
            .field(
                "transport",
                &match &self.transport {
                    Transport::Vertex { .. } => "vertex-development",
                    Transport::Gateway(_) => "roamie-gateway",
                },
            )
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
        Self {
            transport: Transport::Vertex { http, auth, url },
        }
    }

    pub fn with_gateway(gateway: crate::gateway::Gateway) -> Self {
        Self {
            transport: Transport::Gateway(gateway),
        }
    }

    pub fn inline(mime_type: &str, base64_data: &str) -> Value {
        json!({ "inlineData": { "mimeType": mime_type, "data": base64_data } })
    }

    pub fn text(text: impl Into<String>) -> Value {
        json!({ "text": text.into() })
    }

    pub async fn speech(
        &self,
        text: &str,
        _language: &crate::lang::Lang,
        voice: crate::speech::Voice,
    ) -> Result<Value> {
        let unavailable = || Error::Unavailable("Speech playback");
        // Gemini 3.8 TTS reads the text verbatim, including any embedded instructions.
        let body = json!({"contents":[{"role":"user","parts":[{"text":text}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":voice.studio_name()}}}}});
        let mut response = match &self.transport {
            Transport::Gateway(gateway) => {
                gateway
                    .post(
                        "/v1/speech",
                        serde_json::to_vec(&body).map_err(|_| unavailable())?,
                        std::time::Duration::from_secs(45),
                    )
                    .await?
            }
            Transport::Vertex { http, auth, url } => {
                let speech_url = url.rsplit_once("/models/").map_or_else(
                    || url.to_owned(),
                    |(prefix, _)| format!("{prefix}/models/gemini-3.8-flash-tts:generateContent"),
                );
                let token = auth.token(SCOPES).await.map_err(|_| unavailable())?;
                http.post(speech_url)
                    .timeout(std::time::Duration::from_secs(45))
                    .bearer_auth(token.as_str())
                    .json(&body)
                    .send()
                    .await
                    .map_err(|_| unavailable())?
            }
        };
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
            if bytes.len() + chunk.len() > 3 * 1024 * 1024 {
                return Err(unavailable());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| unavailable())
    }

    /// Structured output: the model must answer with JSON matching `schema`.
    pub async fn json<T: DeserializeOwned>(
        &self,
        system: &str,
        parts: Vec<Value>,
        schema: Value,
    ) -> Result<T> {
        let (http, auth, url) = match &self.transport {
            Transport::Gateway(gateway) => {
                return gateway_json(gateway, system, parts, schema).await
            }
            Transport::Vertex { http, auth, url } => (http, auth, url),
        };
        let token = auth.token(SCOPES).await?;
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
        let res = http
            .post(url)
            // Multi-day plans take longer than the shared 25s client budget; stays inside the 60s route timeout.
            .timeout(std::time::Duration::from_secs(45))
            .bearer_auth(token.as_str())
            .json(&body)
            .send()
            .await?;
        let status = res.status();
        if !status.is_success() {
            return Err(Error::Upstream(format!("gemini {status}")));
        }
        let mut res = res;
        let mut bytes = Vec::new();
        while let Some(chunk) = res.chunk().await? {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(Error::Upstream("gemini response too large".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        let reply: Response = serde_json::from_slice(&bytes)
            .map_err(|_| Error::Upstream("invalid gemini response".into()))?;
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

async fn gateway_json<T: DeserializeOwned>(
    gateway: &crate::gateway::Gateway,
    system: &str,
    parts: Vec<Value>,
    mut schema: Value,
) -> Result<T> {
    json_schema(&mut schema);
    let content: Vec<Value> = parts.into_iter().map(|part| {
        if let Some(text) = part.get("text") {
            json!({"type":"text", "text":text})
        } else {
            let media = &part["inlineData"];
            json!({"type":"image_url", "image_url":{"url":format!("data:{};base64,{}", media["mimeType"].as_str().unwrap_or_default(), media["data"].as_str().unwrap_or_default())}})
        }
    }).collect();
    // agentgateway forwards only this camelCase form; reasoning_effort "none" still lets Gemini 2.5 think.
    let body = json!({"model":"roamie-structured", "messages":[{"role":"system","content":system},{"role":"user","content":content}], "temperature":0.2, "thinking_config":{"thinkingBudget":0}, "response_format":{"type":"json_schema", "json_schema":{"name":"roamie_response", "schema":schema}}});
    let mut response = gateway
        .post(
            "/v1/chat/completions",
            serde_json::to_vec(&body)
                .map_err(|_| Error::Upstream("invalid model request".into()))?,
            std::time::Duration::from_secs(45),
        )
        .await?;
    if !response.status().is_success() {
        return Err(Error::Upstream("model gateway unavailable".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error::Upstream("model gateway unavailable".into()))?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(Error::Upstream("model response too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    let reply: Value = serde_json::from_slice(&bytes)
        .map_err(|_| Error::Upstream("invalid model response".into()))?;
    let text = reply["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| Error::Upstream("model returned no content".into()))?;
    serde_json::from_str(text).map_err(|_| Error::Upstream("invalid model JSON".into()))
}

fn json_schema(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            if let Some(Value::String(kind)) = fields.get_mut("type") {
                *kind = kind.to_lowercase();
            }
            if fields.remove("nullable") == Some(Value::Bool(true)) {
                if let Some(kind) = fields.remove("type") {
                    fields.insert("type".into(), json!([kind, "null"]));
                }
            }
            fields.remove("propertyOrdering");
            for nested in fields.values_mut() {
                json_schema(nested);
            }
        }
        Value::Array(values) => {
            for nested in values {
                json_schema(nested);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::post, Json, Router};

    #[tokio::test]
    async fn gateway_uses_openai_structured_text_and_media_without_google_credentials() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway =
            crate::gateway::Gateway::for_test(format!("http://{}", listener.local_addr().unwrap()));
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|headers: HeaderMap, Json(body): Json<Value>| async move {
                assert_eq!(headers["authorization"], "Bearer verified-customer");
                assert_eq!(body["messages"][0]["content"], "translate");
                assert_eq!(body["messages"][1]["content"][0]["text"], "bonjour");
                assert_eq!(
                    body["messages"][1]["content"][1]["image_url"]["url"],
                    "data:audio/mp4;base64,YQ=="
                );
                assert_eq!(
                    body["response_format"]["json_schema"]["schema"]["type"],
                    "object"
                );
                assert_eq!(
                    body["response_format"]["json_schema"]["schema"]["properties"]["translation"]
                        ["type"],
                    "string"
                );
                Json(json!({"choices":[{"message":{"content":"{\"translation\":\"hello\"}"}}]}))
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Gemini::with_gateway(gateway);
        let answer: Value = crate::gateway::scope("verified-customer".into(), "talk/turn".into(), client.json("translate", vec![Gemini::text("bonjour"), Gemini::inline("audio/mp4", "YQ==")], json!({"type":"OBJECT","properties":{"translation":{"type":"STRING"}},"required":["translation"]}))).await.unwrap();
        assert_eq!(answer["translation"], "hello");
        server.abort();
        let _ = server.await;
    }

    #[tokio::test]
    async fn gateway_requests_disable_hidden_thinking() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway =
            crate::gateway::Gateway::for_test(format!("http://{}", listener.local_addr().unwrap()));
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|Json(body): Json<Value>| async move {
                Json(json!({"choices":[{"message":{"content":body["thinking_config"].to_string()}}]}))
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Gemini::with_gateway(gateway);
        let sent: Value = crate::gateway::scope(
            "verified-customer".into(),
            "talk/turn".into(),
            client.json(
                "translate",
                vec![Gemini::text("bonjour")],
                json!({"type":"OBJECT"}),
            ),
        )
        .await
        .unwrap();
        assert_eq!(sent, json!({"thinkingBudget": 0}));
        server.abort();
        let _ = server.await;
    }
}
