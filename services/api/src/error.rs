use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum Error {
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
                tracing::error!(error = %self, "upstream failure");
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
