use crate::{
    auth::Customer,
    error::{Error, Result},
    AppState,
};
use ab_glyph::{point, Font, FontArc, ScaleFont};
use axum::{extract::State, http::header, response::IntoResponse, Extension, Json};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageReader, Rgb, RgbImage};
use serde::Deserialize;
use std::{
    collections::HashSet,
    io::Cursor,
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    process::Command,
    sync::{OwnedSemaphorePermit, Semaphore},
};

pub struct Renderer {
    slots: Arc<Semaphore>,
    customers: Mutex<HashSet<String>>,
}
impl Renderer {
    pub fn new() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(2)),
            customers: Mutex::new(HashSet::new()),
        }
    }
}
struct Permit<'a> {
    renderer: &'a Renderer,
    customer: String,
    _slot: OwnedSemaphorePermit,
}
impl Drop for Permit<'_> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.renderer.customers.lock() {
            set.remove(&self.customer);
        }
    }
}
impl Renderer {
    fn acquire(&self, customer: &str) -> Result<Permit<'_>> {
        let slot = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Busy)?;
        let mut set = self.customers.lock().map_err(|_| Error::Busy)?;
        if !set.insert(customer.into()) {
            return Err(Error::Busy);
        }
        Ok(Permit {
            renderer: self,
            customer: customer.into(),
            _slot: slot,
        })
    }
}
mod music;
#[derive(Debug, Default, Deserialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
enum Theme {
    #[default]
    Postcard,
    Cinema,
    Journal,
}
#[derive(Debug, Default, Deserialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
enum Soundtrack {
    #[default]
    None,
    Wander,
    Sunset,
    Upload,
}
#[derive(Debug, Default, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MemoryOptions")]
struct Options {
    #[serde(default)]
    theme: Theme,
    #[serde(default)]
    soundtrack: Soundtrack,
    #[serde(default)]
    opening_caption: String,
    #[serde(default)]
    #[ts(optional)]
    year: Option<u16>,
    #[serde(default)]
    #[ts(optional)]
    audio: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryRequest {
    title: String,
    duration_seconds: u32,
    images: Vec<String>,
    #[serde(default)]
    captions: Vec<String>,
    #[serde(default)]
    options: Options,
}
fn validate(req: &MemoryRequest) -> Result<()> {
    if req.options.opening_caption.chars().count() > 120
        || req
            .options
            .year
            .is_some_and(|year| !(1900..=2200).contains(&year))
        || (req.options.soundtrack == Soundtrack::Upload) != req.options.audio.is_some()
    {
        return Err(Error::Invalid(
            "Check your opening caption and music selection.".into(),
        ));
    }
    if let Some(audio) = &req.options.audio {
        decode_audio(audio)?;
    }

    if req.title.trim().is_empty()
        || req.title.chars().count() > 80
        || ![60, 90].contains(&req.duration_seconds)
        || !(1..=15).contains(&req.images.len())
        || req.images.iter().any(|s| s.is_empty() || s.len() > 700_000)
        || (!req.captions.is_empty() && req.captions.len() != req.images.len())
        || req.captions.iter().any(|s| s.chars().count() > 100)
    {
        return Err(Error::Invalid("Choose 1–15 photos, a title up to 80 characters and a 60 or 90 second video. Photos must be compressed JPEG/PNG.".into()));
    }
    Ok(())
}
fn decode_audio(encoded: &str) -> Result<Vec<u8>> {
    let invalid = || Error::Invalid("Choose an MP3, WAV, M4A or AAC file up to 3 MB.".into());
    if encoded.len() > 4_000_000 {
        return Err(invalid());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
    let wav = bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE");
    let mp4 = bytes.get(4..8) == Some(b"ftyp");
    let mp3_aac = bytes.starts_with(b"ID3")
        || (bytes.len() > 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0);
    if bytes.len() > 3_000_000 || !(wav || mp4 || mp3_aac) {
        return Err(invalid());
    }
    Ok(bytes)
}
pub async fn capabilities() -> Json<serde_json::Value> {
    Json(serde_json::json!({"editorVersion":1,"maxAudioBytes":3000000}))
}
fn io_error(_: impl std::fmt::Display) -> Error {
    Error::Unavailable("Memory rendering")
}
fn text(canvas: &mut RgbImage, font: &FontArc, label: &str, y: f32, size: f32, ink: [f32; 3]) {
    let scaled = font.as_scaled(size);
    let mut x = 45.0;
    let mut baseline = y;
    let mut lines = 0;
    for c in label.chars() {
        let id = font.glyph_id(if c.is_control() { ' ' } else { c });
        let advance = scaled.h_advance(id);
        if x + advance > 675.0 {
            x = 45.0;
            baseline += size * 1.3;
            lines += 1;
            if lines > if size >= 40.0 { 4 } else { 2 } {
                break;
            }
        }
        let glyph = id.with_scale_and_position(size, point(x, baseline));
        if let Some(outline) = font.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            outline.draw(|gx, gy, alpha| {
                let px = gx as i32 + bounds.min.x as i32;
                let py = gy as i32 + bounds.min.y as i32;
                if (0..720).contains(&px) && (0..1280).contains(&py) {
                    let pixel = canvas.get_pixel_mut(px as u32, py as u32);
                    for (channel, ink) in pixel.0.iter_mut().zip(ink) {
                        *channel = (*channel as f32 * (1.0 - alpha) + ink * alpha) as u8;
                    }
                }
            });
        }
        x += advance;
    }
}
fn prepare(req: MemoryRequest) -> Result<(tempfile::TempDir, u32, usize, bool)> {
    let dir = tempfile::Builder::new()
        .prefix("roamie-memory-")
        .tempdir()
        .map_err(io_error)?;
    let (background, ink) = match req.options.theme {
        Theme::Postcard => ([249, 244, 236], [42.0, 78.0, 76.0]),
        Theme::Cinema => ([20, 26, 36], [241.0, 235.0, 219.0]),
        Theme::Journal => ([244, 236, 215], [82.0, 59.0, 42.0]),
    };
    let font_path = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    .into_iter()
    .find(|p| Path::new(p).is_file())
    .ok_or(Error::Unavailable("Memory font"))?;
    let font =
        FontArc::try_from_vec(std::fs::read(font_path).map_err(io_error)?).map_err(io_error)?;
    let heading_path = match req.options.theme {
        Theme::Journal => [
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
        ],
        _ => [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ],
    }
    .into_iter()
    .find(|p| Path::new(p).is_file())
    .unwrap_or(font_path);
    let heading =
        FontArc::try_from_vec(std::fs::read(heading_path).map_err(io_error)?).map_err(io_error)?;
    let opening = if req.options.opening_caption.trim().is_empty() {
        req.title.clone()
    } else {
        req.options.opening_caption.trim().to_owned()
    };
    for (filename, title, subtitle) in [
        (
            "intro.jpg",
            opening,
            req.options
                .year
                .map(|year| format!("TRAVEL MEMORIES  ·  {year}"))
                .unwrap_or_else(|| "TRAVEL MEMORIES".into()),
        ),
        (
            "outro.jpg",
            "Until the next adventure".into(),
            "MADE WITH ROAMIE".into(),
        ),
    ] {
        let mut canvas = RgbImage::from_pixel(720, 1280, Rgb(background));
        for y in 420..426 {
            for x in 45..145 {
                canvas.put_pixel(x, y, Rgb(ink.map(|v| v as u8)));
            }
        }
        text(&mut canvas, &heading, &title, 480.0, 44.0, ink);
        text(&mut canvas, &font, &subtitle, 850.0, 22.0, ink);
        canvas.save(dir.path().join(filename)).map_err(io_error)?;
    }
    let audio = match req.options.soundtrack {
        Soundtrack::None => None,
        Soundtrack::Wander => Some(music::instrumental(false)),
        Soundtrack::Sunset => Some(music::instrumental(true)),
        Soundtrack::Upload => Some(decode_audio(req.options.audio.as_deref().unwrap_or(""))?),
    };
    let has_audio = audio.is_some();
    if let Some(bytes) = audio {
        std::fs::write(dir.path().join("audio"), bytes).map_err(io_error)?;
    }
    for (i, data) in req.images.iter().enumerate() {
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| Error::Invalid("Photo encoding is invalid.".into()))?;
        let format = image::guess_format(&bytes)
            .map_err(|_| Error::Invalid("Choose a JPEG or PNG photo.".into()))?;
        if !matches!(format, image::ImageFormat::Jpeg | image::ImageFormat::Png) {
            return Err(Error::Invalid("Choose a JPEG or PNG photo.".into()));
        }
        let (w, h) = ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| Error::Invalid("Unreadable photo.".into()))?;
        if w == 0 || h == 0 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 20_000_000 {
            return Err(Error::Invalid("Photo resolution is too large.".into()));
        }
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(100_000_000);
        reader.limits(limits);
        let photo = reader
            .decode()
            .map_err(|_| Error::Invalid("Unreadable photo.".into()))?
            .resize(640, 870, image::imageops::FilterType::Triangle)
            .to_rgb8();
        let mut canvas = RgbImage::from_pixel(720, 1280, Rgb(background));
        image::imageops::overlay(
            &mut canvas,
            &photo,
            ((720 - photo.width()) / 2) as i64,
            210 + ((870 - photo.height()) / 2) as i64,
        );
        text(&mut canvas, &heading, &req.title, 80.0, 32.0, ink);
        text(
            &mut canvas,
            &font,
            req.captions
                .get(i)
                .map(String::as_str)
                .unwrap_or("A moment to remember"),
            1150.0,
            26.0,
            ink,
        );
        text(
            &mut canvas,
            &font,
            &format!("ROAMIE    {} / {}", i + 1, req.images.len()),
            1245.0,
            16.0,
            ink,
        );
        canvas
            .save(dir.path().join(format!("frame{i:02}.jpg")))
            .map_err(io_error)?;
    }
    Ok((dir, req.duration_seconds, req.images.len(), has_audio))
}
async fn video(req: MemoryRequest) -> Result<Vec<u8>> {
    validate(&req)?;
    let (dir, duration, count, has_audio) = tokio::task::spawn_blocking(move || prepare(req))
        .await
        .map_err(io_error)??;
    let remaining = duration * 24 - 120;
    let mut scenes = vec![("intro.jpg".to_owned(), 72)];
    for i in 0..count {
        scenes.push((
            format!("frame{i:02}.jpg"),
            remaining / count as u32 + u32::from((i as u32) < remaining % count as u32),
        ));
    }
    scenes.push(("outro.jpg".to_owned(), 48));
    let mut concat = String::new();
    for (i, (image, frames)) in scenes.iter().enumerate() {
        let clip = format!("clip{i:02}.mp4");
        let end = *frames as f32 / 24.0 - 0.25;
        let filter = format!("zoompan=z='1+0.025*on/{frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={frames}:s=720x1280:fps=24,fade=t=in:st=0:d=0.25,fade=t=out:st={end}:d=0.25,format=yuv420p");
        let status = Command::new("ffmpeg")
            .current_dir(dir.path())
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-threads",
                "2",
                "-i",
                image,
                "-vf",
                &filter,
                "-frames:v",
                &frames.to_string(),
                "-an",
                "-c:v",
                "libx264",
                "-threads",
                "2",
                "-filter_threads",
                "1",
                "-preset",
                "ultrafast",
                "-crf",
                "24",
                "-y",
                &clip,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status()
            .await
            .map_err(io_error)?;
        if !status.success() {
            return Err(Error::Unavailable("Memory scene rendering"));
        }
        concat.push_str(&format!("file '{clip}'\n"));
    }
    std::fs::write(dir.path().join("clips.txt"), concat).map_err(io_error)?;
    let output = dir.path().join("memory.mp4");
    let mut command = Command::new("ffmpeg");
    command.current_dir(dir.path()).args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        "clips.txt",
    ]);
    if has_audio {
        command.args([
            "-stream_loop",
            "-1",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mp3,wav,mov,aac",
            "-i",
            "audio",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-af",
            &format!(
                "volume=0.65,apad,afade=t=in:d=1,afade=t=out:st={}:d=2",
                duration - 2
            ),
        ]);
    } else {
        command.arg("-an");
    }
    let status = command
        .args([
            "-c:v",
            "copy",
            "-t",
            &duration.to_string(),
            "-movflags",
            "+faststart",
            "-map_metadata",
            "-1",
            "-fs",
            "30000000",
            "-y",
        ])
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .status()
        .await
        .map_err(io_error)?;
    if !status.success() {
        return Err(Error::Invalid(
            "The music could not be decoded. Try another audio file or no music.".into(),
        ));
    }
    let metadata = tokio::fs::metadata(&output).await.map_err(io_error)?;
    if metadata.len() == 0 || metadata.len() >= 29_900_000 {
        return Err(Error::Unavailable("Memory output exceeded its limit"));
    }
    tokio::fs::read(output).await.map_err(io_error)
}
pub async fn render(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Json(req): Json<MemoryRequest>,
) -> Result<impl IntoResponse> {
    validate(&req)?;
    let _permit = state.memories.acquire(&customer.sub)?;
    let bytes = tokio::time::timeout(Duration::from_secs(85), video(req))
        .await
        .map_err(|_| Error::Unavailable("Memory render timed out"))??;
    Ok((
        [
            (header::CONTENT_TYPE, "video/mp4"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=roamie-memory.mp4",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_memory_contract() {
        use ts_rs::TS;
        let types = [Theme::decl(), Soundtrack::decl(), Options::decl()];
        std::fs::write(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/mobile/src/lib/memory-contract.ts"
            ),
            format!(
                "// Generated from Rust memories.rs; run cargo test export_memory_contract.\n{}\n",
                types
                    .into_iter()
                    .map(|t| format!("export {t}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        )
        .expect("write memory contract");
    }
    #[test]
    fn only_one_render_per_customer_and_two_total() {
        let r = Renderer::new();
        let a = r.acquire("a").expect("a");
        assert!(r.acquire("a").is_err());
        let b = r.acquire("b").expect("b");
        assert!(r.acquire("c").is_err());
        drop(a);
        assert!(r.acquire("c").is_ok());
        drop(b);
    }
    #[test]
    fn editing_options_validate_theme_audio_and_caption() {
        let base = serde_json::json!({"title":"Trip","durationSeconds":60,"images":["YWJj"]});
        let mut req = base.clone();
        req["options"] = serde_json::json!({"theme":"unknown"});
        assert!(serde_json::from_value::<MemoryRequest>(req).is_err());
        let mut req = base.clone();
        req["options"] = serde_json::json!({"openingCaption":"x".repeat(121)});
        assert!(validate(&serde_json::from_value(req).unwrap()).is_err());
        let mut req = base;
        req["options"] =
            serde_json::json!({"soundtrack":"upload","audio":"aHR0cHM6Ly9leGFtcGxlLmNvbQ=="});
        assert!(validate(&serde_json::from_value(req).unwrap()).is_err());
    }
    #[tokio::test]
    async fn invalid_image_is_rejected_without_running_ffmpeg() {
        let req = MemoryRequest {
            title: "Trip".into(),
            duration_seconds: 60,
            images: vec![STANDARD.encode("not an image")],
            captions: vec![],
            options: Options::default(),
        };
        assert!(matches!(video(req).await, Err(Error::Invalid(_))));
    }
}

#[cfg(all(test, media_tests))]
mod media_tests {
    use super::*;
    #[tokio::test]
    async fn real_mp4_has_exact_duration_and_all_selected_frames() {
        for (count, seconds) in [(1, 60), (15, 90), (2, 60), (3, 60)] {
            let mut images = Vec::new();
            for i in 0..count {
                let mut photo = RgbImage::from_pixel(320, 240, Rgb([50 + i * 10, 130, 180]));
                for (x, y, p) in photo.enumerate_pixels_mut() {
                    if (x / 30 + y / 30) % 2 == 0 {
                        *p = Rgb([220, 190, 90 + i * 5]);
                    }
                }
                let mut bytes = Vec::new();
                image::codecs::jpeg::JpegEncoder::new(&mut bytes)
                    .encode_image(&photo)
                    .expect("jpeg");
                images.push(STANDARD.encode(bytes));
            }
            let bytes = tokio::time::timeout(
                Duration::from_secs(120),
                video(MemoryRequest {
                    title: "A little Japan adventure".into(),
                    duration_seconds: seconds,
                    images,
                    captions: vec!["A moment to remember".into(); count as usize],
                    options: Options {
                        soundtrack: match count {
                            1 => Soundtrack::None,
                            2 => Soundtrack::Upload,
                            3 => Soundtrack::Sunset,
                            _ => Soundtrack::Wander,
                        },
                        audio: (count == 2).then(|| STANDARD.encode(music::instrumental(true))),
                        theme: match count {
                            2 => Theme::Cinema,
                            3 => Theme::Journal,
                            _ => Theme::Postcard,
                        },
                        opening_caption: if count == 2 {
                            "My best trip".into()
                        } else {
                            String::new()
                        },
                        year: Some(2026),
                        ..Options::default()
                    },
                }),
            )
            .await
            .expect("render deadline")
            .expect("render");
            let dir = tempfile::tempdir().expect("output dir");
            let path = dir.path().join("memory.mp4");
            std::fs::write(&path, &bytes).expect("write MP4");
            let probe = Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration:stream=codec_name,width,height,nb_frames",
                    "-of",
                    "json",
                ])
                .arg(&path)
                .output()
                .await
                .expect("ffprobe installed");
            assert!(probe.status.success());
            let data: serde_json::Value =
                serde_json::from_slice(&probe.stdout).expect("probe JSON");
            assert_eq!(data["streams"][0]["codec_name"], "h264");
            if count == 1 {
                assert_eq!(data["streams"].as_array().expect("streams").len(), 1);
            } else {
                assert_eq!(data["streams"][1]["codec_name"], "aac");
            }
            assert_eq!(data["streams"][0]["width"], 720);
            assert_eq!(data["streams"][0]["height"], 1280);
            assert!(
                (data["format"]["duration"]
                    .as_str()
                    .expect("duration")
                    .parse::<f64>()
                    .expect("seconds")
                    - f64::from(seconds))
                .abs()
                    < 0.1
            );
            assert_eq!(
                data["streams"][0]["nb_frames"]
                    .as_str()
                    .expect("frames")
                    .parse::<u32>()
                    .expect("frame count"),
                seconds * 24
            );
            if let Ok(artifacts) = std::env::var("ROAMIE_TEST_ARTIFACTS") {
                std::fs::create_dir_all(&artifacts).expect("artifacts");
                std::fs::write(
                    Path::new(&artifacts).join(format!("memory-{count}-{seconds}.mp4")),
                    bytes,
                )
                .expect("artifact");
            }
        }
    }
}
