use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use gcp_auth::{Token, TokenProvider};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::{fx, gemini, nearby, router, AppState};

struct FakeToken;

#[async_trait::async_trait]
impl TokenProvider for FakeToken {
    async fn token(&self, _: &[&str]) -> Result<Arc<Token>, gcp_auth::Error> {
        Ok(Arc::new(
            serde_json::from_value(json!({ "access_token": "t", "expires_in": 3600 }))
                .expect("token json"),
        ))
    }

    async fn project_id(&self) -> Result<Arc<str>, gcp_auth::Error> {
        Ok("test".into())
    }
}

/// A stand-in for a third-party API: answers every request with one fixed reply and counts hits.
async fn upstream(status: StatusCode, body: Value) -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let app = axum::Router::new().fallback(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        let body = body.clone();
        async move { (status, axum::Json(body)) }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move { axum::serve(listener, app).await });
    (format!("http://{addr}"), hits)
}

fn model_reply(answer: Value) -> Value {
    json!({ "candidates": [{ "content": { "parts": [{ "text": answer.to_string() }] } }] })
}

fn state(gemini_url: &str, fx_url: &str, places: Option<&str>) -> Arc<AppState> {
    let http = reqwest::Client::new();
    Arc::new(AppState {
        ai: Some(gemini::Gemini::with_auth(
            http.clone(),
            gemini_url.into(),
            Arc::new(FakeToken),
        )),
        fx: fx::Fx::new(fx_url),
        places: places.map(|base| nearby::Places {
            key: "k".into(),
            base: base.into(),
        }),
        http,
    })
}

async fn call(
    state: Arc<AppState>,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(body.map_or(Body::empty(), |b| Body::from(b.to_string())))
        .expect("request");
    let res = router(state).oneshot(req).await.expect("response");
    let status = res.status();
    let bytes = res.into_body().collect().await.expect("body").to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn healthz_is_ok() {
    let req = Request::builder()
        .uri("/healthz")
        .body(Body::empty())
        .expect("request");
    let res = router(state("http://unused", "http://unused", None))
        .oneshot(req)
        .await
        .expect("response");
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn partner_speech_is_translated_into_my_language() {
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "language": "th", "confidence": 0.97, "candidates": [],
            "transcript": "ห้องน้ำอยู่ที่ไหน", "to_mine": "Where is the toilet?", "to_partner": "ห้องน้ำอยู่ที่ไหน"
        })),
    )
    .await;
    let (status, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/talk/turn",
        Some(json!({ "mine": "en", "partner": "ja", "text": "ห้องน้ำอยู่ที่ไหน" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["translation"], "Where is the toilet?");
    assert_eq!(body["target"], "en");
    assert_eq!(
        body["partner"], "th",
        "partner follows the language they last spoke"
    );
}

#[tokio::test]
async fn talk_without_input_is_rejected() {
    let (status, body) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/talk/turn",
        Some(json!({ "mine": "en", "partner": "th" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid");
}

#[tokio::test]
async fn model_failure_is_a_friendly_bad_gateway() {
    let (ai, _) = upstream(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "boom" }),
    )
    .await;
    let (status, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/talk/turn",
        Some(json!({ "mine": "en", "partner": "th", "text": "hello" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body["error"], "upstream");
    assert!(
        !body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("boom"),
        "upstream detail must not leak"
    );
}

#[tokio::test]
async fn receipt_total_becomes_minor_units() {
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "merchant": " Som Tam Nua ", "total": "1,250.00", "currency": "THB",
            "date": "2026-09-25", "category": "food", "confidence": 0.9
        })),
    )
    .await;
    let (status, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/receipts/extract",
        Some(json!({ "data": "aGk=", "mimeType": "image/jpeg" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["amountMinor"], 125000);
    assert_eq!(body["currency"], "THB");
    assert_eq!(body["merchant"], "Som Tam Nua");
    assert_eq!(body["category"], "food");
}

#[tokio::test]
async fn unreadable_receipt_total_falls_back_to_local_currency_without_amount() {
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "merchant": "Cafe", "total": "", "currency": "", "date": "", "category": "nonsense", "confidence": 3.0
        })),
    )
    .await;
    let (_, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/receipts/extract",
        Some(json!({ "data": "aGk=", "mimeType": "image/png", "localCurrency": "JPY" })),
    )
    .await;
    assert_eq!(body["amountMinor"], Value::Null);
    assert_eq!(body["currency"], "JPY");
    assert_eq!(body["date"], Value::Null);
    assert_eq!(body["category"], "other");
    assert_eq!(body["confidence"], 1.0);
}

#[tokio::test]
async fn receipt_must_be_an_image() {
    let (status, _) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/receipts/extract",
        Some(json!({ "data": "aGk=", "mimeType": "application/pdf" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ai_routes_without_credentials_are_unavailable() {
    let mut s = state("http://unused", "http://unused", None);
    Arc::get_mut(&mut s).expect("sole owner").ai = None;
    for (uri, body) in [
        (
            "/v1/talk/turn",
            json!({ "mine": "en", "partner": "th", "text": "hi" }),
        ),
        (
            "/v1/receipts/extract",
            json!({ "data": "aGk=", "mimeType": "image/png" }),
        ),
    ] {
        let (status, got) = call(s.clone(), "POST", uri, Some(body)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        assert_eq!(got["error"], "unavailable", "{uri}");
    }
}

#[tokio::test]
async fn nearby_without_places_key_is_unavailable() {
    let (status, body) = call(
        state("http://unused", "http://unused", None),
        "GET",
        "/v1/nearby?lat=13.75&lng=100.5&kind=food",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "unavailable");
}

#[tokio::test]
async fn nearby_returns_ranked_places() {
    let (places, _) = upstream(
        StatusCode::OK,
        json!({ "places": [{
            "id": "p1", "displayName": { "text": "Veg Corner" }, "formattedAddress": "1 Road",
            "location": { "latitude": 13.7564, "longitude": 100.5019 }, "rating": 4.6,
            "servesVegetarianFood": true, "googleMapsUri": "https://maps.example/p1"
        }] }),
    )
    .await;
    let (status, body) = call(
        state("http://unused", "http://unused", Some(&places)),
        "GET",
        "/v1/nearby?lat=13.7563&lng=100.5018&kind=food&diet=vegetarian",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["places"][0]["name"], "Veg Corner");
    assert!(body["places"][0]["why"]
        .as_str()
        .unwrap_or_default()
        .starts_with("Vegetarian options"));
}

#[tokio::test]
async fn places_failure_is_bad_gateway() {
    let (places, _) = upstream(StatusCode::FORBIDDEN, json!({})).await;
    let (status, _) = call(
        state("http://unused", "http://unused", Some(&places)),
        "GET",
        "/v1/nearby?lat=13.75&lng=100.5&kind=atm",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn fx_rates_are_cached_per_base() {
    let (fx_url, hits) = upstream(
        StatusCode::OK,
        json!({ "result": "success", "time_last_update_utc": "Fri, 25 Sep 2026", "rates": { "THB": 36.5 } }),
    )
    .await;
    let s = state("http://unused", &fx_url, None);
    for _ in 0..2 {
        let (status, body) = call(s.clone(), "GET", "/v1/fx?base=USD", None).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["rates"]["THB"], 36.5);
        assert_eq!(body["base"], "USD");
    }
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "second call is served from cache"
    );
}

#[tokio::test]
async fn fx_provider_error_is_bad_gateway() {
    let (fx_url, _) = upstream(
        StatusCode::OK,
        json!({ "result": "error", "time_last_update_utc": "", "rates": {} }),
    )
    .await;
    let (status, _) = call(
        state("http://unused", &fx_url, None),
        "GET",
        "/v1/fx?base=EUR",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
}
