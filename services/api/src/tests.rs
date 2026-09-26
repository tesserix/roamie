use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

pub(crate) fn state(gemini_url: &str, fx_url: &str, places: Option<&str>) -> Arc<AppState> {
    let http = reqwest::Client::new();
    Arc::new(AppState {
        trip_manager: None,
        travel_mcp_key: None,
        auth: None,
        development_auth_disabled: true,
        database: None,
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
        ocr: None,
        memories: crate::memories::Renderer::new(),
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

fn city(id: &str, name: &str, address: &str, code: &str, country: &str) -> Value {
    json!({
        "id": id, "displayName": { "text": name }, "formattedAddress": address,
        "addressComponents": [
            { "longText": name, "shortText": name, "types": ["locality", "political"] },
            { "longText": country, "shortText": code, "types": ["country", "political"] }
        ]
    })
}

#[tokio::test]
async fn destination_search_returns_cities_from_any_country() {
    let (places, _) = upstream(
        StatusCode::OK,
        json!({ "places": [
            city("hn", "Hanoi", "Hanoi, Vietnam", "VN", "Vietnam"),
            city("hn", "Hanoi", "Hanoi, Vietnam", "VN", "Vietnam"),
            city("pa", "Paris", "Paris, France", "FR", "France"),
            { "id": "sea", "displayName": { "text": "Open sea" }, "formattedAddress": "Ocean" }
        ] }),
    )
    .await;
    let (status, body) = call(
        state("http://unused", "http://unused", Some(&places)),
        "POST",
        "/v1/destinations/search",
        Some(json!({ "query": "Hanoi" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!([
            { "placeId": "hn", "name": "Hanoi", "label": "Hanoi, Vietnam", "countryCode": "VN", "country": "Vietnam" },
            { "placeId": "pa", "name": "Paris", "label": "Paris, France", "countryCode": "FR", "country": "France" }
        ])
    );
}

#[tokio::test]
async fn destination_search_includes_verified_coordinates() {
    let mut place = city("hn", "Hanoi", "Hanoi, Vietnam", "VN", "Vietnam");
    place["location"] = json!({"latitude":21.03,"longitude":105.85});
    let (places, _) = upstream(StatusCode::OK, json!({"places":[place]})).await;
    let (status, body) = call(
        state("http://unused", "http://unused", Some(&places)),
        "POST",
        "/v1/destinations/search",
        Some(json!({"query":"Hanoi"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["latitude"], 21.03);
    assert_eq!(body[0]["longitude"], 105.85);
}

#[tokio::test]
async fn destination_search_rejects_short_queries_before_places() {
    let (places, hits) = upstream(StatusCode::OK, json!({ "places": [] })).await;
    let (status, _) = call(
        state("http://unused", "http://unused", Some(&places)),
        "POST",
        "/v1/destinations/search",
        Some(json!({ "query": " H " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn destination_search_without_places_key_is_unavailable() {
    let (status, _) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/destinations/search",
        Some(json!({ "query": "Hanoi" })),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

fn trip_places() -> Value {
    let place = |id: &str, name: &str| {
        json!({
            "id": id, "displayName": { "text": name }, "formattedAddress": "Hanoi",
            "location": { "latitude": 21.03, "longitude": 105.85 },
            "googleMapsUri": format!("https://maps.google.com/?cid={id}")
        })
    };
    json!({ "places": [place("p1", "Temple of Literature"), place("p2", "Pho Bat Dan"), place("p3", "Cha Ca La Vong")] })
}

fn draft_stop(time: &str, kind: &str, place: &str) -> Value {
    let transport: Vec<Value> = ["taxi", "bicycle", "rentalCar", "publicTransport", "walk"]
        .iter()
        .map(|mode| json!({ "mode": mode, "minutes": 10, "costMinor": 0, "note": "Estimate" }))
        .collect();
    json!({ "time": time, "minutes": 60, "kind": kind, "placeId": place, "note": "", "costMinor": 1000, "transport": transport })
}

fn plan_request() -> Value {
    json!({
        "title": "Vietnam", "destination": "Hanoi, Vietnam", "startDate": "2026-11-02", "endDate": "2026-11-02",
        "currency": "VND", "budgetMinor": 0, "diet": "none", "interests": "Shopping, Street food", "travellers": 1
    })
}

#[tokio::test]
async fn trip_plan_uses_only_verified_places() {
    let (places, _) = upstream(StatusCode::OK, trip_places()).await;
    let draft = json!({ "days": [{ "date": "2026-11-02", "stops": [
        draft_stop("09:00", "sight", "p1"), draft_stop("12:00", "lunch", "p2"), draft_stop("19:00", "dinner", "p3")
    ] }] });
    let (gemini, _) = upstream(StatusCode::OK, model_reply(draft)).await;
    let (status, body) = call(
        state(&gemini, "http://unused", Some(&places)),
        "POST",
        "/v1/trips/plan",
        Some(plan_request()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["days"][0]["stops"][0]["title"], "Temple of Literature");
    assert_eq!(body["days"][0]["stops"][2]["place"]["id"], "p3");
}

#[tokio::test]
async fn trip_plan_drops_invented_places() {
    let (places, _) = upstream(StatusCode::OK, trip_places()).await;
    let draft = json!({ "days": [{ "date": "2026-11-02", "stops": [
        draft_stop("09:00", "sight", "invented"), draft_stop("12:00", "lunch", "p2"), draft_stop("19:00", "dinner", "p3")
    ] }] });
    let (gemini, _) = upstream(StatusCode::OK, model_reply(draft)).await;
    let (status, body) = call(
        state(&gemini, "http://unused", Some(&places)),
        "POST",
        "/v1/trips/plan",
        Some(plan_request()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let ids: Vec<_> = body["days"][0]["stops"]
        .as_array()
        .expect("stops")
        .iter()
        .map(|s| s["place"]["id"].as_str().expect("place id"))
        .collect();
    assert_eq!(
        ids,
        ["p2", "p3"],
        "only verified places reach the traveller"
    );
}

#[tokio::test]
async fn memory_render_rejects_requests_without_photos() {
    let (status, body) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/memories/render",
        Some(json!({ "title": "Hanoi", "durationSeconds": 60, "images": [], "captions": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn memory_editor_capabilities_and_large_render_body() {
    let (status, body) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/memories/capabilities",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["editorVersion"], 1);
    let (status, _) = call(state("http://unused", "http://unused", None), "POST", "/v1/memories/render", Some(json!({"title":"Test", "durationSeconds":60,"images":["A".repeat(699_000),"A".repeat(699_000),"A".repeat(699_000),"A".repeat(699_000)]}))).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "large valid-sized request must reach image validation, not JSON's default 2 MiB limit"
    );
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

#[tokio::test]
async fn text_is_translated_with_pronunciation() {
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "language": "en", "translation": "ขอบคุณครับ", "romanized": "khob khun khrap",
            "source_romanized": "", "alternatives": ["ขอบคุณมากครับ", " "]
        })),
    )
    .await;
    let (status, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/translate/text",
        Some(json!({ "text": "Thank you", "to": "th" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["detected"], "en");
    assert_eq!(body["translation"], "ขอบคุณครับ");
    assert_eq!(body["romanized"], "khob khun khrap");
    assert_eq!(body["alternatives"], json!(["ขอบคุณมากครับ"]));
}

#[tokio::test]
async fn blank_text_is_rejected_before_the_model() {
    let (ai, hits) = upstream(StatusCode::OK, model_reply(json!({}))).await;
    let (status, _) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/translate/text",
        Some(json!({ "text": "  ", "to": "th" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

const OCR_SECRET: &str = "00112233445566778899aabbccddeeff";

/// A fake Document Intelligence: walks one upload and one job through their lifecycle,
/// rejecting any request whose workload signature does not verify.
async fn ocr_service(upload_status: &'static str, observations: Value) -> String {
    use axum::http::{HeaderMap, Method, Uri};
    use axum::routing::{get, post, put};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let put_url = format!("{base}/storage");
    let signed = |h: &HeaderMap, m: &Method, u: &Uri| {
        let v = |k: &str| {
            h.get(k)
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string()
        };
        let want = crate::ocr::sign(
            &hex::decode(OCR_SECRET).expect("hex"),
            &v("x-ocr-key-id"),
            &v("x-ocr-tenant-id"),
            v("x-ocr-timestamp").parse().unwrap_or(0),
            m.as_str(),
            u.path(),
        );
        v("x-ocr-signature") == want && v("x-ocr-tenant-id") == "ten_roamie_public"
    };
    let guard = move |h: HeaderMap, m: Method, u: Uri, reply: Value| async move {
        if signed(&h, &m, &u) {
            (StatusCode::OK, axum::Json(reply))
        } else {
            (
                StatusCode::UNAUTHORIZED,
                axum::Json(json!({ "code": "authentication_required" })),
            )
        }
    };
    let stored = Arc::new(AtomicBool::new(false));
    let completed = Arc::new(AtomicBool::new(false));
    let seen = completed.clone();
    let app = axum::Router::new()
        .route(
            "/v1/ocr/uploads",
            post(move |h, m, u| guard(h, m, u, json!({
                "upload_id": "upl_1", "method": "PUT", "upload_url": put_url,
                "required_headers": { "content-type": "image/jpeg" }, "expires_at": "2026-09-25T00:00:00Z"
            }))),
        )
        .route(
            "/storage",
            put(move || async move {
                // The signer is create-only, so storage refuses a second write to the same object.
                if stored.swap(true, Ordering::SeqCst) {
                    StatusCode::FORBIDDEN
                } else {
                    StatusCode::OK
                }
            }),
        )
        .route(
            "/v1/ocr/uploads/{id}/complete",
            post(move |h, m, u| {
                completed.store(true, Ordering::SeqCst);
                guard(h, m, u, json!({ "upload_id": "upl_1", "status": "uploaded" }))
            }),
        )
        .route(
            "/v1/ocr/uploads/{id}",
            get(move |h, m, u| {
                let status = if seen.load(Ordering::SeqCst) { upload_status } else { "reserved" };
                guard(h, m, u, json!({ "upload_id": "upl_1", "status": status }))
            }),
        )
        .route(
            "/v1/ocr/jobs",
            post(move |h, m, u| guard(h, m, u, json!({ "job_id": "job_1", "status": "processing", "created_at": "x" }))),
        )
        .route(
            "/v1/ocr/jobs/{id}",
            get(move |h, m, u| guard(h, m, u, json!({ "job_id": "job_1", "status": "completed", "created_at": "x" }))),
        )
        .route(
            "/v1/ocr/jobs/{id}/result",
            get(move |h, m, u| {
                let pages = json!([{ "page": 1, "width": 100, "height": 100, "observations": observations.clone() }]);
                guard(h, m, u, json!({ "pages": pages }))
            }),
        );
    tokio::spawn(async move { axum::serve(listener, app).await });
    base
}

fn with_ocr(state: Arc<AppState>, base: &str) -> Arc<AppState> {
    let mut s = Arc::into_inner(state).expect("sole owner");
    s.ocr = Some(crate::ocr::Ocr {
        http: s.http.clone(),
        upload_base: base.into(),
        job_base: base.into(),
        key_id: "roamie-v1".into(),
        secret: hex::decode(OCR_SECRET).expect("hex"),
        tenant: "ten_roamie_public".into(),
        deadline: std::time::Duration::from_secs(5),
    });
    Arc::new(s)
}

fn sign_photo() -> Value {
    json!({ "data": "/9j/AAAA", "mimeType": "image/jpeg", "to": "en" })
}

fn observation(text: &str, order: u32) -> Value {
    json!({
        "observation_id": format!("o{order}"), "level": "line", "text": text, "confidence": 0.9,
        "reading_order": order, "parent_observation_id": null,
        "polygon": { "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.5, "y": 0.2 }, { "x": 0.5, "y": 0.3 }] }
    })
}

#[tokio::test]
async fn sign_photo_is_read_and_translated_line_by_line() {
    let ocr = ocr_service(
        "accepted",
        json!([observation("出口", 0), observation("禁煙", 1)]),
    )
    .await;
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "language": "ja", "gist": "Exit this way; no smoking.",
            "lines": [
                { "index": 1, "translation": "No smoking", "romanized": "kin'en" },
                { "index": 0, "translation": "Exit", "romanized": "deguchi" }
            ]
        })),
    )
    .await;
    let (status, body) = call(
        with_ocr(state(&ai, "http://unused", None), &ocr),
        "POST",
        "/v1/signs/translate",
        Some(sign_photo()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["detected"], "ja");
    assert_eq!(body["gist"], "Exit this way; no smoking.");
    assert_eq!(body["lines"][0]["original"], "出口");
    assert_eq!(body["lines"][0]["translation"], "Exit");
    assert_eq!(body["lines"][1]["romanized"], "kin'en");
    let b = &body["lines"][0]["box"];
    assert!((b["x"].as_f64().unwrap() - 0.1).abs() < 1e-6, "{b}");
    assert!((b["w"].as_f64().unwrap() - 0.4).abs() < 1e-6, "{b}");
}

#[tokio::test]
async fn sign_photo_without_text_is_unprocessable() {
    let cases = [
        ("no text found", ocr_service("accepted", json!([])).await),
        ("upload rejected", ocr_service("rejected", json!([])).await),
    ];
    for (name, ocr) in cases {
        let (ai, hits) = upstream(StatusCode::OK, model_reply(json!({}))).await;
        let (status, body) = call(
            with_ocr(state(&ai, "http://unused", None), &ocr),
            "POST",
            "/v1/signs/translate",
            Some(sign_photo()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "case {name}: {body}"
        );
        assert_eq!(body["error"], "no_text", "case {name}");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            0,
            "case {name}: model not called"
        );
    }
}

#[tokio::test]
async fn sign_photo_is_unavailable_without_ocr() {
    let (status, _) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/signs/translate",
        Some(sign_photo()),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn same_sign_photo_twice_reuses_the_stored_upload() {
    let ocr = ocr_service("accepted", json!([observation("出口", 0)])).await;
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "language": "ja", "gist": "Exit.",
            "lines": [{ "index": 0, "translation": "Exit", "romanized": "deguchi" }]
        })),
    )
    .await;
    let s = with_ocr(state(&ai, "http://unused", None), &ocr);
    for attempt in ["first", "retry"] {
        let (status, body) =
            call(s.clone(), "POST", "/v1/signs/translate", Some(sign_photo())).await;
        assert_eq!(status, StatusCode::OK, "{attempt}: {body}");
    }
}

#[tokio::test]
async fn readiness_is_available_without_database_configuration() {
    let (status, _) = call(
        state("http://unused", "http://unused", None),
        "GET",
        "/readyz",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn database_outage_changes_readiness_but_not_liveness() {
    use std::str::FromStr;
    let database = crate::database::Database::connect(
        sqlx::postgres::PgConnectOptions::from_str(
            &std::env::var("ROAMIE_TEST_DATABASE_URL").expect("isolated database"),
        )
        .expect("options"),
    )
    .await
    .expect("connect");
    let mut app = state("http://unused", "http://unused", None);
    Arc::get_mut(&mut app).expect("unique state").database = Some(database.clone());
    assert_eq!(
        call(app.clone(), "GET", "/readyz", None).await.0,
        StatusCode::OK
    );
    database.pool.close().await;
    assert_eq!(
        call(app.clone(), "GET", "/readyz", None).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(call(app, "GET", "/healthz", None).await.0, StatusCode::OK);
}

#[tokio::test]
async fn production_api_requires_identity_before_parsing_input() {
    let mut app = state("http://unused", "http://unused", None);
    Arc::get_mut(&mut app)
        .expect("unique state")
        .development_auth_disabled = false;
    let (status, _) = call(app, "POST", "/v1/translate/text", Some(json!({}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn trip_manager_requires_authentication_and_fails_closed_when_unconfigured() {
    let mut s = state("http://unused", "http://unused", None);
    let owner = Arc::get_mut(&mut s).expect("owner");
    owner.development_auth_disabled = false;
    owner.auth = Some(crate::auth_tests::verifier(crate::auth_tests::profile()).0);
    for (token, expected) in [
        (None, StatusCode::UNAUTHORIZED),
        (
            Some(crate::auth_tests::token(json!({}))),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/v1/trip-manager")
            .header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let response = router(s.clone()).oneshot(request.body(Body::from(
            json!({"profile":{"trip_id":"trip","revision":"1"},"specialist":"food","request":{"prompt":"dinner"}}).to_string()
        )).expect("request")).await.expect("response");
        assert_eq!(response.status(), expected);
    }
}

#[tokio::test]
async fn travel_mcp_workload_route_rejects_unconfigured_or_missing_identity() {
    let response = router(state("http://unused", "http://unused", None))
        .oneshot(
            Request::builder()
                .uri("/internal/v1/travel/nearby?lat=1&lng=2&kind=food&diet=none")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn travel_mcp_workload_key_allows_only_its_nearby_route() {
    let (base, hits) = upstream(StatusCode::OK, json!({"places":[]})).await;
    let mut s = state("http://unused", "http://unused", Some(&base));
    Arc::get_mut(&mut s).expect("owner").travel_mcp_key = Some("k".repeat(32));
    for (token, status) in [
        ("wrong".to_owned(), StatusCode::UNAUTHORIZED),
        ("k".repeat(32), StatusCode::OK),
    ] {
        let response = router(s.clone())
            .oneshot(
                Request::builder()
                    .uri("/internal/v1/travel/nearby?lat=1&lng=2&kind=food&diet=none")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), status);
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn model_calls_outlast_the_shared_client_timeout() {
    let app = axum::Router::new().fallback(|| async {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        axum::Json(model_reply(json!({ "ok": true })))
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let url = format!("http://{}", listener.local_addr().expect("addr"));
    tokio::spawn(async move { axum::serve(listener, app).await });
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .expect("client");
    let ai = gemini::Gemini::with_auth(http, url, Arc::new(FakeToken));
    let reply: Value = ai
        .json("system", vec![], json!({}))
        .await
        .expect("a slow itinerary draft still arrives");
    assert_eq!(reply, json!({ "ok": true }));
}
