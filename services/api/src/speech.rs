use std::sync::Arc;

use axum::{extract::State, Json};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::{
    error::{Error, Result},
    lang::Lang,
    AppState,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    text: String,
    language: Lang,
    #[serde(default)]
    voice: Voice,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Voice {
    #[default]
    Female,
    Male,
}

impl Voice {
    /// Gemini studio voices chosen for a calm, reassuring tone.
    pub fn studio_name(self) -> &'static str {
        match self {
            Voice::Female => "Sulafat",
            Voice::Male => "Algieba",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    data: String,
    mime_type: &'static str,
}

pub async fn synthesize(
    State(state): State<Arc<AppState>>,
    Json(request): Json<Request>,
) -> Result<Json<Audio>> {
    if request.text.trim().is_empty() || request.text.chars().count() > 1000 {
        return Err(Error::Invalid(
            "Speak a short message of up to 1,000 characters.".into(),
        ));
    }
    let ai = state
        .ai
        .as_ref()
        .ok_or(Error::Unavailable("Speech playback"))?;
    let response = ai
        .speech(&request.text, &request.language, request.voice)
        .await?;
    let parts = response["candidates"][0]["content"]["parts"]
        .as_array()
        .ok_or(Error::Unavailable("Speech playback"))?;
    let inline = parts
        .iter()
        .find_map(|part| part.get("inlineData"))
        .ok_or(Error::Unavailable("Speech playback"))?;
    let data = inline["data"]
        .as_str()
        .ok_or(Error::Unavailable("Speech playback"))?;
    if inline["mimeType"] != "audio/wav" || data.len() > 2 * 1024 * 1024 * 4 / 3 + 4 {
        return Err(Error::Unavailable("Speech playback"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| Error::Unavailable("Speech playback"))?;
    if bytes.len() < 44
        || bytes.len() > 2 * 1024 * 1024
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err(Error::Unavailable("Speech playback"));
    }
    Ok(Json(Audio {
        data: data.to_owned(),
        mime_type: "audio/wav",
    }))
}
