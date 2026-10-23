use std::fmt;
use std::sync::{Mutex, OnceLock};

use kaldi_fbank::{FbankOptions, WindowType};
use ort::{session::Session, value::Tensor};
use serde::de::{Error as _, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{Error, Result};
use crate::talk::Speaker;

pub const MODEL: &str = "wespeaker-resnet34-lm-3955447b-v1";
const DIMENSION: usize = 256;
const MIN_SAMPLES: usize = 32000;
const MAX_SAMPLES: usize = 48000;
static SESSION: OnceLock<std::result::Result<Mutex<Session>, ()>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(transparent)]
pub struct Embedding(Vec<f32>);

impl fmt::Debug for Embedding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Embedding([redacted])")
    }
}

impl Embedding {
    fn normalized(mut values: Vec<f32>) -> Result<Self> {
        let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
        if values.len() != DIMENSION || !norm.is_finite() || norm <= f32::EPSILON {
            return Err(unavailable());
        }
        values.iter_mut().for_each(|value| *value /= norm);
        Ok(Self(values))
    }

    fn similarity(&self, other: &Self) -> f32 {
        self.0.iter().zip(&other.0).map(|(a, b)| a * b).sum()
    }
}

impl<'de> Deserialize<'de> for Embedding {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct EmbeddingVisitor;
        impl<'de> Visitor<'de> for EmbeddingVisitor {
            type Value = Embedding;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a normalized session speaker embedding")
            }

            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = Vec::with_capacity(DIMENSION);
                while let Some(value) = seq.next_element::<f32>()? {
                    if values.len() == DIMENSION || !value.is_finite() || value.abs() > 1.01 {
                        return Err(A::Error::custom("invalid session speaker embedding"));
                    }
                    values.push(value);
                }
                let norm = values.iter().map(|value| value * value).sum::<f32>();
                if values.len() != DIMENSION || !(0.99..=1.01).contains(&norm) {
                    return Err(A::Error::custom("invalid session speaker embedding"));
                }
                Embedding::normalized(values)
                    .map_err(|_| A::Error::custom("invalid session speaker embedding"))
            }
        }
        deserializer.deserialize_seq(EmbeddingVisitor)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub model: String,
    #[serde(default, deserialize_with = "references")]
    pub mine: Vec<Embedding>,
    #[serde(default, deserialize_with = "references")]
    pub partner: Vec<Embedding>,
}

fn references<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Vec<Embedding>, D::Error> {
    struct ReferencesVisitor;
    impl<'de> Visitor<'de> for ReferencesVisitor {
        type Value = Vec<Embedding>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("at most two session speaker references")
        }
        fn visit_seq<A: SeqAccess<'de>>(
            self,
            mut seq: A,
        ) -> std::result::Result<Self::Value, A::Error> {
            let mut references = Vec::with_capacity(2);
            while let Some(reference) = seq.next_element::<Embedding>()? {
                if references.len() == 2 {
                    return Err(A::Error::custom("too many session speaker references"));
                }
                references.push(reference);
            }
            Ok(references)
        }
    }
    deserializer.deserialize_seq(ReferencesVisitor)
}

impl Context {
    pub fn validate(&self) -> Result<()> {
        if self.model != MODEL || self.mine.len() > 2 || self.partner.len() > 2 {
            return Err(Error::Invalid(
                "Restart hands-free to learn the conversation voices again.".into(),
            ));
        }
        Ok(())
    }

    pub fn identify(&self, current: &Embedding) -> Option<Speaker> {
        let best = |references: &[Embedding]| {
            references
                .iter()
                .map(|reference| current.similarity(reference))
                .reduce(f32::max)
        };
        match (best(&self.mine), best(&self.partner)) {
            (Some(mine), Some(partner)) if mine >= 0.4 && mine - partner >= 0.2 => {
                Some(Speaker::Mine)
            }
            (Some(mine), Some(partner)) if partner >= 0.4 && partner - mine >= 0.2 => {
                Some(Speaker::Partner)
            }
            (Some(mine), None) if mine >= 0.65 => Some(Speaker::Mine),
            (None, Some(partner)) if partner >= 0.65 => Some(Speaker::Partner),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracking {
    pub model: &'static str,
    pub embedding: Option<Embedding>,
    pub basis: &'static str,
}

fn unavailable() -> Error {
    Error::Unavailable("Conversation speaker tracking")
}

#[tracing::instrument(skip_all, name = "speaker_embedding")]
pub fn extract(samples: &[i16]) -> Result<Option<Embedding>> {
    if samples.len() < MIN_SAMPLES {
        return Ok(None);
    }
    let samples = &samples[samples.len().saturating_sub(MAX_SAMPLES)..];
    let active = samples
        .chunks(320)
        .filter(|frame| {
            frame
                .iter()
                .map(|value| (*value as f64).powi(2))
                .sum::<f64>()
                / frame.len() as f64
                > 160_f64.powi(2)
        })
        .count();
    if active < 45 {
        return Ok(None);
    }
    let session = SESSION
        .get_or_init(|| {
            Session::builder()
                .and_then(|builder| builder.with_intra_threads(1))
                .and_then(|builder| builder.with_inter_threads(1))
                .and_then(|builder| {
                    builder
                        .commit_from_memory(include_bytes!("../models/wespeaker-resnet34-lm.onnx"))
                })
                .map(Mutex::new)
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|_| unavailable())?;
    let mut options = FbankOptions::default();
    options.frame_opts.dither = 0.0;
    options.frame_opts.window_type = WindowType::Hamming;
    options.mel_opts.num_bins = 80;
    let samples: Vec<f32> = samples
        .iter()
        .map(|value| *value as f32 / 32768.0)
        .collect();
    let mut features = kaldi_fbank::compute_fbank(&options, &samples);
    if features.is_empty()
        || features
            .iter()
            .any(|frame| frame.len() != 80 || frame.iter().any(|value| !value.is_finite()))
    {
        return Err(unavailable());
    }
    let mut means = [0_f32; 80];
    for frame in &features {
        for (mean, value) in means.iter_mut().zip(frame) {
            *mean += value / features.len() as f32;
        }
    }
    for frame in &mut features {
        for (value, mean) in frame.iter_mut().zip(means) {
            *value -= mean;
        }
    }
    let shape = [1, features.len(), 80];
    let values: Vec<f32> = features.into_iter().flatten().collect();
    let input = Tensor::from_array((shape, values)).map_err(|_| unavailable())?;
    let mut session = session.lock().map_err(|_| unavailable())?;
    let output = session
        .run(ort::inputs!["input_features" => input])
        .map_err(|_| unavailable())?;
    let (_, values) = output
        .get("last_hidden_state")
        .ok_or_else(unavailable)?
        .try_extract_tensor::<f32>()
        .map_err(|_| unavailable())?;
    Embedding::normalized(values.to_vec()).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector(first: f32, second: f32) -> Embedding {
        let mut values = vec![0.0; 256];
        values[0] = first;
        values[1] = second;
        Embedding::normalized(values).unwrap()
    }

    #[test]
    fn identifies_the_same_voice_without_using_language_or_turn_order() {
        let context = Context {
            model: MODEL.into(),
            mine: vec![vector(1.0, 0.0)],
            partner: vec![vector(0.0, 1.0)],
        };
        assert_eq!(
            context.identify(&vector(0.9, 0.1)),
            Some(crate::talk::Speaker::Mine)
        );
        assert_eq!(
            context.identify(&vector(0.1, 0.9)),
            Some(crate::talk::Speaker::Partner)
        );
    }

    #[test]
    fn similar_or_unfamiliar_voices_do_not_choose_a_side() {
        let mut context = Context {
            model: MODEL.into(),
            mine: vec![vector(1.0, 0.0)],
            partner: vec![vector(1.0, 0.1)],
        };
        assert_eq!(context.identify(&vector(1.0, 0.0)), None);
        context.partner = vec![vector(0.0, 1.0)];
        assert_eq!(context.identify(&vector(-1.0, -1.0)), None);
    }

    #[test]
    fn rejects_wrong_models_unbounded_references_and_invalid_embeddings() {
        let mut context = Context {
            model: MODEL.into(),
            mine: vec![vector(1.0, 0.0)],
            partner: vec![],
        };
        assert!(context.validate().is_ok());
        context.model = "older-model".into();
        assert!(context.validate().is_err());
        context.model = MODEL.into();
        context.mine = vec![vector(1.0, 0.0), vector(1.0, 0.0), vector(1.0, 0.0)];
        assert!(context.validate().is_err());
        assert!(Embedding::normalized(vec![0.0; 256]).is_err());
        assert!(Embedding::normalized(vec![f32::NAN; 256]).is_err());
        assert!(serde_json::from_value::<Embedding>(serde_json::json!([1.0, 0.0])).is_err());
    }

    fn pcm(wav: &[u8]) -> Vec<i16> {
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[36..40], b"data");
        wav[44..]
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
            .collect()
    }

    #[test]
    fn real_model_matches_held_out_hindi_and_odia_without_alternating_speakers() {
        let context = Context {
            model: MODEL.into(),
            mine: vec![
                extract(&pcm(include_bytes!("../testdata/speaker-sulafat-en-0.wav")))
                    .unwrap()
                    .unwrap(),
            ],
            partner: vec![
                extract(&pcm(include_bytes!("../testdata/speaker-algieba-hi-0.wav")))
                    .unwrap()
                    .unwrap(),
            ],
        };
        for (wav, expected) in [
            (
                include_bytes!("../testdata/speaker-sulafat-hi-1.wav").as_slice(),
                Speaker::Mine,
            ),
            (
                include_bytes!("../testdata/speaker-sulafat-or-1.wav").as_slice(),
                Speaker::Mine,
            ),
            (
                include_bytes!("../testdata/speaker-algieba-en-1.wav").as_slice(),
                Speaker::Partner,
            ),
            (
                include_bytes!("../testdata/speaker-algieba-or-1.wav").as_slice(),
                Speaker::Partner,
            ),
        ] {
            let embedding = extract(&pcm(wav)).unwrap().unwrap();
            assert_eq!(context.identify(&embedding), Some(expected));
        }
    }

    #[test]
    #[ignore = "manual CPU benchmark; no provider requests"]
    fn benchmark_warm_speaker_extraction() {
        let samples = pcm(include_bytes!("../testdata/speaker-sulafat-or-1.wav"));
        let cold = std::time::Instant::now();
        assert!(extract(&samples).unwrap().is_some());
        let cold_ms = cold.elapsed().as_secs_f64() * 1000.0;
        let mut timings = Vec::with_capacity(30);
        for _ in 0..30 {
            let start = std::time::Instant::now();
            assert!(extract(&samples).unwrap().is_some());
            timings.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        timings.sort_by(f64::total_cmp);
        println!(
            "speaker_benchmark={}",
            serde_json::json!({
                "model": MODEL, "samples": samples.len(), "iterations": timings.len(),
                "cold_ms": cold_ms, "p50_ms": timings[14], "p95_ms": timings[28],
                "min_ms": timings[0], "max_ms": timings[29], "sorted_ms": timings,
                "scope": "filterbank, session lock and actual ONNX inference; no network"
            })
        );
    }

    #[test]
    fn silence_and_short_replies_cannot_train_a_speaker_reference() {
        assert!(extract(&vec![0; MAX_SAMPLES]).unwrap().is_none());
        assert!(extract(&vec![500; MIN_SAMPLES - 1]).unwrap().is_none());
    }
}
