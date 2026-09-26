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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryRequest {
    title: String,
    duration_seconds: u32,
    images: Vec<String>,
    #[serde(default)]
    captions: Vec<String>,
}
fn validate(req: &MemoryRequest) -> Result<()> {
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
fn io_error(_: impl std::fmt::Display) -> Error {
    Error::Unavailable("Memory rendering")
}
fn text(canvas: &mut RgbImage, font: &FontArc, label: &str, y: f32, size: f32) {
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
            if lines > 2 {
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
                    for (channel, ink) in pixel.0.iter_mut().zip([79.0, 52.0, 107.0]) {
                        *channel = (*channel as f32 * (1.0 - alpha) + ink * alpha) as u8;
                    }
                }
            });
        }
        x += advance;
    }
}
fn prepare(req: MemoryRequest) -> Result<(tempfile::TempDir, u32, usize)> {
    let dir = tempfile::Builder::new()
        .prefix("roamie-memory-")
        .tempdir()
        .map_err(io_error)?;
    let font_path = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    .into_iter()
    .find(|p| Path::new(p).is_file())
    .ok_or(Error::Unavailable("Memory font"))?;
    let font =
        FontArc::try_from_vec(std::fs::read(font_path).map_err(io_error)?).map_err(io_error)?;
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
        let mut canvas = RgbImage::from_pixel(720, 1280, Rgb([246, 240, 250]));
        image::imageops::overlay(
            &mut canvas,
            &photo,
            ((720 - photo.width()) / 2) as i64,
            210 + ((870 - photo.height()) / 2) as i64,
        );
        text(&mut canvas, &font, &req.title, 80.0, 32.0);
        text(
            &mut canvas,
            &font,
            req.captions
                .get(i)
                .map(String::as_str)
                .unwrap_or("A moment to remember"),
            1150.0,
            24.0,
        );
        text(
            &mut canvas,
            &font,
            &format!("ROAMIE    {} / {}", i + 1, req.images.len()),
            1245.0,
            16.0,
        );
        canvas
            .save(dir.path().join(format!("frame{i:02}.jpg")))
            .map_err(io_error)?;
    }
    Ok((dir, req.duration_seconds, req.images.len()))
}
async fn video(req: MemoryRequest) -> Result<Vec<u8>> {
    let (dir, duration, count) = tokio::task::spawn_blocking(move || prepare(req))
        .await
        .map_err(io_error)??;
    let frames = duration * 24;
    let hold = frames.div_ceil(count as u32);
    let output = dir.path().join("memory.mp4");
    let filter=format!("zoompan=z='min(1+on*0.000005,1.015)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={hold}:s=720x1280:fps=24,fade=t=in:st=0:d=0.7,fade=t=out:st={}:d=0.7,format=yuv420p",duration as f32-0.7);
    let mut command = Command::new("ffmpeg");
    command
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-threads",
            "2",
            "-framerate",
            "1",
            "-i",
        ])
        .arg(dir.path().join("frame%02d.jpg"))
        .args([
            "-vf",
            &filter,
            "-frames:v",
            &frames.to_string(),
            "-an",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-preset",
            "ultrafast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
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
        .kill_on_drop(true);
    let child = command.spawn().map_err(io_error)?;
    let result = child.wait_with_output().await.map_err(io_error)?;
    if !result.status.success() {
        return Err(Error::Unavailable("Memory rendering"));
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
    #[tokio::test]
    async fn invalid_image_is_rejected_without_running_ffmpeg() {
        let req = MemoryRequest {
            title: "Trip".into(),
            duration_seconds: 60,
            images: vec![STANDARD.encode("not an image")],
            captions: vec![],
        };
        assert!(matches!(video(req).await, Err(Error::Invalid(_))));
    }
}

#[cfg(all(test, feature = "media-tests"))]
mod media_tests {
    use super::*;
    #[tokio::test]
    async fn real_mp4_has_exact_duration_and_all_selected_frames() {
        for (count, seconds) in [(1, 60), (15, 90)] {
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
