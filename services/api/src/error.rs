use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("profile changed")]
    ProfileChanged,
    #[error("account conflict")]
    Conflict,
    #[error("storage unavailable")]
    Storage(#[from] sqlx::Error),
    #[error("render capacity exhausted")]
    Busy,
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("no speech in utterance")]
    NoSpeech,
    #[error("no readable text in image")]
    Unreadable,
    #[error("{0} is not configured")]
    Unavailable(&'static str),
    #[error("upstream returned {0}")]
    Upstream(String),
    #[error(transparent)]
    Auth(#[from] gcp_auth::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            Error::ProfileChanged => (
                StatusCode::CONFLICT,
                "profile_changed",
                "Save or refresh your travel preferences before continuing.".into(),
            ),
            Error::Conflict => (
                StatusCode::CONFLICT,
                "account_conflict",
                "Use the account already registered with this email.".into(),
            ),
            Error::Storage(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "storage_unavailable",
                "Account storage is temporarily unavailable.".into(),
            ),
            Error::Busy => (
                StatusCode::TOO_MANY_REQUESTS,
                "busy",
                "Roamie is making memories. Please try again shortly.".into(),
            ),
            Error::Invalid(m) => (StatusCode::BAD_REQUEST, "invalid", m.clone()),
            Error::NoSpeech => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "no_speech",
                "Didn't catch that. Try again a little closer.".into(),
            ),
            Error::Unreadable => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "no_text",
                "Couldn't find any text in that photo. Try again closer and steadier.".into(),
            ),
            Error::Unavailable(what) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
                format!("{what} is not available right now."),
            ),
            Error::Upstream(_) | Error::Auth(_) | Error::Http(_) => {
                let kind = match &self {
                    Error::Upstream(_) => "provider_response",
                    Error::Auth(_) => "provider_authentication",
                    _ => "provider_transport",
                };
                tracing::error!(kind, "upstream failure");
                (
                    StatusCode::BAD_GATEWAY,
                    "upstream",
                    "Something went wrong on our side. Please try again.".into(),
                )
            }
        };
        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    struct Log(Arc<Mutex<Vec<u8>>>);
    impl Write for Log {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().expect("test log").extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn upstream_logs_never_include_provider_payloads_or_signed_urls() {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let sink = bytes.clone();
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_writer(move || Log(sink.clone()))
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            let response =
                Error::Upstream("https://storage.example?signature=synthetic-private-value".into())
                    .into_response();
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        });
        let log = String::from_utf8(bytes.lock().expect("test log").clone()).expect("utf8");
        assert!(
            log.contains("upstream failure"),
            "logging must remain enabled"
        );
        assert!(!log.contains("synthetic-private-value"), "{log}");
    }
}
