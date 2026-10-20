use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use ort::{session::Session, value::Tensor};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::error::{Error, Result};

const MAX_ENCODED_BYTES: usize = 2 * 1024 * 1024;
const MAX_PCM_BYTES: usize = 60 * 16000 * 2;

pub struct Gate {
    slots: Arc<Semaphore>,
}

impl Gate {
    pub fn new() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(2)),
        }
    }

    pub async fn verify(&self, audio: &crate::talk::Audio) -> Result<()> {
        if audio.data.len() > MAX_ENCODED_BYTES * 4 / 3 + 4 {
            return Err(invalid_audio());
        }
        let data = base64::engine::general_purpose::STANDARD
            .decode(&audio.data)
            .map_err(|_| invalid_audio())?;
        if data.is_empty() || data.len() > MAX_ENCODED_BYTES {
            return Err(invalid_audio());
        }
        let slot = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Unavailable("Speech detection"))?;
        let samples = tokio::time::timeout(Duration::from_secs(3), decode(data))
            .await
            .map_err(|_| Error::Unavailable("Speech detection"))??;
        let speech = tokio::task::spawn_blocking(move || {
            let _slot = slot;
            has_speech(&samples)
        })
        .await
        .map_err(|_| Error::Unavailable("Speech detection"))??;
        if speech {
            Ok(())
        } else {
            Err(Error::NoSpeech)
        }
    }
}

pub fn check_runtime() -> Result<()> {
    has_speech(&[0; 1536]).map(|_| ())
}

fn invalid_audio() -> Error {
    Error::Invalid("Use a valid audio recording shorter than one minute.".into())
}

async fn decode(data: Vec<u8>) -> Result<Vec<i16>> {
    let mut child = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-threads",
            "1",
            "-protocol_whitelist",
            "pipe",
            "-i",
            "pipe:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-t",
            "61",
            "-f",
            "s16le",
            "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| Error::Unavailable("Speech detection"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or(Error::Unavailable("Speech detection"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or(Error::Unavailable("Speech detection"))?;
    let write = async {
        stdin.write_all(&data).await.map_err(|_| invalid_audio())?;
        drop(stdin);
        Ok::<_, Error>(())
    };
    let read = async {
        let mut bytes = Vec::new();
        stdout
            .take((MAX_PCM_BYTES + 2) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| invalid_audio())?;
        if bytes.len() > MAX_PCM_BYTES {
            return Err(invalid_audio());
        }
        Ok::<_, Error>(bytes)
    };
    let (_, bytes) = tokio::try_join!(write, read)?;
    let status = child.wait().await.map_err(|_| invalid_audio())?;
    if !status.success() || bytes.is_empty() || bytes.len() % 2 != 0 {
        return Err(invalid_audio());
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
        .collect())
}

fn has_speech(samples: &[i16]) -> Result<bool> {
    let unavailable = |_| Error::Unavailable("Speech detection");
    let mut session = Session::builder()
        .map_err(unavailable)?
        .with_intra_threads(1)
        .map_err(unavailable)?
        .with_inter_threads(1)
        .map_err(unavailable)?
        .commit_from_memory(include_bytes!("../models/silero-vad-v6.2.onnx"))
        .map_err(unavailable)?;
    let mut state = vec![0_f32; 256];
    let mut context = vec![0_f32; 64];
    let mut consecutive = 0;
    for frame in samples.chunks(512) {
        let mut input = context.clone();
        input.extend(frame.iter().map(|sample| *sample as f32 / 32768.0));
        input.resize(576, 0.0);
        context.copy_from_slice(&input[512..576]);
        let outputs = session.run(ort::inputs![
            "input" => Tensor::from_array(([1, 576], input)).map_err(unavailable)?,
            "state" => Tensor::from_array(([2, 1, 128], state)).map_err(unavailable)?,
            "sr" => Tensor::from_array((Vec::<usize>::new(), vec![16000_i64])).map_err(unavailable)?,
        ]).map_err(unavailable)?;
        let (_, next_state) = outputs
            .get("stateN")
            .ok_or(Error::Unavailable("Speech detection"))?
            .try_extract_tensor::<f32>()
            .map_err(unavailable)?;
        state = next_state.to_vec();
        let (_, probability) = outputs
            .get("output")
            .ok_or(Error::Unavailable("Speech detection"))?
            .try_extract_tensor::<f32>()
            .map_err(unavailable)?;
        if probability.first().copied().unwrap_or(0.0) >= 0.5 {
            consecutive += 1;
            if consecutive >= 3 {
                return Ok(true);
            }
        } else {
            consecutive = 0;
        }
    }
    Ok(false)
}
