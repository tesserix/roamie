use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::time::Instant;

use crate::error::{Error, Result};

const MAX_LINES: usize = 80;

/// Client for the shared Document Intelligence OCR service, signed as the Roamie product.
pub struct Ocr {
    pub http: reqwest::Client,
    pub upload_base: String,
    pub job_base: String,
    pub key_id: String,
    pub secret: Vec<u8>,
    pub tenant: String,
    pub deadline: Duration,
}

impl std::fmt::Debug for Ocr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ocr")
            .field("upload_base", &self.upload_base)
            .field("key_id", &self.key_id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

/// Axis-aligned box in page fractions, so the client can overlay it on any image size.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn around(points: &[Point]) -> Option<Self> {
        let (mut x0, mut y0, mut x1, mut y1) = (1f32, 1f32, 0f32, 0f32);
        for p in points {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        (x1 > x0 && y1 > y0).then_some(Self {
            x: x0,
            y: y0,
            w: x1 - x0,
            h: y1 - y0,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub text: String,
    pub rect: Rect,
}

#[derive(Debug, Deserialize)]
struct Upload {
    upload_id: String,
    #[serde(default)]
    upload_url: String,
    #[serde(default)]
    required_headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    status: String,
}

#[derive(Debug, Deserialize)]
struct Job {
    job_id: String,
    status: String,
}

#[derive(Debug, Deserialize)]
pub struct DocResult {
    pub pages: Vec<Page>,
}

#[derive(Debug, Deserialize)]
pub struct Page {
    pub observations: Vec<Observation>,
}

#[derive(Debug, Deserialize)]
pub struct Observation {
    pub level: String,
    pub text: String,
    pub polygon: Polygon,
    pub reading_order: u32,
}

#[derive(Debug, Deserialize)]
pub struct Polygon {
    pub points: Vec<Point>,
}

/// Lines of the first page in reading order; paragraphs stand in when the provider gives no lines.
pub fn lines(result: DocResult) -> Vec<Line> {
    let Some(page) = result.pages.into_iter().next() else {
        return Vec::new();
    };
    let level = if page.observations.iter().any(|o| o.level == "line") {
        "line"
    } else {
        "paragraph"
    };
    let mut picked: Vec<Observation> = page
        .observations
        .into_iter()
        .filter(|o| o.level == level && !o.text.trim().is_empty())
        .collect();
    picked.sort_by_key(|o| o.reading_order);
    picked
        .into_iter()
        .filter_map(|o| {
            Some(Line {
                rect: Rect::around(&o.polygon.points)?,
                text: o.text.trim().to_string(),
            })
        })
        .take(MAX_LINES)
        .collect()
}

/// Mirrors the OCR service's `TenantId`: `ten_` then 1–64 of `[A-Za-z0-9_]`.
pub fn valid_tenant(tenant: &str) -> bool {
    tenant.strip_prefix("ten_").is_some_and(|s| {
        !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    })
}

pub fn sign(
    secret: &[u8],
    key_id: &str,
    tenant: &str,
    ts: u64,
    method: &str,
    path: &str,
) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(format!("{key_id}\n{tenant}\n{ts}\n{method}\n{path}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

impl Ocr {
    /// Runs one photo through upload, inspection and extraction, bounded by `deadline`.
    pub async fn read(&self, bytes: Vec<u8>, mime: &str) -> Result<Vec<Line>> {
        let until = Instant::now() + self.deadline;
        let digest = hex::encode(Sha256::digest(&bytes));
        let key = format!("roamie-{}-{}", &digest[..32], now() / 600);

        let upload: Upload = self
            .call(
                Method::POST,
                &self.upload_base,
                "/v1/ocr/uploads".into(),
                Some(json!({ "content_type": mime, "content_length": bytes.len(), "sha256": format!("sha256:{digest}") })),
                Some(&format!("{key}-u")),
            )
            .await?;
        let mut put = self.http.put(&upload.upload_url).body(bytes);
        for (k, v) in &upload.required_headers {
            put = put.header(k, v);
        }
        let stored = put.send().await?.status();
        if !stored.is_success() {
            return Err(Error::Upstream(format!("ocr upload put {stored}")));
        }
        let id = &upload.upload_id;
        let _: Upload = self
            .call(
                Method::POST,
                &self.upload_base,
                format!("/v1/ocr/uploads/{id}/complete"),
                None,
                None,
            )
            .await?;
        self.wait(
            until,
            |s: &Upload| match s.status.as_str() {
                "accepted" => Some(Ok(())),
                "rejected" | "expired" => Some(Err(Error::Unreadable)),
                _ => None,
            },
            &self.upload_base,
            format!("/v1/ocr/uploads/{id}"),
        )
        .await?;

        let job: Job = self
            .call(
                Method::POST,
                &self.job_base,
                "/v1/ocr/jobs".into(),
                Some(json!({
                    "source": { "upload_id": id },
                    "document_type": "general",
                    "output": { "text": true, "markdown": false, "layout": true, "evidence": false },
                    "processing_class": "interactive"
                })),
                Some(&format!("{key}-j")),
            )
            .await?;
        let jid = job.job_id;
        if !done(&job.status) {
            self.wait(
                until,
                |j: &Job| {
                    if done(&j.status) {
                        Some(Ok(()))
                    } else if matches!(j.status.as_str(), "rejected" | "cancelled" | "cancelling") {
                        Some(Err(Error::Unreadable))
                    } else {
                        None
                    }
                },
                &self.job_base,
                format!("/v1/ocr/jobs/{jid}"),
            )
            .await?;
        }
        let result: DocResult = self
            .call(
                Method::GET,
                &self.job_base,
                format!("/v1/ocr/jobs/{jid}/result"),
                None,
                None,
            )
            .await?;
        Ok(lines(result))
    }

    async fn wait<T: DeserializeOwned>(
        &self,
        until: Instant,
        settled: impl Fn(&T) -> Option<Result<()>>,
        base: &str,
        path: String,
    ) -> Result<()> {
        let mut pause = Duration::from_millis(250);
        loop {
            let state: T = self
                .call(Method::GET, base, path.clone(), None, None)
                .await?;
            if let Some(outcome) = settled(&state) {
                return outcome;
            }
            if Instant::now() + pause > until {
                return Err(Error::Upstream("ocr deadline exceeded".into()));
            }
            tokio::time::sleep(pause).await;
            pause = (pause * 3 / 2).min(Duration::from_secs(1));
        }
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        base: &str,
        path: String,
        body: Option<Value>,
        idempotency: Option<&str>,
    ) -> Result<T> {
        let ts = now();
        let signature = sign(
            &self.secret,
            &self.key_id,
            &self.tenant,
            ts,
            method.as_str(),
            &path,
        );
        let mut req = self
            .http
            .request(method, format!("{base}{path}"))
            .header("X-OCR-Key-Id", &self.key_id)
            .header("X-OCR-Tenant-Id", &self.tenant)
            .header("X-OCR-Timestamp", ts.to_string())
            .header("X-OCR-Signature", signature);
        if let Some(key) = idempotency {
            req = req.header("Idempotency-Key", key);
        }
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().await?;
        let status = res.status();
        if !status.is_success() {
            let code = res
                .json::<Value>()
                .await
                .ok()
                .and_then(|v| v["code"].as_str().map(str::to_string))
                .unwrap_or_default();
            return Err(Error::Upstream(format!("ocr {status} {code}")));
        }
        Ok(res.json().await?)
    }
}

fn done(status: &str) -> bool {
    matches!(status, "completed" | "partial" | "review_required")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_like_the_ocr_service_verifies() {
        let got = sign(
            &hex::decode("00112233445566778899aabbccddeeff").unwrap(),
            "roamie-v1",
            "roamie-public",
            1_790_000_000,
            "POST",
            "/v1/ocr/uploads",
        );
        assert_eq!(
            got,
            "b7f53c908733d93e2b1e1fa1104ea4623851f33171565154079c8674644e606d"
        );
    }

    #[test]
    fn accepts_only_tenants_the_ocr_service_accepts() {
        let cases = [
            ("ten_roamie_public", true),
            ("ten_A1", true),
            ("roamie-public", false),
            ("ten_", false),
            ("ten_roamie-public", false),
            (&*format!("ten_{}", "a".repeat(65)), false),
        ];
        for (tenant, ok) in cases {
            assert_eq!(valid_tenant(tenant), ok, "case {tenant}");
        }
    }

    fn p(x: f32, y: f32) -> Point {
        Point { x, y }
    }

    #[test]
    fn boxes_a_polygon() {
        let got = Rect::around(&[p(0.2, 0.5), p(0.6, 0.4), p(0.6, 0.6), p(0.2, 0.6)]).unwrap();
        assert!(
            (got.x - 0.2).abs() < 1e-6 && (got.y - 0.4).abs() < 1e-6,
            "{got:?}"
        );
        assert!(
            (got.w - 0.4).abs() < 1e-6 && (got.h - 0.2).abs() < 1e-6,
            "{got:?}"
        );
        assert_eq!(
            Rect::around(&[p(0.3, 0.3), p(0.3, 0.3), p(0.3, 0.3)]),
            None,
            "degenerate"
        );
    }

    fn obs(level: &str, text: &str, order: u32) -> Observation {
        Observation {
            level: level.into(),
            text: text.into(),
            reading_order: order,
            polygon: Polygon {
                points: vec![p(0.1, 0.1), p(0.5, 0.1), p(0.5, 0.2)],
            },
        }
    }

    #[test]
    fn picks_lines_in_reading_order() {
        let result = DocResult {
            pages: vec![Page {
                observations: vec![
                    obs("word", "出口", 0),
                    obs("line", "Exit", 2),
                    obs("line", "出口", 1),
                    obs("line", "   ", 3),
                ],
            }],
        };
        let got: Vec<String> = lines(result).into_iter().map(|l| l.text).collect();
        assert_eq!(got, ["出口", "Exit"]);
    }

    #[test]
    fn falls_back_to_paragraphs() {
        let result = DocResult {
            pages: vec![Page {
                observations: vec![obs("paragraph", "禁止停车", 0), obs("word", "禁止", 1)],
            }],
        };
        assert_eq!(lines(result)[0].text, "禁止停车");
        assert!(lines(DocResult { pages: vec![] }).is_empty(), "no pages");
    }
}
