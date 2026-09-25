use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{Error, Result};
use crate::gemini::Gemini;
use crate::lang::Lang;
use crate::translate::pronunciation;

const MAX_TEXT_CHARS: usize = 1000;
const MAX_HISTORY: usize = 6;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    pub data: String,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
pub struct HistoryTurn {
    pub original: String,
    pub translation: String,
}

#[derive(Debug, Deserialize)]
pub struct TurnRequest {
    pub mine: Lang,
    pub partner: Lang,
    pub audio: Option<Audio>,
    pub text: Option<String>,
    #[serde(default)]
    pub history: Vec<HistoryTurn>,
}

#[derive(Debug, PartialEq)]
pub enum Utterance<'a> {
    Audio { mime_type: &'a str, data: &'a str },
    Text(&'a str),
}

impl TurnRequest {
    /// Exactly one of audio or text, within size limits.
    pub fn utterance(&self) -> Result<Utterance<'_>> {
        match (&self.audio, self.text.as_deref().map(str::trim)) {
            (Some(a), None) if a.data.is_empty() => Err(Error::Invalid("audio is empty".into())),
            (Some(a), None) if !a.mime_type.starts_with("audio/") => {
                Err(Error::Invalid("audio must be an audio/* type".into()))
            }
            (Some(a), None) => Ok(Utterance::Audio {
                mime_type: &a.mime_type,
                data: &a.data,
            }),
            (None, Some("")) => Err(Error::Invalid("text is empty".into())),
            (None, Some(t)) if t.chars().count() > MAX_TEXT_CHARS => {
                Err(Error::Invalid("text is too long".into()))
            }
            (None, Some(t)) => Ok(Utterance::Text(t)),
            _ => Err(Error::Invalid("send exactly one of audio or text".into())),
        }
    }

    pub fn recent_history(&self) -> &[HistoryTurn] {
        &self.history[self.history.len().saturating_sub(MAX_HISTORY)..]
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResponse {
    pub detected: Lang,
    pub confidence: f32,
    pub candidates: Vec<Lang>,
    pub transcript: String,
    pub translation: String,
    pub romanized: String,
    pub target: Lang,
    pub partner: Lang,
    pub same_language: bool,
}

#[derive(Debug, Deserialize)]
struct Heard {
    language: String,
    confidence: f32,
    #[serde(default)]
    candidates: Vec<String>,
    transcript: String,
    to_mine: String,
    to_partner: String,
    #[serde(default)]
    to_mine_romanized: String,
    #[serde(default)]
    to_partner_romanized: String,
}

const SYSTEM: &str = "You are Roamie, a live interpreter between a traveller and one local person. \
You receive one utterance as audio or text. \
1. Identify the language actually spoken as an ISO 639-1 code; confidence is 0 to 1; candidates lists up to 3 other plausible codes. \
2. transcript: exactly what was said, in its original language and script. \
3. to_mine and to_partner: translate the transcript into the two requested languages. Natural, polite, spoken register. \
Keep numbers, prices, times, and names exact. Use the recent conversation only to resolve references. \
to_mine_romanized and to_partner_romanized: pronunciation guides for each translation in Latin letters, empty when already Latin script. \
Output translations only, never commentary. If there is no intelligible speech, return an empty transcript.";

/// One model call returns the transcript translated both ways; code, not the model,
/// then decides which one the listener hears.
pub async fn interpret(ai: &Gemini, req: &TurnRequest) -> Result<TurnResponse> {
    let utterance = req.utterance()?;
    let mut context = format!(
        "Traveller's language (mine): {}. Partner's language: {}.",
        req.mine.as_str(),
        req.partner.as_str()
    );
    for h in req.recent_history() {
        context.push_str(&format!("\nEarlier: {} => {}", h.original, h.translation));
    }
    let input = match utterance {
        Utterance::Audio { mime_type, data } => Gemini::inline(mime_type, data),
        Utterance::Text(t) => Gemini::text(format!("Utterance: {t}")),
    };
    let schema = json!({
        "type": "OBJECT",
        "properties": {
            "language": { "type": "STRING" },
            "confidence": { "type": "NUMBER" },
            "candidates": { "type": "ARRAY", "items": { "type": "STRING" } },
            "transcript": { "type": "STRING" },
            "to_mine": { "type": "STRING" },
            "to_partner": { "type": "STRING" },
            "to_mine_romanized": { "type": "STRING" },
            "to_partner_romanized": { "type": "STRING" }
        },
        "required": ["language", "confidence", "transcript", "to_mine", "to_partner", "to_mine_romanized", "to_partner_romanized"]
    });
    let heard: Heard = ai
        .json(SYSTEM, vec![Gemini::text(context), input], schema)
        .await?;
    if heard.transcript.trim().is_empty() {
        return Err(Error::NoSpeech);
    }
    let detected = Lang::parse(&heard.language)
        .ok_or_else(|| Error::Upstream(format!("unknown language {:?}", heard.language)))?;
    let direction = resolve(&req.mine, &req.partner, &detected);
    let same_language = direction.same_language(&detected);
    let (translation, romanized) = if same_language {
        (heard.transcript.clone(), String::new())
    } else if direction.target == req.mine {
        (heard.to_mine, heard.to_mine_romanized)
    } else {
        (heard.to_partner, heard.to_partner_romanized)
    };
    let romanized = pronunciation(&translation, &romanized);
    Ok(TurnResponse {
        candidates: heard
            .candidates
            .iter()
            .filter_map(|c| Lang::parse(c))
            .filter(|c| *c != detected)
            .take(3)
            .collect(),
        confidence: heard.confidence.clamp(0.0, 1.0),
        transcript: heard.transcript,
        translation,
        romanized,
        target: direction.target,
        partner: direction.partner,
        same_language,
        detected,
    })
}

/// Where one utterance goes, decided from its detected language alone.
#[derive(Debug, PartialEq, Eq)]
pub struct Direction {
    pub target: Lang,
    pub partner: Lang,
}

impl Direction {
    pub fn same_language(&self, detected: &Lang) -> bool {
        &self.target == detected
    }
}

/// The traveller never picks a direction: their own speech goes to the last partner
/// language, anything else goes to theirs and becomes the new partner language.
pub fn resolve(mine: &Lang, partner: &Lang, detected: &Lang) -> Direction {
    if detected == mine {
        Direction {
            target: partner.clone(),
            partner: partner.clone(),
        }
    } else {
        Direction {
            target: mine.clone(),
            partner: detected.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(code: &str) -> Lang {
        Lang::parse(code).unwrap()
    }

    #[test]
    fn resolves_direction_from_detected_language() {
        let cases = [
            ("mine speaks, goes to partner", "en", "th", "en", "th", "th"),
            (
                "partner speaks, comes to mine",
                "en",
                "th",
                "th",
                "en",
                "th",
            ),
            (
                "new partner language takes over",
                "en",
                "th",
                "lo",
                "en",
                "lo",
            ),
            (
                "partner defaults to country language",
                "en",
                "ja",
                "en",
                "ja",
                "ja",
            ),
            ("partner and mine identical", "en", "en", "en", "en", "en"),
        ];
        for (name, mine, partner, detected, target, next) in cases {
            let got = resolve(&l(mine), &l(partner), &l(detected));
            assert_eq!(
                got,
                Direction {
                    target: l(target),
                    partner: l(next)
                },
                "case {name}"
            );
        }
    }

    fn request(audio: Option<(&str, &str)>, text: Option<&str>) -> TurnRequest {
        TurnRequest {
            mine: l("en"),
            partner: l("th"),
            audio: audio.map(|(m, d)| Audio {
                mime_type: m.into(),
                data: d.into(),
            }),
            text: text.map(Into::into),
            history: Vec::new(),
        }
    }

    #[test]
    fn accepts_exactly_one_utterance() {
        assert_eq!(
            request(None, Some(" hello ")).utterance().unwrap(),
            Utterance::Text("hello")
        );
        assert_eq!(
            request(Some(("audio/mp4", "AAAA")), None)
                .utterance()
                .unwrap(),
            Utterance::Audio {
                mime_type: "audio/mp4",
                data: "AAAA"
            }
        );
        let rejected = [
            ("neither", request(None, None)),
            ("both", request(Some(("audio/mp4", "AAAA")), Some("hi"))),
            ("blank text", request(None, Some("   "))),
            ("empty audio", request(Some(("audio/mp4", "")), None)),
            ("non-audio mime", request(Some(("image/png", "AAAA")), None)),
            (
                "too long",
                request(None, Some(&"a".repeat(MAX_TEXT_CHARS + 1))),
            ),
        ];
        for (name, r) in rejected {
            assert!(
                matches!(r.utterance(), Err(Error::Invalid(_))),
                "case {name}"
            );
        }
    }

    #[test]
    fn keeps_only_recent_history() {
        let mut r = request(None, Some("hi"));
        r.history = (0..9)
            .map(|i| HistoryTurn {
                original: i.to_string(),
                translation: String::new(),
            })
            .collect();
        let kept: Vec<&str> = r
            .recent_history()
            .iter()
            .map(|h| h.original.as_str())
            .collect();
        assert_eq!(kept, ["3", "4", "5", "6", "7", "8"]);
    }

    #[test]
    fn flags_same_language_when_nothing_to_translate() {
        let got = resolve(&l("en"), &l("en"), &l("en"));
        assert!(got.same_language(&l("en")));
        assert!(!resolve(&l("en"), &l("th"), &l("en")).same_language(&l("en")));
    }
}
