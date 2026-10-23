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
    let targets = Arc::new(std::sync::Mutex::new(Value::Null));
    let app = axum::Router::new().fallback(
        move |uri: axum::http::Uri, request: Option<axum::Json<Value>>| {
            let targets = targets.clone();
            let counter = counter.clone();
            let body = body.clone();
            async move {
                let request = request.map(|v| v.0).unwrap_or(Value::Null);
                if uri.path().starts_with("/nmt:") {
                    let answer: Value = serde_json::from_str(
                        body["candidates"][0]["content"]["parts"][0]["text"]
                            .as_str()
                            .unwrap_or("{}"),
                    )
                    .unwrap();
                    let response = if uri.path().ends_with(":detectLanguage") {
                        json!({"languages":[{"languageCode":answer["language"],"confidence":1.0}]})
                    } else {
                        let targets = targets.lock().unwrap();
                        let field = if request["targetLanguageCode"] == targets["to_mine"] {
                            "to_mine"
                        } else {
                            "to_partner"
                        };
                        json!({"translations":[{"translatedText":answer[field]}]})
                    };
                    return (status, axum::Json(response));
                }
                if let Some(parts) = request["contents"][0]["parts"].as_array() {
                    for part in parts {
                        if let Some(text) = part["text"].as_str() {
                            if let Ok(context) = serde_json::from_str::<Value>(text) {
                                if context.get("requestedTranslations").is_some() {
                                    *targets.lock().unwrap() =
                                        context["requestedTranslations"].clone();
                                }
                                if let Some(languages) = context["selectedLanguages"].as_array() {
                                    *targets.lock().unwrap() =
                                        json!({"to_mine":languages[0],"to_partner":languages[1]});
                                }
                            }
                        }
                    }
                }
                counter.fetch_add(1, Ordering::SeqCst);
                (status, axum::Json(body))
            }
        },
    );
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

#[tokio::test]
async fn acoustic_speaker_matches_override_language_and_expected_turn_order() {
    let mut mine = vec![0.0; 256];
    mine[0] = 1.0;
    let mut partner = vec![0.0; 256];
    partner[1] = 1.0;
    for (detected, transcript, expected, voice, from_me, target, next_mine, next_partner) in [
        (
            "or",
            "ଷ୍ଟେସନ ଏଠାରେ ଅଛି।",
            "mine",
            &partner,
            false,
            "en",
            "en",
            "or",
        ),
        (
            "mr",
            "स्टेशन येथे आहे.",
            "partner",
            &mine,
            true,
            "hi",
            "mr",
            "hi",
        ),
        (
            "hi",
            "स्टेशन यहाँ है।",
            "partner",
            &mine,
            true,
            "hi",
            "hi",
            "hi",
        ),
    ] {
        let (ai, hits) = upstream(
            StatusCode::OK,
            model_reply(
                json!({"confidence":0.99,"transcript":transcript,"speaker_voice":"unknown"}),
            ),
        )
        .await;
        let (nmt, _) = upstream(StatusCode::OK, json!({"languages":[{"languageCode":detected,"confidence":1.0}],"translations":[{"translatedText":"Station here"}]})).await;
        let mut app = state(&ai, "http://unused", None);
        Arc::get_mut(&mut app).unwrap().translation = crate::translation::Translation::with_auth(
            reqwest::Client::new(),
            format!("{nmt}/translation"),
            Arc::new(FakeToken),
        );
        let mut request: crate::talk::TurnRequest = serde_json::from_value(json!({
            "mine":"en","partner":"hi","autoMine":true,"partnerLocked":false,"expectedSpeaker":expected,
            "trackSpeakers":true,"speakerContext":{"model":crate::speaker::MODEL,"mine":[mine],"partner":[partner]},
            "audio":{"data":"AAAA","mimeType":"audio/mp4"}
        })).unwrap();
        request.speaker_embedding = Some(serde_json::from_value(json!(voice)).unwrap());
        let turn =
            crate::talk::interpret(app.ai.as_ref().unwrap(), &app.translation, None, &request)
                .await
                .unwrap();
        let turn = serde_json::to_value(turn).unwrap();
        assert_eq!(turn["fromMe"], from_me, "{turn}");
        assert_eq!(turn["target"], target, "{turn}");
        assert_eq!(turn["mine"], next_mine, "{turn}");
        assert_eq!(turn["partner"], next_partner, "{turn}");
        assert_eq!(turn["speakerTracking"]["basis"], "voice", "{turn}");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn uncertain_new_language_cannot_fall_back_to_expected_speaker() {
    let mut mine = vec![0.0; 256];
    mine[0] = 1.0;
    let mut partner = vec![0.0; 256];
    partner[1] = 1.0;
    let mut unclear = vec![0.0; 256];
    unclear[0] = std::f32::consts::FRAC_1_SQRT_2;
    unclear[1] = std::f32::consts::FRAC_1_SQRT_2;
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({"confidence":0.99,"transcript":"ଷ୍ଟେସନ ଏଠାରେ ଅଛି।"})),
    )
    .await;
    let (nmt, _) = upstream(
        StatusCode::OK,
        json!({"languages":[{"languageCode":"or","confidence":1.0}]}),
    )
    .await;
    let mut app = state(&ai, "http://unused", None);
    Arc::get_mut(&mut app).unwrap().translation = crate::translation::Translation::with_auth(
        reqwest::Client::new(),
        format!("{nmt}/translation"),
        Arc::new(FakeToken),
    );
    let mut request: crate::talk::TurnRequest = serde_json::from_value(json!({
        "mine":"en","partner":"hi","autoMine":true,"expectedSpeaker":"mine","trackSpeakers":true,
        "speakerContext":{"model":crate::speaker::MODEL,"mine":[mine],"partner":[partner]},
        "audio":{"data":"AAAA","mimeType":"audio/mp4"},"speakerEmbedding":mine
    }))
    .unwrap();
    assert!(
        request.speaker_embedding.is_none(),
        "the client cannot supply current acoustic evidence"
    );
    request.speaker_embedding = Some(serde_json::from_value(json!(unclear)).unwrap());
    let error = crate::talk::interpret(app.ai.as_ref().unwrap(), &app.translation, None, &request)
        .await
        .unwrap_err();
    assert!(matches!(error, crate::error::Error::Invalid(_)));
}

#[tokio::test]
async fn speaker_tracking_keeps_initial_source_and_partner_discovery() {
    for (known, detected, transcript, expected, from_me, target, mine, partner) in [
        (
            "hi",
            "en",
            "Where is the station?",
            Some("mine"),
            true,
            "hi",
            "en",
            "hi",
        ),
        ("en", "hi", "स्टेशन कहाँ है?", None, false, "en", "en", "hi"),
    ] {
        let (ai, _) = upstream(
            StatusCode::OK,
            model_reply(json!({"confidence":0.99,"transcript":transcript})),
        )
        .await;
        let (nmt, _) = upstream(StatusCode::OK, json!({"languages":[{"languageCode":detected,"confidence":1.0}],"translations":[{"translatedText":"Translation"}]})).await;
        let mut app = state(&ai, "http://unused", None);
        Arc::get_mut(&mut app).unwrap().translation = crate::translation::Translation::with_auth(
            reqwest::Client::new(),
            format!("{nmt}/translation"),
            Arc::new(FakeToken),
        );
        let request = serde_json::from_value(json!({"mine":known,"partner":known,"autoMine":true,"trackSpeakers":true,"expectedSpeaker":expected,"audio":{"data":"AAAA","mimeType":"audio/mp4"}})).unwrap();
        let turn =
            crate::talk::interpret(app.ai.as_ref().unwrap(), &app.translation, None, &request)
                .await
                .unwrap();
        let turn = serde_json::to_value(turn).unwrap();
        assert_eq!(turn["fromMe"], from_me, "{turn}");
        assert_eq!(turn["target"], target, "{turn}");
        assert_eq!(turn["mine"], mine, "{turn}");
        assert_eq!(turn["partner"], partner, "{turn}");
    }
}

#[tokio::test]
async fn speaker_context_is_rejected_before_audio_or_provider_work_when_invalid() {
    let mut vector = vec![0.0; 256];
    vector[0] = 1.0;
    for extra in [
        json!({"trackSpeakers":true,"autoMine":false}),
        json!({"trackSpeakers":true,"autoMine":true,"partnerLocked":true}),
        json!({"trackSpeakers":true,"autoMine":true,"speakerContext":{"model":"old-version","mine":[],"partner":[]}}),
        json!({"trackSpeakers":true,"autoMine":true,"speakerContext":{"model":crate::speaker::MODEL,"mine":[vector,vector,vector],"partner":[]}}),
    ] {
        let (ai, hits) = upstream(
            StatusCode::OK,
            model_reply(json!({"confidence":0.99,"transcript":"Hello"})),
        )
        .await;
        let mut payload =
            json!({"mine":"en","partner":"hi","audio":{"data":"AAAA","mimeType":"audio/mp4"}});
        payload
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (status, _) = call(
            state(&ai, "http://unused", None),
            "POST",
            "/v1/talk/turn",
            Some(payload),
        )
        .await;
        assert!(status.is_client_error());
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }
}

/// Manual harness: loopback only, no database, no stored customer sessions.
#[cfg(manual_qa)]
#[tokio::test]
#[ignore = "manual live benchmark server; uses the active gcloud account"]
async fn local_translation_benchmark_server() {
    let auth = Arc::new(gcp_auth::GCloudAuthorizedUser::new().await.unwrap());
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "x-goog-user-project",
        "tesseracthub-480811".parse().unwrap(),
    );
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap();
    let mut state = state("http://unused", "http://unused", None);
    let s = Arc::get_mut(&mut state).unwrap();
    s.ai = Some(gemini::Gemini::with_auth(http.clone(), "https://aiplatform.googleapis.com/v1/projects/tesseracthub-480811/locations/global/publishers/google/models/gemini-2.5-flash:generateContent".into(), auth.clone()));
    s.translation = crate::translation::Translation::with_auth(
        http,
        "https://translation.googleapis.com/v3/projects/tesseracthub-480811/locations/global"
            .into(),
        auth,
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:18080")
        .await
        .unwrap();
    eprintln!("local benchmark server ready at 127.0.0.1:18080; no database configured");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.unwrap();
        })
        .await
        .unwrap();
}

pub(crate) fn state(gemini_url: &str, fx_url: &str, places: Option<&str>) -> Arc<AppState> {
    let http = reqwest::Client::new();
    Arc::new(AppState {
        translation: crate::translation::Translation::with_auth(
            http.clone(),
            format!("{gemini_url}/nmt"),
            Arc::new(FakeToken),
        ),
        mail: None,
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
        jev: None,
        memories: crate::memories::Renderer::new(),
        audio: crate::audio::Gate::new(),
        talk_turns: crate::cache::Recent::default(),
        text_translations: crate::cache::Recent::default(),
        phrasebook: None,
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
async fn authenticated_responses_cannot_be_reused_from_http_caches() {
    let request = Request::builder()
        .method("POST")
        .uri("/v1/memories/capabilities")
        .body(Body::empty())
        .expect("request");
    let response = router(state("http://unused", "http://unused", None))
        .oneshot(request)
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("no-store")
    );
}

#[tokio::test]
async fn dedicated_detection_corrects_shared_script_model_echoes() {
    let transcript = "रेल चार बजे छुट्छ, पाँच बजे होइन।";
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({
            "language":"hi","confidence":0.99,"transcript":transcript,
            "to_mine":transcript,"to_partner":transcript
        })),
    )
    .await;
    let (nmt, _) = upstream(StatusCode::OK, json!({"languages":[{"languageCode":"ne","confidence":1.0}],"translations":[{"translatedText":"ट्रेन चार बजे निकलती है, पांच बजे नहीं।"}]})).await;
    let mut app = state(&ai, "http://unused", None);
    Arc::get_mut(&mut app).unwrap().translation = crate::translation::Translation::with_auth(
        reqwest::Client::new(),
        format!("{nmt}/translation"),
        Arc::new(FakeToken),
    );
    let (status, body) = call(
        app,
        "POST",
        "/v1/talk/turn",
        Some(json!({
            "mine":"hi","partner":"ne","partnerLocked":true,"text":transcript
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["detected"], "ne", "{body}");
    assert_eq!(body["target"], "hi", "{body}");
    assert_eq!(
        body["translation"], "ट्रेन चार बजे निकलती है, पांच बजे नहीं।",
        "{body}"
    );
}

#[tokio::test]
async fn current_utterance_detection_controls_both_speaker_sides_for_unrelated_languages() {
    for (language, reported, transcript) in [
        ("ne", "hi", "रेल चार बजे छुट्छ, पाँच बजे होइन।"),
        ("fr", "es", "La gare est à gauche."),
        ("ms", "id", "Stesen itu di sebelah kiri."),
        ("uk", "ru", "Станція ліворуч."),
        ("ar", "ur", "المحطة على اليسار."),
        ("bn", "en", "স্টেশন বাঁদিকে।"),
    ] {
        for automatic in [false, true] {
            for from_me in [false, true] {
                let (mine, partner) = if from_me {
                    (language, "en")
                } else {
                    ("en", language)
                };
                let (ai, _) = upstream(
                    StatusCode::OK,
                    model_reply(json!({
                        "language":reported,"confidence":0.99,"transcript":transcript,
                        "to_mine":transcript,"to_partner":transcript,
                        "to_mine_romanized":"wrong guide","to_partner_romanized":"wrong guide"
                    })),
                )
                .await;
                let (nmt, _) = upstream(StatusCode::OK,json!({"languages":[{"languageCode":language,"confidence":1.0}],"translations":[{"translatedText":"The station is on the left."}]})).await;
                let mut app = state(&ai, "http://unused", None);
                Arc::get_mut(&mut app).unwrap().translation =
                    crate::translation::Translation::with_auth(
                        reqwest::Client::new(),
                        format!("{nmt}/translation"),
                        Arc::new(FakeToken),
                    );
                let (status, body) = call(app,"POST","/v1/talk/turn",Some(json!({
                    "mine":mine,"partner":partner,"partnerLocked":true,"autoMine":automatic,
                    "expectedSpeaker":if from_me { "partner" } else { "mine" },"text":transcript,
                    "history":[{"original":"An unrelated earlier turn","translation":"A previous translation"}]
                }))).await;
                assert_eq!(status, StatusCode::OK, "{body}");
                assert_eq!(body["detected"], language, "{body}");
                assert_eq!(body["target"], "en", "{body}");
                assert_eq!(body["mine"], mine, "{body}");
                assert_eq!(body["partner"], partner, "{body}");
                assert_eq!(body["fromMe"], from_me, "{body}");
                assert_eq!(
                    body["romanized"], "",
                    "a guide for a different translation must not be spoken"
                );
                assert_eq!(body["reviewRequired"], false, "{body}");
            }
        }
    }
}

#[tokio::test]
async fn a_provider_echo_or_uncertain_third_language_cannot_be_silently_accepted() {
    for (detected, confidence, translation) in [
        ("en", 1.0, "The station is on the left."),
        ("ms", 0.7, "Stesen itu di sebelah kiri."),
    ] {
        let (ai,_) = upstream(StatusCode::OK,model_reply(json!({"language":"en","confidence":0.99,"transcript":"The station is on the left.","to_mine":"The station is on the left.","to_partner":translation}))).await;
        let (nmt,_) = upstream(StatusCode::OK,json!({"languages":[{"languageCode":detected,"confidence":confidence}],"translations":[{"translatedText":translation}]})).await;
        let mut app = state(&ai, "http://unused", None);
        Arc::get_mut(&mut app).unwrap().translation = crate::translation::Translation::with_auth(
            reqwest::Client::new(),
            format!("{nmt}/translation"),
            Arc::new(FakeToken),
        );
        let (status,body)=call(app,"POST","/v1/talk/turn",Some(json!({"mine":"en","partner":"id","autoMine":true,"partnerLocked":true,"text":"The station is on the left."}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["reviewRequired"], true, "{body}");
        assert_eq!(body["partner"], "id", "{body}");
    }
}

#[tokio::test]
async fn dedicated_detection_keeps_english_target_when_model_reports_another_script() {
    use base64::Engine;
    for language in ["hi", "or", "en"] {
        for automatic in [false, true] {
            for audio in [false, true] {
                let (ai, _) = upstream(
                    StatusCode::OK,
                    model_reply(json!({
                        "language":language, "confidence":0.9, "candidates":["bn","or"],
                        "transcript":"স্টেশন বাঁদিকে।", "to_mine":"The station is on the left.",
                        "to_partner":"স্টেশন বাঁদিকে।"
                    })),
                )
                .await;
                let mut payload = json!({"mine":"en","partner":"bn","autoMine":automatic,"partnerLocked":true,"expectedSpeaker":"mine","history":[]});
                if audio {
                    payload["audio"] = json!({"mimeType":"audio/mp4","data":base64::engine::general_purpose::STANDARD.encode(include_bytes!("../testdata/speech-hi.m4a"))});
                } else {
                    payload["text"] = json!("স্টেশন বাঁদিকে।");
                }
                let (nmt, _) = upstream(StatusCode::OK, json!({"languages":[{"languageCode":"bn","confidence":1.0}],"translations":[{"translatedText":"The station is on the left."}]})).await;
                let mut configured = state(&ai, "http://unused", None);
                Arc::get_mut(&mut configured).unwrap().translation =
                    crate::translation::Translation::with_auth(
                        reqwest::Client::new(),
                        format!("{nmt}/translation"),
                        Arc::new(FakeToken),
                    );
                let body = if audio {
                    let request = serde_json::from_value(payload).unwrap();
                    let turn = crate::talk::interpret(
                        configured.ai.as_ref().unwrap(),
                        &configured.translation,
                        None,
                        &request,
                    )
                    .await
                    .unwrap();
                    serde_json::to_value(turn).unwrap()
                } else {
                    let (status, body) =
                        call(configured, "POST", "/v1/talk/turn", Some(payload)).await;
                    assert_eq!(status, StatusCode::OK, "auto={automatic}: {body}");
                    body
                };
                assert_eq!(body["detected"], "bn", "{body}");
                assert_eq!(body["mine"], "en", "{body}");
                assert_eq!(body["partner"], "bn", "{body}");
                assert_eq!(body["fromMe"], false, "{body}");
                assert_eq!(body["target"], "en", "{body}");
                assert_eq!(body["translation"], "The station is on the left.", "{body}");
            }
        }
    }
}

#[tokio::test]
async fn bengali_pair_does_not_relabel_hindi_or_assamese_as_bengali() {
    for (language, transcript) in [
        ("hi", "स्टेशन बाईं ओर है।"),
        ("hi", "स्टेशन কলকাতা के पास है।"),
        ("hi", "Station baayin taraf hai"),
        ("as", "ষ্টেচনটো বাওঁফালে আছে।"),
    ] {
        let (ai, _) = upstream(
            StatusCode::OK,
            model_reply(json!({
                "language":language,"confidence":0.95,"transcript":transcript,
                "to_mine":"The station is on the left.","to_partner":"স্টেশন বাঁদিকে।"
            })),
        )
        .await;
        let (status, body) = call(
            state(&ai, "http://unused", None),
            "POST",
            "/v1/talk/turn",
            Some(json!({
                "mine":"en","partner":"bn","autoMine":true,"partnerLocked":true,"text":transcript
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["detected"], language, "{body}");
        assert_eq!(body["mine"], language, "{body}");
        assert_eq!(body["target"], "bn", "{body}");
    }
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
#[cfg(media_tests)]
async fn translation_voice_follows_the_speakers_voice_register() {
    let spoken = json!({ "mine": "en", "partner": "th", "audio": {"mimeType":"audio/mp4","data":base64::Engine::encode(&base64::engine::general_purpose::STANDARD, include_bytes!("../testdata/speech-th.m4a"))} });
    let typed = json!({ "mine": "en", "partner": "th", "text": "สวัสดี" });
    for (register, request, want) in [
        (json!("lower"), &spoken, json!("male")),
        (json!("higher"), &spoken, json!("female")),
        (json!("unknown"), &spoken, Value::Null),
        (Value::Null, &spoken, Value::Null),
        (json!("lower"), &typed, Value::Null),
    ] {
        let (ai, _) = upstream(
            StatusCode::OK,
            model_reply(json!({
                "language": "th", "confidence": 0.97, "transcript": "สวัสดี",
                "to_mine": "Hello", "to_partner": "สวัสดี", "speaker_voice": register
            })),
        )
        .await;
        let (status, body) = call(
            state(&ai, "http://unused", None),
            "POST",
            "/v1/talk/turn",
            Some(request.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["voice"], want, "register {register} for {request}");
    }
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
async fn statement_keeps_only_trip_spending() {
    let line = |date: &str, merchant: &str, amount: &str, currency: &str, kind: &str| json!({ "date": date, "merchant": merchant, "amount": amount, "currency": currency, "kind": kind, "category": "food" });
    let (ai, _) = upstream(
        StatusCode::OK,
        model_reply(json!({ "transactions": [
            line("2026-10-01", "Airport lounge", "40.00", "AUD", "purchase"),
            line("2026-10-02", "PHO 24 HANOI card 4111111111111111", "185,000", "VND", "purchase"),
            line("2026-10-03", "Foreign transaction fee", "3.20", "AUD", "fee"),
            line("2026-10-04", "Hotel refund", "25.00", "AUD", "refund"),
            line("2026-10-05", "Payment received, thank you", "900.00", "AUD", "payment"),
            line("2026-10-08", "Sapa Express", "not printed", "AUD", "purchase"),
            line("2026-10-09", "Home groceries", "80.00", "AUD", "purchase")
        ] })),
    )
    .await;
    let (status, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/statements/extract",
        Some(json!({ "data": "aGk=", "mimeType": "application/pdf", "from": "2026-10-02", "to": "2026-10-08" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let got: Vec<_> = body["transactions"]
        .as_array()
        .expect("transactions")
        .iter()
        .map(|t| {
            (
                t["date"].as_str().unwrap_or_default(),
                t["merchant"].as_str().unwrap_or_default(),
                t["amountMinor"].as_i64().unwrap_or_default(),
                t["currency"].as_str().unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(
        got,
        [
            ("2026-10-02", "PHO 24 HANOI card ••••1111", 185000, "VND"),
            ("2026-10-03", "Foreign transaction fee", 320, "AUD"),
            ("2026-10-04", "Hotel refund", -2500, "AUD"),
        ],
        "window, masking, fees and refunds; payments and unreadable totals skipped"
    );
    assert_eq!(body["outsideTrip"], 2);
    assert_eq!(body["unreadable"], 1);
}

#[tokio::test]
async fn statement_request_is_validated() {
    for (case, req) in [
        (
            "word document",
            json!({ "data": "aGk=", "mimeType": "application/msword", "from": "2026-10-02", "to": "2026-10-08" }),
        ),
        (
            "empty file",
            json!({ "data": "", "mimeType": "application/pdf", "from": "2026-10-02", "to": "2026-10-08" }),
        ),
        (
            "reversed dates",
            json!({ "data": "aGk=", "mimeType": "image/jpeg", "from": "2026-10-08", "to": "2026-10-02" }),
        ),
        (
            "bad date",
            json!({ "data": "aGk=", "mimeType": "image/jpeg", "from": "2026-02-30", "to": "2026-03-02" }),
        ),
        (
            "over 90 days",
            json!({ "data": "aGk=", "mimeType": "image/jpeg", "from": "2026-01-01", "to": "2026-06-01" }),
        ),
    ] {
        let (status, _) = call(
            state("http://unused", "http://unused", None),
            "POST",
            "/v1/statements/extract",
            Some(req),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{case}");
    }
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
        (
            "/v1/statements/extract",
            json!({ "data": "aGk=", "mimeType": "application/pdf", "from": "2026-10-02", "to": "2026-10-08" }),
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

#[tokio::test]
async fn text_falls_back_to_nmt_and_can_route_the_next_phrase_directly() {
    let model_hits = Arc::new(AtomicUsize::new(0));
    let hits = model_hits.clone();
    let app = axum::Router::new().fallback(move |uri: axum::http::Uri| {
        let hits = hits.clone();
        async move {
            if uri.path().starts_with("/nmt:") {
                (
                    StatusCode::OK,
                    axum::Json(json!({"translations":[{"translatedText":"ଷ୍ଟେସନ୍ କେଉଁଠି?"}]})),
                )
            } else {
                hits.fetch_add(1, Ordering::SeqCst);
                (StatusCode::BAD_GATEWAY, axum::Json(json!({})))
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let state = state(&url, "http://unused", None);
    let (status, body) = call(
        state.clone(),
        "POST",
        "/v1/translate/text",
        Some(json!({"text":"Where is the station?","from":"en","to":"or"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["translation"], "ଷ୍ଟେସନ୍ କେଉଁଠି?");
    assert_eq!(body["provider"], "google-nmt");
    assert_eq!(body["romanized"], "");
    let before = model_hits.load(Ordering::SeqCst);
    let (status, body) = call(
        state,
        "POST",
        "/v1/translate/text",
        Some(json!({"text":"The next station?","from":"en","to":"or","provider":"google-nmt"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["provider"], "google-nmt");
    assert_eq!(model_hits.load(Ordering::SeqCst), before);
}

#[tokio::test]
async fn failed_preferred_nmt_recovers_with_model_pronunciation() {
    let (ai, hits) = upstream(StatusCode::OK, model_reply(json!({"translation":"नमस्ते","romanized":"namaste","source_romanized":"","alternatives":[]}))).await;
    let (status, body) = call(
        state(&ai, "http://unused", None),
        "POST",
        "/v1/translate/text",
        Some(json!({"text":"Hello","from":"en","to":"hi","provider":"google-nmt"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["translation"], "नमस्ते");
    assert_eq!(body["provider"], "model");
    assert_eq!(body["romanized"], "namaste");
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn nmt_auto_detection_and_missing_model_do_not_require_generative_detection() {
    let (ai, hits) = upstream(
        StatusCode::OK,
        model_reply(json!({"language":"en","to_partner":"नमस्ते"})),
    )
    .await;
    let mut s = state(&ai, "http://unused", None);
    Arc::get_mut(&mut s).unwrap().ai = None;
    let (status, body) = call(
        s,
        "POST",
        "/v1/translate/text",
        Some(json!({"text":"Hello","to":"hi"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["detected"], "en");
    assert_eq!(body["provider"], "google-nmt");
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

const OCR_SECRET: &str = "00112233445566778899aabbccddeeff";

/// A fake Document Intelligence: walks one upload and one job through their lifecycle,
/// rejecting any request whose workload signature does not verify.
async fn ocr_service(upload_status: &'static str, observations: Value) -> String {
    ocr_service_with_status(upload_status, "completed", observations).await
}

async fn ocr_service_with_status(
    upload_status: &'static str,
    job_status: &'static str,
    observations: Value,
) -> String {
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
    let declared = Arc::new(std::sync::Mutex::new(String::new()));
    let object = Arc::new(std::sync::Mutex::new(Vec::new()));
    let (declare, write) = (declared.clone(), object.clone());
    let app = axum::Router::new()
        .route("/v1/systemone", post(|| async { axum::Json(json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"accept","confidence":0.9,"probabilities":{"accept":0.9,"review":0.08,"retake":0.02}}},"usage":{"input_tokens":40,"output_tokens":10}})) }))
        .route(
            "/v1/ocr/uploads",
            post(move |h, m, u, axum::Json(body): axum::Json<Value>| {
                *declare.lock().expect("declared") = body["content_type"].as_str().unwrap_or_default().into();
                guard(h, m, u, json!({
                    "upload_id": "upl_1", "method": "PUT", "upload_url": put_url,
                    "required_headers": { "content-type": "image/jpeg" }, "expires_at": "2026-09-25T00:00:00Z"
                }))
            }),
        )
        .route(
            "/storage",
            put(move |bytes: axum::body::Bytes| async move {
                assert!(!bytes.is_empty(), "storage must receive the upload before acknowledging it");
                // The signer is create-only, so storage refuses a second write to the same object.
                if stored.swap(true, Ordering::SeqCst) {
                    StatusCode::FORBIDDEN
                } else {
                    *write.lock().expect("object") = bytes.to_vec();
                    StatusCode::OK
                }
            }),
        )
        .route(
            "/v1/ocr/uploads/{id}/complete",
            post(move |h, m, u| {
                // Like the real service, completion sniffs the stored bytes against the declared type.
                let bytes = object.lock().expect("object").clone();
                let sniffed = if bytes.starts_with(b"\xff\xd8\xff") {
                    "image/jpeg"
                } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "image/png"
                } else if bytes.starts_with(b"%PDF-") {
                    "application/pdf"
                } else {
                    "unknown"
                };
                let verified = *declared.lock().expect("declared") == sniffed;
                if verified {
                    completed.store(true, Ordering::SeqCst);
                }
                async move {
                    if verified {
                        guard(h, m, u, json!({ "upload_id": "upl_1", "status": "uploaded" })).await
                    } else {
                        (
                            StatusCode::UNPROCESSABLE_ENTITY,
                            axum::Json(json!({ "code": "upload_verification_failed" })),
                        )
                    }
                }
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
            get(move |h, m, u| guard(h, m, u, json!({ "job_id": "job_1", "status": job_status, "created_at": "x" }))),
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

#[tokio::test]
async fn photo_translation_preserves_ocr_review_status() {
    let ocr = ocr_service_with_status(
        "accepted",
        "review_required",
        json!([observation("出口", 0)]),
    )
    .await;
    let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"language":"ja", "gist":"Exit", "lines":[{"index":0,"translation":"Exit","romanized":"deguchi"}]}))).await;
    let (status, body) = call(
        with_ocr(state(&ai, "http://unused", None), &ocr),
        "POST",
        "/v1/signs/translate",
        Some(sign_photo()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reviewRequired"], true, "{body}");
    assert_eq!(body["ocrJobId"], "job_1");
}

#[tokio::test]
async fn photo_translation_accepts_a_photo_above_two_megabytes() {
    let ocr = ocr_service("accepted", json!([observation("出口", 0)])).await;
    let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"language":"ja", "gist":"Exit", "lines":[{"index":0,"translation":"Exit","romanized":"deguchi"}]}))).await;
    let mut photo = sign_photo();
    photo["data"] = Value::String(format!("/9j/{}", "AAAA".repeat(550_000)));
    let (status, body) = call(
        with_ocr(state(&ai, "http://unused", None), &ocr),
        "POST",
        "/v1/signs/translate",
        Some(photo),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn receipt_extraction_reads_ocr_evidence_before_the_model() {
    let ocr = ocr_service("accepted", json!([observation("CAFE TOTAL 12.50 AUD", 0)])).await;
    let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"merchant":"Cafe", "total":"99.00", "currency":"AUD", "date":"2026-10-12", "category":"food", "confidence":0.99}))).await;
    let (status, body) = call(
        with_ocr(state(&ai, "http://unused", None), &ocr),
        "POST",
        "/v1/receipts/extract",
        Some(json!({"data":"/9j/AAAA", "mimeType":"image/jpeg", "localCurrency":"AUD"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["amountMinor"],
        Value::Null,
        "an invented total cannot become money"
    );
    assert_eq!(body["source"]["ocrJobId"], "job_1");
    assert_eq!(body["source"]["reviewRequired"], true);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn ocr_documents_keep_account_ownership_and_provider_identifiers_for_deletion() {
    let db = crate::database::Database::connect(
        std::env::var("ROAMIE_TEST_DATABASE_URL")
            .unwrap()
            .parse()
            .unwrap(),
    )
    .await
    .unwrap();
    db.migrate().await.unwrap();
    let ocr = ocr_service("accepted", json!([observation("CAFE TOTAL 12.50 AUD", 0)])).await;
    let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"merchant":"Cafe", "total":"12.50", "currency":"AUD", "date":"2026-10-12", "category":"food", "confidence":0.99}))).await;
    let mut configured = with_ocr(state(&ai, "http://unused", None), &ocr);
    Arc::get_mut(&mut configured).unwrap().database = Some(db.clone());
    let (status, body) = call(
        configured,
        "POST",
        "/v1/receipts/extract",
        Some(json!({"data":"/9j/AAAA", "mimeType":"image/jpeg", "localCurrency":"AUD"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let found: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ocr_resources WHERE subject='local-development' AND upload_id='upl_1' AND job_id='job_1')").fetch_one(&db.pool).await.unwrap();
    assert!(
        found,
        "document deletion must be scoped to its owner and exact provider resources"
    );
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn ocr_ownership_is_durable_before_provider_calls_and_separates_identical_files() {
    use axum::{http::HeaderMap, routing::post, Json, Router};
    let db = crate::database::Database::connect(
        std::env::var("ROAMIE_TEST_DATABASE_URL")
            .unwrap()
            .parse()
            .unwrap(),
    )
    .await
    .unwrap();
    db.migrate().await.unwrap();
    let prefix = uuid::Uuid::now_v7().to_string();
    let alice = format!("{prefix}-alice");
    let bob = format!("{prefix}-bob");
    let pool = db.pool.clone();
    let keys = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let captured = keys.clone();
    let app = Router::new().route(
        "/v1/ocr/uploads",
        post(move |headers: HeaderMap| {
            let pool = pool.clone();
            let captured = captured.clone();
            async move {
                let key = headers["idempotency-key"]
                    .to_str()
                    .unwrap()
                    .strip_suffix("-u")
                    .unwrap()
                    .to_owned();
                let recorded: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM ocr_resources WHERE request_key=$1)",
                )
                .bind(&key)
                .fetch_one(&pool)
                .await
                .unwrap();
                assert!(recorded, "reserve ownership before any provider request");
                captured.lock().unwrap().push(key);
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({"error":"synthetic provider failure"})),
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let state = with_ocr(state("http://unused", "http://unused", None), &address);
    let base = state.ocr.as_ref().unwrap();
    for subject in [&alice, &bob] {
        assert!(base
            .for_customer(db.pool.clone(), subject)
            .read(vec![0xff, 0xd8, 0xff], "image/jpeg")
            .await
            .is_err());
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM ocr_resources WHERE subject=$1 AND upload_id IS NULL",
        )
        .bind(subject)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }
    let seen = keys.lock().unwrap().clone();
    assert_eq!(seen.len(), 2);
    assert_ne!(
        seen[0], seen[1],
        "another customer's photo must not reuse the resource"
    );
    db.pool.close().await;
    assert!(base
        .for_customer(db.pool.clone(), "unrecorded")
        .read(vec![0xff, 0xd8, 0xff], "image/jpeg")
        .await
        .is_err());
    assert_eq!(
        keys.lock().unwrap().len(),
        2,
        "storage failure must stop uploads"
    );
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn statement_extraction_cannot_import_amounts_absent_from_ocr() {
    let ocr = ocr_service(
        "accepted",
        json!([observation("2026-10-12 CAFE 12.50 AUD", 0)]),
    )
    .await;
    let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"transactions":[{"date":"2026-10-12","merchant":"Cafe","amount":"99.00","currency":"AUD","kind":"purchase","category":"food"}]}))).await;
    let (status, body) = call(with_ocr(state(&ai, "http://unused", None), &ocr), "POST", "/v1/statements/extract", Some(json!({"data":"JVBERi0xLjQ=", "mimeType":"application/pdf", "from":"2026-10-01","to":"2026-10-20"}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["transactions"], json!([]));
    assert_eq!(body["unreadable"], 1);
    assert_eq!(body["source"]["reviewRequired"], true);
}

#[tokio::test]
async fn an_unavailable_judge_stops_photo_translation_before_the_model() {
    let ocr = ocr_service("accepted", json!([observation("出口", 0)])).await;
    let (judge, _) = upstream(
        StatusCode::SERVICE_UNAVAILABLE,
        json!({"private":"must not leak"}),
    )
    .await;
    let (ai, hits) = upstream(StatusCode::OK, model_reply(json!({}))).await;
    let mut configured = with_ocr(state(&ai, "http://unused", None), &ocr);
    Arc::get_mut(&mut configured).expect("single owner").jev =
        Some(crate::decisions::Jev::for_test(judge));
    let (status, body) = call(
        configured,
        "POST",
        "/v1/signs/translate",
        Some(sign_photo()),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    assert!(!body.to_string().contains("must not leak"));
}

#[tokio::test]
async fn a_judge_cannot_hide_low_confidence_ocr() {
    let mut line = observation("出口", 0);
    line["confidence"] = json!(0.2);
    let ocr = ocr_service("accepted", json!([line])).await;
    let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"language":"ja","gist":"Exit","lines":[{"index":0,"translation":"Exit","romanized":"deguchi"}]}))).await;
    let (status, body) = call(
        with_ocr(state(&ai, "http://unused", None), &ocr),
        "POST",
        "/v1/signs/translate",
        Some(sign_photo()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reviewRequired"], true);
}

#[tokio::test]
async fn a_retake_decision_never_reaches_the_translation_model() {
    let ocr = ocr_service("accepted", json!([observation("garbled", 0)])).await;
    let (judge, _) = upstream(StatusCode::OK, json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"retake","confidence":0.9,"probabilities":{"accept":0.02,"review":0.08,"retake":0.9}}},"usage":{"input_tokens":40,"output_tokens":10}})).await;
    let (ai, hits) = upstream(StatusCode::OK, model_reply(json!({}))).await;
    let mut configured = with_ocr(state(&ai, "http://unused", None), &ocr);
    Arc::get_mut(&mut configured).expect("single owner").jev =
        Some(crate::decisions::Jev::for_test(judge));
    let (status, _) = call(
        configured,
        "POST",
        "/v1/signs/translate",
        Some(sign_photo()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn receipt_review_redacts_card_numbers_before_any_ai_provider() {
    let ocr = ocr_service(
        "accepted",
        json!([observation("TOTAL 12.50 AUD CARD 4111 1111 1111 1111", 0)]),
    )
    .await;
    let app = axum::Router::new().fallback(|axum::Json(body): axum::Json<Value>| async move {
        assert!(!body.to_string().contains("4111 1111 1111 1111"), "AI must not receive a full card number");
        if body.get("questions").is_some() {
            axum::Json(json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"accept","confidence":0.9,"probabilities":{"accept":0.9,"review":0.08,"retake":0.02}}},"usage":{"input_tokens":40,"output_tokens":10}}))
        } else {
            axum::Json(model_reply(json!({"merchant":"Cafe","total":"12.50","currency":"AUD","date":"2026-10-12","category":"food","confidence":0.9})))
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let address = format!("http://{}", listener.local_addr().expect("address"));
    let task = tokio::spawn(async move { axum::serve(listener, app).await });
    let mut configured = with_ocr(state(&address, "http://unused", None), &ocr);
    Arc::get_mut(&mut configured).expect("single owner").jev =
        Some(crate::decisions::Jev::for_test(address));
    let (status, body) = call(
        configured,
        "POST",
        "/v1/receipts/extract",
        Some(json!({"data":"/9j/AAAA","mimeType":"image/jpeg","localCurrency":"AUD"})),
    )
    .await;
    task.abort();
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["amountMinor"], 1250);
}

fn with_ocr(state: Arc<AppState>, base: &str) -> Arc<AppState> {
    let mut s = Arc::into_inner(state).expect("sole owner");
    s.jev = Some(crate::decisions::Jev::for_test(format!(
        "{base}/v1/systemone"
    )));
    s.ocr = Some(crate::ocr::Ocr {
        http: s.http.clone(),
        upload_base: base.into(),
        job_base: base.into(),
        key_id: "roamie-v1".into(),
        secret: hex::decode(OCR_SECRET).expect("hex"),
        tenant: "ten_roamie_public".into(),
        deadline: std::time::Duration::from_secs(5),
        owner: None,
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
async fn sign_translation_retries_an_untranslated_answer() {
    let ocr = ocr_service("accepted", json!([observation("EXIT", 0)])).await;
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = attempts.clone();
    let app = axum::Router::new().fallback(move || {
        let translation = if counter.fetch_add(1, Ordering::SeqCst) == 0 {
            "EXIT"
        } else {
            "ପ୍ରସ୍ଥାନ"
        };
        async move {
            axum::Json(model_reply(json!({
                "language": "en", "gist": "Exit this way.",
                "lines": [{ "index": 0, "translation": translation, "romanized": "" }]
            })))
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ai = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut photo = sign_photo();
    photo["to"] = json!("or");
    let (status, body) = call(
        with_ocr(state(&ai, "http://unused", None), &ocr),
        "POST",
        "/v1/signs/translate",
        Some(photo),
    )
    .await;
    task.abort();
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["lines"][0]["translation"], "ପ୍ରସ୍ଥାନ");
    assert_eq!(body["reviewRequired"], false);
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn incomplete_sign_translations_are_bounded_and_require_review() {
    for lines in [
        json!([]),
        json!([{ "index": 0, "translation": "EXIT", "romanized": "" }]),
        json!([{ "index": 0, "translation": "  ", "romanized": "" }]),
    ] {
        let ocr = ocr_service("accepted", json!([observation("EXIT", 0)])).await;
        let (ai, attempts) = upstream(
            StatusCode::OK,
            model_reply(json!({"language":"en","gist":"Exit this way.","lines":lines})),
        )
        .await;
        let mut photo = sign_photo();
        photo["to"] = json!("or");
        let (status, body) = call(
            with_ocr(state(&ai, "http://unused", None), &ocr),
            "POST",
            "/v1/signs/translate",
            Some(photo),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["reviewRequired"], true, "{body}");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }
}

#[tokio::test]
async fn sign_numbers_and_same_language_text_do_not_need_retranslation() {
    for (original, target) in [("500", "or"), ("EXIT", "en")] {
        let ocr = ocr_service("accepted", json!([observation(original, 0)])).await;
        let (ai, attempts) = upstream(
            StatusCode::OK,
            model_reply(json!({"language":"en","gist":"Sign.","lines":[
                {"index":0,"translation":original,"romanized":""}
            ]})),
        )
        .await;
        let mut photo = sign_photo();
        photo["to"] = json!(target);
        let (status, body) = call(
            with_ocr(state(&ai, "http://unused", None), &ocr),
            "POST",
            "/v1/signs/translate",
            Some(photo),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["lines"][0]["translation"], original);
        assert_eq!(body["reviewRequired"], false, "{body}");
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }
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

/// iOS returns picked photos as JPEG but labels them with the original file's type.
#[tokio::test]
async fn photos_reach_ocr_typed_by_their_bytes_not_their_label() {
    for (path, label) in [
        ("/v1/signs/translate", "image/png"),
        ("/v1/signs/translate", "image/heic"),
        ("/v1/receipts/extract", "image/png"),
        ("/v1/receipts/extract", "image/heic"),
    ] {
        let ocr = ocr_service("accepted", json!([observation("出口", 0)])).await;
        let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"language":"ja", "gist":"Exit", "lines":[{"index":0,"translation":"Exit","romanized":"deguchi"}], "merchant":"Cafe", "total":"1.00", "currency":"AUD", "date":"2026-10-12", "category":"food", "confidence":0.9}))).await;
        let photo =
            json!({ "data": "/9j/AAAA", "mimeType": label, "to": "en", "localCurrency": "AUD" });
        let (status, body) = call(
            with_ocr(state(&ai, "http://unused", None), &ocr),
            "POST",
            path,
            Some(photo),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{path} labelled {label}: {body}");
    }
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
    for path in ["/v1/translate/text", "/v1/talk/turn", "/v1/talk/speech"] {
        let (status, _) = call(app.clone(), "POST", path, Some(json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
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

#[tokio::test]
async fn planning_evidence_requires_mcp_identity_and_preserves_place_sources() {
    let (base, hits) = upstream(StatusCode::OK, json!({"places":[{"id":"place1","displayName":{"text":"Museum"},"location":{"latitude":21.03,"longitude":105.85},"googleMapsUri":"https://maps.google.com/place1"}]})).await;
    let mut s = state("http://unused", "http://unused", Some(&base));
    Arc::get_mut(&mut s).expect("owner").travel_mcp_key = Some("k".repeat(32));
    for (token, expected) in [
        ("wrong".to_owned(), StatusCode::UNAUTHORIZED),
        ("k".repeat(32), StatusCode::OK),
    ] {
        let response = router(s.clone())
            .oneshot(
                Request::builder()
                    .uri("/internal/v1/travel/planning?destination=Hanoi")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), expected);
        if expected == StatusCode::OK {
            let body: Value = serde_json::from_slice(
                &response
                    .into_body()
                    .collect()
                    .await
                    .expect("body")
                    .to_bytes(),
            )
            .expect("json");
            assert_eq!(
                body["places"][0]["mapsUri"],
                "https://maps.google.com/place1"
            );
            assert!(body["places"][0].get("cost_minor").is_none());
        }
    }
    assert_eq!(hits.load(Ordering::SeqCst), 3);
}

#[tokio::test]
#[ignore = "requires isolated Postgres for durable document ownership"]
async fn verified_receipt_request_uses_gateway_for_judgment_and_generation() {
    use axum::{http::HeaderMap, routing::post, Json, Router};
    let oauth = crate::auth_tests::token(json!({}));
    let expected = format!("Bearer {oauth}");
    let captured = expected.clone();
    let judged = Arc::new(AtomicBool::new(false));
    let model_judged = judged.clone();
    let app = Router::new()
        .route("/v1/decisions", post(move |headers: HeaderMap, Json(body): Json<Value>| async move {
            assert_eq!(headers["authorization"], captured);
            assert_eq!(headers["x-roamie-ai-service"], "roamie-api");
            assert_eq!(headers["x-roamie-ai-capability"], "receipts/extract");
            assert_eq!(body["model"], "jev-1.13.0");
            assert!(!body.to_string().contains("4111"));
            judged.store(true, Ordering::SeqCst);
            Json(json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"accept","confidence":0.9,"probabilities":{"accept":0.9,"review":0.08,"retake":0.02}}},"usage":{"input_tokens":40,"output_tokens":10}}))
        }))
        .route("/v1/chat/completions", post(move |headers: HeaderMap, Json(body): Json<Value>| async move {
            assert!(model_judged.load(Ordering::SeqCst));
            assert_eq!(headers["authorization"], expected);
            assert_eq!(body["model"], "roamie-structured");
            assert!(!body.to_string().contains("inlineData"));
            assert!(!body.to_string().contains("4111"));
            Json(json!({"choices":[{"message":{"content":json!({"merchant":"Cafe Test","total":"12.50","currency":"AUD","date":"2026-10-12","category":"food","confidence":0.95}).to_string()}}]}))
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway =
        crate::gateway::Gateway::for_test(format!("http://{}", listener.local_addr().unwrap()));
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let ocr = ocr_service(
        "accepted",
        json!([observation(
            "Cafe Test TOTAL AUD 12.50 2026-10-12 Card 4111 1111 1111 1111",
            0
        )]),
    )
    .await;
    let mut state = with_ocr(state("http://unused", "http://unused", None), &ocr);
    let mutable = Arc::get_mut(&mut state).unwrap();
    let db = crate::database::Database::connect(
        std::env::var("ROAMIE_TEST_DATABASE_URL")
            .unwrap()
            .parse()
            .unwrap(),
    )
    .await
    .unwrap();
    db.migrate().await.unwrap();
    mutable.database = Some(db);
    mutable.development_auth_disabled = false;
    mutable.auth = Some(crate::auth_tests::verifier(crate::auth_tests::profile()).0);
    mutable.ai = Some(gemini::Gemini::with_gateway(gateway.clone()));
    mutable.jev = Some(crate::decisions::Jev::with_gateway(gateway));
    let request = Request::post("/v1/receipts/extract")
        .header("authorization", format!("Bearer {oauth}"))
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"data":"/9j/AAAA","mimeType":"image/jpeg","localCurrency":"AUD"}).to_string(),
        ))
        .unwrap();
    let response = router(state).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["amountMinor"], 1250);
    assert_eq!(body["source"]["decisionModel"], "jev-1.13.0");
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn odia_speech_uses_the_gateway_and_returns_bounded_wav_audio() {
    use axum::{http::HeaderMap, routing::post, Json, Router};
    let mut wav = b"RIFF".to_vec();
    wav.extend_from_slice(&40_u32.to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&24000_u32.to_le_bytes());
    wav.extend_from_slice(&48000_u32.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&4_u32.to_le_bytes());
    wav.extend_from_slice(&[0, 0, 0, 0]);
    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD.encode(wav);
    let expected = data.clone();
    let app = Router::new().route("/v1/speech", post(move |headers: HeaderMap, Json(body): Json<Value>| async move {
        assert_eq!(headers["authorization"], "Bearer signed-synthetic-customer");
        assert_eq!(body["contents"], json!([{"role":"user","parts":[{"text":"ଧନ୍ୟବାଦ"}]}]), "TTS reads its input verbatim; instructions must never enter the spoken transcript");
        assert_eq!(body["generationConfig"]["responseModalities"][0], "AUDIO");
        Json(json!({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/wav","data":data}}]}}]}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway =
        crate::gateway::Gateway::for_test(format!("http://{}", listener.local_addr().unwrap()));
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = state("http://unused", "http://unused", None);
    Arc::get_mut(&mut state).unwrap().ai = Some(gemini::Gemini::with_gateway(gateway));
    let (status, body) = crate::gateway::scope(
        "signed-synthetic-customer".into(),
        "talk/speech".into(),
        call(
            state,
            "POST",
            "/v1/talk/speech",
            Some(json!({"text":"ଧନ୍ୟବାଦ","language":"or"})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["mimeType"], "audio/wav");
    assert_eq!(body["data"], expected);
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn speech_uses_a_warm_female_or_smooth_male_studio_voice() {
    use axum::{routing::post, Json, Router};
    use base64::Engine;
    let mut wav = b"RIFF\x24\0\0\0WAVE".to_vec();
    wav.resize(44, 0);
    let data = base64::engine::general_purpose::STANDARD.encode(wav);
    for (request, want) in [
        (json!({"text":"Hello","language":"en"}), "Sulafat"),
        (
            json!({"text":"ଆପଣ କେମିତି ଅଛନ୍ତି?","language":"or","voice":"female"}),
            "Sulafat",
        ),
        (
            json!({"text":"ରେଳ ଷ୍ଟେସନ କେଉଁଠି ଅଛି?","language":"or","voice":"male"}),
            "Algieba",
        ),
        (json!({"text":"आप कैसे हैं?","language":"hi"}), "Sulafat"),
        (
            json!({"text":"Hello","language":"en","voice":"female"}),
            "Sulafat",
        ),
        (
            json!({"text":"Hello","language":"en","voice":"male"}),
            "Algieba",
        ),
    ] {
        let data = data.clone();
        let transcript = request["text"].clone();
        let app = Router::new().route("/v1/speech", post(move |Json(body): Json<Value>| async move {
            assert_eq!(body["contents"], json!([{"role":"user","parts":[{"text":transcript}]}]));
            assert_eq!(body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"], want);
            Json(json!({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/wav","data":data}}]}}]}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway =
            crate::gateway::Gateway::for_test(format!("http://{}", listener.local_addr().unwrap()));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut state = state("http://unused", "http://unused", None);
        Arc::get_mut(&mut state).unwrap().ai = Some(gemini::Gemini::with_gateway(gateway));
        let (status, body) = crate::gateway::scope(
            "signed-synthetic-customer".into(),
            "talk/speech".into(),
            call(state, "POST", "/v1/talk/speech", Some(request)),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        task.abort();
        let _ = task.await;
    }
}

#[tokio::test]
async fn speech_rejects_an_unknown_voice() {
    let (status, _) = call(
        state("http://unused", "http://unused", None),
        "POST",
        "/v1/talk/speech",
        Some(json!({"text":"Hello","language":"en","voice":"robot"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn conversation_judgment_uses_recent_context_and_flags_uncertain_translation() {
    use axum::{routing::post, Json, Router};
    let app=Router::new().route("/v1/systemone",post(|Json(body):Json<Value>|async move {
        assert_eq!(body["state"]["purpose"],"conversation translation fidelity and clarity");
        assert_eq!(body["state"]["targetLanguage"],"or");
        assert_eq!(body["state"]["recentConversation"][0]["translation"],"Would you like tea?");
        Json(json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"review","confidence":0.7,"probabilities":{"accept":0.2,"review":0.7,"retake":0.1}}},"usage":{"input_tokens":40,"output_tokens":10}}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1/systemone", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (model, _)=upstream(StatusCode::OK,model_reply(json!({"language":"en","confidence":0.98,"transcript":"Yes please","to_mine":"Yes please","to_partner":"ହଁ, ଦୟାକରି","to_partner_romanized":"Han dayakari"}))).await;
    let mut s = state(&model, "http://unused", None);
    Arc::get_mut(&mut s).unwrap().jev = Some(crate::decisions::Jev::for_test(endpoint));
    let (status,body)=call(s,"POST","/v1/talk/turn",Some(json!({"mine":"en","partner":"or","text":"Yes please","history":[{"original":"ଆପଣ ଚାହା ନେବେ କି?","translation":"Would you like tea?"}]}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reviewRequired"], true);
    assert_eq!(body["decisionModel"], "jev-1.13.0");
    assert_eq!(body["target"], "or");
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn auto_mine_recognizes_a_new_reply_language_while_explicit_mine_stays_fixed() {
    let (model,_)=upstream(StatusCode::OK,model_reply(json!({"language":"hi","confidence":0.98,"transcript":"हाँ, धन्यवाद","to_mine":"Yes, thank you","to_partner":"ହଁ, ଧନ୍ୟବାଦ","to_partner_romanized":"Han dhanyabad"}))).await;
    for (automatic, target, mine, from_me) in [(true, "or", "hi", true), (false, "en", "en", false)]
    {
        let (status,body)=call(state(&model,"http://unused",None),"POST","/v1/talk/turn",Some(json!({"mine":"en","partner":"or","autoMine":automatic,"expectedSpeaker":"mine","text":"हाँ, धन्यवाद","history":[{"original":"ଆପଣ ଚାହା ନେବେ କି?","translation":"Would you like tea?"}]}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["target"], target);
        assert_eq!(body["mine"], mine);
        assert_eq!(body["fromMe"], from_me);
    }
}

#[tokio::test]
async fn conversation_review_redacts_card_numbers_from_all_evidence() {
    use axum::{routing::post, Json, Router};
    let app = Router::new().route("/v1/systemone", post(|Json(body): Json<Value>| async move {
        let evidence = body["state"].to_string();
        assert!(!evidence.contains("4111 1111 1111 1111"));
        assert!(!evidence.contains("4111111111111111"));
        assert!(evidence.contains("••••1111"));
        Json(json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"accept","confidence":0.95,"probabilities":{"accept":0.95,"review":0.04,"retake":0.01}}},"usage":{"input_tokens":40,"output_tokens":10}}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1/systemone", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (model, _) = upstream(StatusCode::OK, model_reply(json!({"language":"en","confidence":0.98,"transcript":"My card is 4111 1111 1111 1111","to_mine":"My card is 4111 1111 1111 1111","to_partner":"Carte 4111111111111111"}))).await;
    let mut s = state(&model, "http://unused", None);
    Arc::get_mut(&mut s).unwrap().jev = Some(crate::decisions::Jev::for_test(endpoint));
    let (status, body) = call(s, "POST", "/v1/talk/turn", Some(json!({"mine":"en","partner":"fr","text":"My card is 4111 1111 1111 1111","history":[{"original":"4111 1111 1111 1111","translation":"4111111111111111"}]}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reviewRequired"], false);
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn speech_rejects_invalid_input_before_provider_and_malformed_audio() {
    let (model, hits) = upstream(StatusCode::OK, json!({})).await;
    for request in [
        json!({"text":" ","language":"or"}),
        json!({"text":"x".repeat(1001),"language":"or"}),
        json!({"text":"Hello","language":"en","model":"user-selected"}),
    ] {
        let (status, _) = call(
            state(&model, "http://unused", None),
            "POST",
            "/v1/talk/speech",
            Some(request),
        )
        .await;
        assert!(status.is_client_error());
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    for inline in [
        json!({"mimeType":"audio/mp3","data":"UklGRg=="}),
        json!({"mimeType":"audio/wav","data":"not base64"}),
        json!({"mimeType":"audio/wav","data":"UklGRg=="}),
        json!({"mimeType":"audio/wav","data":"A".repeat(3 * 1024 * 1024)}),
    ] {
        let (url, _) = upstream(
            StatusCode::OK,
            json!({"candidates":[{"content":{"parts":[{"inlineData":inline}]}}]}),
        )
        .await;
        let (status, _) = call(
            state(&url, "http://unused", None),
            "POST",
            "/v1/talk/speech",
            Some(json!({"text":"Hello","language":"en"})),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }
}

#[tokio::test]
async fn conversation_retake_unavailable_and_low_confidence_are_safe() {
    for (judge_status, choice, confidence, expected, review) in [
        (
            StatusCode::OK,
            "retake",
            0.98,
            StatusCode::BAD_REQUEST,
            false,
        ),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "accept",
            0.98,
            StatusCode::SERVICE_UNAVAILABLE,
            false,
        ),
        (StatusCode::OK, "accept", 0.5, StatusCode::OK, true),
    ] {
        let (judge, _) = upstream(judge_status,json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":choice,"confidence":0.95,"probabilities":{"accept":if choice == "accept" {0.95}else{0.01},"review":0.04,"retake":if choice == "retake" {0.95}else{0.01}}}},"usage":{"input_tokens":40,"output_tokens":10}})).await;
        let (model, _) = upstream(StatusCode::OK,model_reply(json!({"language":"en","confidence":confidence,"transcript":"Yes","to_mine":"Yes","to_partner":"Oui"}))).await;
        let mut s = state(&model, "http://unused", None);
        Arc::get_mut(&mut s).unwrap().jev = Some(crate::decisions::Jev::for_test(judge));
        let (status, body) = call(
            s,
            "POST",
            "/v1/talk/turn",
            Some(json!({"mine":"en","partner":"fr","text":"Yes"})),
        )
        .await;
        assert_eq!(status, expected, "{body}");
        if status == StatusCode::OK {
            assert_eq!(body["reviewRequired"], review);
        }
    }
}

#[tokio::test]
async fn typed_conversation_preserves_the_input_and_reviews_a_rewritten_transcript() {
    let (model, _) = upstream(StatusCode::OK,model_reply(json!({"language":"or","confidence":0.99,"transcript":"ଠିକ୍ ଅଛି, ଧନ୍ୟବାଦ।","to_mine":"ठीक है, धन्यवाद।","to_partner":"D'accord, merci."}))).await;
    let (status, body)=call(state(&model,"http://unused",None),"POST","/v1/talk/turn",Some(json!({"mine":"hi","partner":"fr","autoMine":true,"expectedSpeaker":"mine","text":"ठीक है, धन्यवाद।"}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["transcript"], "ठीक है, धन्यवाद।");
    assert_eq!(body["reviewRequired"], true);
}

#[tokio::test]
async fn automatic_text_detects_source_without_target_language_bias() {
    use axum::{Json, Router};
    let app = Router::new().fallback(|Json(body): Json<Value>| async move {
        let recognition = body["generationConfig"]["responseSchema"]["properties"].get("translation").is_none();
        let answer = if recognition {
            assert!(!body["contents"].to_string().contains("Target language"));
            json!({"language":"en"})
        } else {
            json!({"language":"hi","translation":"ट्रेन स्टेशन कहाँ है?","romanized":"tren steshan kahan hai?"})
        };
        Json(model_reply(answer))
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (status, body) = call(
        state(&url, "http://unused", None),
        "POST",
        "/v1/translate/text",
        Some(json!({"text":"Where is the train station?","to":"hi"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["detected"], "en");
    assert_eq!(body["translation"], "ट्रेन स्टेशन कहाँ है?");
    task.abort();
}

#[tokio::test]
async fn audio_transcription_does_not_require_or_request_generated_translations() {
    use axum::{Json, Router};
    let provider=Router::new().fallback(|Json(body):Json<Value>| async move {
        let properties=&body["generationConfig"]["responseSchema"]["properties"];
        assert!(properties.get("to_mine").is_none() && properties.get("to_partner").is_none(),"speech recognition must not generate translations: {properties}");
        assert!(body["contents"].to_string().contains("selectedLanguages"));
        Json(model_reply(json!({"language":"bn","confidence":0.99,"transcript":"স্টেশন বাঁদিকে।","speaker_voice":"lower"})))
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
    let (nmt,_)=upstream(StatusCode::OK,json!({"languages":[{"languageCode":"bn","confidence":1.0}],"translations":[{"translatedText":"The station is on the left."}]})).await;
    let mut app = state(&url, "http://unused", None);
    Arc::get_mut(&mut app).unwrap().translation = crate::translation::Translation::with_auth(
        reqwest::Client::new(),
        format!("{nmt}/translation"),
        Arc::new(FakeToken),
    );
    let request=serde_json::from_value(json!({"mine":"en","partner":"bn","partnerLocked":true,"audio":{"mimeType":"audio/mp4","data":"AAAA"}})).unwrap();
    let turn = crate::talk::interpret(app.ai.as_ref().unwrap(), &app.translation, None, &request)
        .await
        .unwrap();
    assert_eq!(turn.detected.as_str(), "bn");
    assert_eq!(turn.target.as_str(), "en");
    assert_eq!(turn.translation, "The station is on the left.");
    assert_eq!(turn.voice, Some(crate::speech::Voice::Male));
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn auto_mine_can_accept_its_first_language_before_a_distinct_pair_exists() {
    for partner in ["bn", "ne", "th", "ja", "ur", "si"] {
        let (model,_) = upstream(StatusCode::OK,model_reply(json!({"language":"en","confidence":0.99,"transcript":"Where is the train station?","to_mine":"The station","to_partner":"A translated question"}))).await;
        let (status,body)=call(state(&model,"http://unused",None),"POST","/v1/talk/turn",Some(json!({"mine":partner,"partner":partner,"autoMine":true,"partnerLocked":true,"text":"Where is the train station?"}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["mine"], "en", "{body}");
        assert_eq!(body["partner"], partner, "{body}");
        assert_eq!(body["target"], partner, "{body}");
        assert_eq!(
            body["reviewRequired"], false,
            "the first learned distinct pair must be accepted: {body}"
        );
    }
}

#[tokio::test]
async fn auto_source_changes_are_accepted_when_the_current_language_is_clear() {
    for (profile, partner, source, transcript, history) in [
        ("bn", "th", "en", "Where is the train station?", vec![]),
        (
            "en",
            "bn",
            "hi",
            "रेल चार बजे निकलती है।",
            vec![json!({"original":"Hello","translation":"হ্যালো"})],
        ),
        (
            "ja",
            "ko",
            "vi",
            "Nhà ga ở bên trái.",
            vec![json!({"original":"안녕하세요","translation":"こんにちは"})],
        ),
    ] {
        let (model,_)=upstream(StatusCode::OK,model_reply(json!({"language":source,"confidence":0.99,"transcript":transcript,"to_mine":"A translated reply","to_partner":"A translated reply"}))).await;
        let (status,body)=call(state(&model,"http://unused",None),"POST","/v1/talk/turn",Some(json!({"mine":profile,"partner":partner,"autoMine":true,"partnerLocked":true,"text":transcript,"history":history}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["mine"], source, "{body}");
        assert_eq!(body["target"], partner, "{body}");
        assert_eq!(body["reviewRequired"],false,"Auto must accept clear current speech even when it differs from the fallback or previous source: {body}");
    }
}

#[tokio::test]
async fn auto_mine_starts_in_the_detected_language_with_one_model_call() {
    let (model, hits) = upstream(StatusCode::OK, model_reply(json!({"language":"hi","confidence":0.99,"transcript":"आप कैसे हैं?","to_mine":"How are you?","to_partner":"ଆପଣ କେମିତି ଅଛନ୍ତି?"}))).await;
    let (status, body) = call(
        state(&model, "http://unused", None),
        "POST",
        "/v1/talk/turn",
        Some(json!({"mine":"en","partner":"or","autoMine":true,"text":"आप कैसे हैं?"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    assert_eq!(body["detected"], "hi");
    assert_eq!(body["mine"], "hi");
    assert_eq!(body["partner"], "or");
    assert_eq!(body["fromMe"], true);
    assert_eq!(body["target"], "or");
    assert_eq!(body["translation"], "ଆପଣ କେମିତି ଅଛନ୍ତି?");
}

#[tokio::test]
async fn conversation_remembers_both_languages_and_tracks_language_switches() {
    let cases = [
        (
            "hi",
            "or",
            true,
            "partner",
            "or",
            "ଆପଣ କେମିତି ଅଛନ୍ତି?",
            "hi",
            "or",
            false,
            "hi",
            "आप कैसे हैं?",
        ),
        (
            "hi",
            "or",
            true,
            "mine",
            "hi",
            "मैं ठीक हूँ।",
            "hi",
            "or",
            true,
            "or",
            "ମୁଁ ଭଲ ଅଛି।",
        ),
        (
            "hi",
            "or",
            true,
            "partner",
            "bn",
            "আপনি কেমন আছেন?",
            "hi",
            "bn",
            false,
            "hi",
            "आप कैसे हैं?",
        ),
        (
            "hi",
            "or",
            true,
            "mine",
            "en",
            "I am fine.",
            "en",
            "or",
            true,
            "or",
            "ମୁଁ ଭଲ ଅଛି।",
        ),
        (
            "hi",
            "or",
            false,
            "mine",
            "en",
            "How are you?",
            "hi",
            "en",
            false,
            "hi",
            "आप कैसे हैं?",
        ),
    ];
    for (
        mine,
        partner,
        auto,
        speaker,
        detected,
        original,
        want_mine,
        want_partner,
        from_me,
        target,
        translation,
    ) in cases
    {
        let (model, _) = upstream(StatusCode::OK, model_reply(json!({"language":detected,"confidence":0.99,"transcript":original,"to_mine":"आप कैसे हैं?","to_partner":"ମୁଁ ଭଲ ଅଛି।"}))).await;
        let (status, body) = call(state(&model,"http://unused",None),"POST","/v1/talk/turn",Some(json!({"mine":mine,"partner":partner,"autoMine":auto,"expectedSpeaker":speaker,"text":original,"history":[{"original":"नमस्ते","translation":"ନମସ୍କାର"}]}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["detected"], detected, "{body}");
        assert_eq!(body["mine"], want_mine, "{body}");
        assert_eq!(body["partner"], want_partner, "{body}");
        assert_eq!(body["fromMe"], from_me, "{body}");
        assert_eq!(body["target"], target, "{body}");
        assert_eq!(body["translation"], translation, "{body}");
    }
}

#[tokio::test]
#[cfg(media_tests)]
async fn automatic_conversation_transcribes_once_then_translates_and_reviews() {
    use axum::{extract::OriginalUri, http::HeaderMap, routing::post, Json, Router};
    let hits = Arc::new(AtomicUsize::new(0));
    let captured = hits.clone();
    let handler = post(
        move |OriginalUri(uri): OriginalUri, headers: HeaderMap, Json(body): Json<Value>| {
            let captured = captured.clone();
            async move {
                assert_eq!(headers["authorization"], "Bearer synthetic-customer");
                assert_eq!(
                    body["model"],
                    if uri.path() == "/v1/transcribe" {
                        "roamie-transcription"
                    } else {
                        "roamie-structured"
                    }
                );
                let properties = &body["response_format"]["json_schema"]["schema"]["properties"];
                assert!(properties.get("transcript").is_some(), "{properties}");
                let audio = body["messages"][1]["content"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|part| part["type"] == "image_url");
                assert_eq!(
                    properties.get("to_partner").is_none(),
                    audio,
                    "{properties}"
                );
                assert_eq!(uri.path() == "/v1/transcribe", audio);
                let context = body["messages"][1].to_string();
                assert!(
                    context.contains("recentConversation") && context.contains("ନମସ୍କାର"),
                    "{context}"
                );
                captured.fetch_add(1, Ordering::SeqCst);
                let answer = json!({"language":"hi","confidence":0.99,"transcript":"आप कैसे हैं?","to_mine":"आप कैसे हैं?","to_partner":"ଆପଣ କେମିତି ଅଛନ୍ତି?"});
                Json(json!({"choices":[{"message":{"content":answer.to_string()}}]}))
            }
        },
    );
    let app = Router::new()
        .route("/v1/chat/completions", handler.clone())
        .route("/v1/transcribe", handler)
        .route("/v1/decisions", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
            assert_eq!(headers["authorization"], "Bearer synthetic-customer");
            assert_eq!(body["state"]["sourceLanguage"], "hi");
            assert_eq!(body["state"]["targetLanguage"], "or");
            Json(json!({"model":"jev-1.13.0","answers":{"readability":{"type":"choice","choice":"accept","confidence":0.95,"probabilities":{"accept":0.95,"review":0.04,"retake":0.01}}},"usage":{"input_tokens":40,"output_tokens":10}}))
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway =
        crate::gateway::Gateway::for_test(format!("http://{}", listener.local_addr().unwrap()));
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut s = state("http://unused", "http://unused", None);
    let mutable = Arc::get_mut(&mut s).unwrap();
    mutable.ai = Some(gemini::Gemini::with_gateway(gateway.clone()));
    mutable.jev = Some(crate::decisions::Jev::with_gateway(gateway));
    let (nmt, _) = upstream(StatusCode::OK, json!({"languages":[{"languageCode":"hi","confidence":1.0}],"translations":[{"translatedText":"ଆପଣ କେମିତି ଅଛନ୍ତି?"}]})).await;
    mutable.translation = crate::translation::Translation::with_auth(
        reqwest::Client::new(),
        format!("{nmt}/translation"),
        Arc::new(FakeToken),
    );
    for turn in [
        json!({"mine":"en","partner":"or","autoMine":true,"expectedSpeaker":"mine","text":"आप कैसे हैं?","history":[{"original":"नमस्ते","translation":"ନମସ୍କାର"}]}),
        json!({"mine":"en","partner":"or","autoMine":true,"expectedSpeaker":"mine","audio":{"mimeType":"audio/mp4","data":base64::Engine::encode(&base64::engine::general_purpose::STANDARD, include_bytes!("../testdata/speech-th.m4a"))},"history":[{"original":"नमस्ते","translation":"ନମସ୍କାର"}]}),
    ] {
        let before = hits.load(Ordering::SeqCst);
        let (status, body) = crate::gateway::scope(
            "synthetic-customer".into(),
            "talk/turn".into(),
            call(s.clone(), "POST", "/v1/talk/turn", Some(turn.clone())),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            hits.load(Ordering::SeqCst) - before,
            1,
            "one model call for {turn}"
        );
        assert_eq!(body["reviewRequired"], false);
        assert_eq!(body["mine"], "hi");
        assert_eq!(body["target"], "or");
        assert_eq!(body["translation"], "ଆପଣ କେମିତି ଅଛନ୍ତି?");
    }
    task.abort();
}

#[tokio::test]
async fn auto_conversation_without_a_known_partner_keeps_first_partner_discovery() {
    let (model, _) = upstream(StatusCode::OK, model_reply(json!({"language":"hi","confidence":0.99,"transcript":"नमस्ते","to_mine":"Hello","to_partner":"Hello"}))).await;
    let (status, body) = call(
        state(&model, "http://unused", None),
        "POST",
        "/v1/talk/turn",
        Some(json!({"mine":"en","partner":"en","autoMine":true,"text":"नमस्ते"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["mine"], "en");
    assert_eq!(body["partner"], "hi");
    assert_eq!(body["fromMe"], false);
    assert_eq!(body["target"], "en");
    assert_eq!(body["translation"], "Hello");
}

#[tokio::test]
async fn privacy_resources_are_public_and_offer_account_deletion_without_login() {
    for path in ["/privacy", "/account-deletion"] {
        let response = router(state("http://unused", "http://unused", None))
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            response.headers()["content-type"],
            "text/html; charset=utf-8"
        );
        assert!(response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("default-src 'none'"));
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let html = std::str::from_utf8(&bytes).unwrap();
        assert!(html.contains("Roamie"));
        assert!(html.contains("sales@tesserix.app"));
        assert!(html.contains("account-deletion"));
        assert!(!html.contains("<script"));
    }
}

#[tokio::test]
async fn planning_searches_all_place_categories_concurrently() {
    let ready = Arc::new(tokio::sync::Barrier::new(3));
    let app = axum::Router::new().fallback(move || {
        let ready = ready.clone();
        async move {
            ready.wait().await;
            axum::Json(json!({"places": []}))
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("address"));
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    let mut s = state("http://unused", "http://unused", Some(&base));
    Arc::get_mut(&mut s).expect("owner").travel_mcp_key = Some("k".repeat(32));
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        router(s).oneshot(
            Request::builder()
                .uri("/internal/v1/travel/planning?destination=Tokyo")
                .header("authorization", format!("Bearer {}", "k".repeat(32)))
                .body(Body::empty())
                .expect("request"),
        ),
    )
    .await;
    server.abort();
    assert_eq!(
        response
            .expect("all searches must start before any finishes")
            .expect("response")
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn planning_preserves_provider_relevance_order_when_selecting_places() {
    let places: Vec<_> = (0..10)
        .map(|i| {
            json!({"id":format!("place-{i}"),
        "displayName":{"text":format!("Place {i}")},
        "location":{"latitude":35.0,"longitude":139.0},
        "googleMapsUri":format!("https://maps.google.com/place-{i}")})
        })
        .collect();
    let (base, _) = upstream(StatusCode::OK, json!({"places":places})).await;
    let mut s = state("http://unused", "http://unused", Some(&base));
    Arc::get_mut(&mut s).expect("owner").travel_mcp_key = Some("k".repeat(32));
    let response = router(s)
        .oneshot(
            Request::builder()
                .uri("/internal/v1/travel/planning?destination=Tokyo")
                .header("authorization", format!("Bearer {}", "k".repeat(32)))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    let data: Value = serde_json::from_slice(
        &response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes(),
    )
    .expect("json");
    let expected: Vec<_> = (0..10).map(|i| format!("place-{i}")).collect();
    for category in ["activities", "food", "accommodation"] {
        let ids: Vec<_> = data["places"]
            .as_array()
            .expect("places")
            .iter()
            .filter(|p| p["kind"] == category)
            .map(|p| p["id"].as_str().expect("id").to_owned())
            .collect();
        assert_eq!(ids, expected);
    }
}

#[tokio::test]
async fn planning_searches_requested_interests_before_generic_attractions() {
    let app = axum::Router::new().fallback(|axum::Json(body): axum::Json<Value>| async move {
        let query = body["textQuery"].as_str().expect("query");
        let id = if query.contains("Culture and gardens") {
            "garden"
        } else {
            "generic"
        };
        axum::Json(json!({"places":[{"id":id,"displayName":{"text":id},
            "location":{"latitude":35.0,"longitude":139.0},
            "googleMapsUri":format!("https://maps.google.com/{id}")}]}))
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("address"));
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    let mut s = state("http://unused", "http://unused", Some(&base));
    Arc::get_mut(&mut s).expect("owner").travel_mcp_key = Some("k".repeat(32));
    let response = router(s).oneshot(Request::builder()
        .uri("/internal/v1/travel/planning?destination=Tokyo&interests=Culture%20and%20gardens")
        .header("authorization", format!("Bearer {}", "k".repeat(32)))
        .body(Body::empty()).expect("request")).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    let data: Value = serde_json::from_slice(
        &response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes(),
    )
    .expect("json");
    let ids: Vec<_> = data["places"]
        .as_array()
        .expect("places")
        .iter()
        .filter(|p| p["kind"] == "activities")
        .map(|p| p["id"].as_str().expect("id"))
        .collect();
    assert_eq!(ids, ["garden", "generic"]);
    server.abort();
}

#[tokio::test]
async fn planning_rejects_oversized_or_control_character_interests() {
    for interests in ["x".repeat(501), "gardens%0Ahotels".to_owned()] {
        let mut s = state("http://unused", "http://unused", None);
        Arc::get_mut(&mut s).expect("owner").travel_mcp_key = Some("k".repeat(32));
        let response = router(s)
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/internal/v1/travel/planning?destination=Tokyo&interests={interests}"
                    ))
                    .header("authorization", format!("Bearer {}", "k".repeat(32)))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
#[cfg(media_tests)]
async fn repeated_typed_requests_reuse_the_answer_but_new_context_or_recordings_do_not() {
    let (model, hits) = upstream(StatusCode::OK, model_reply(json!({"language":"en","confidence":0.99,"transcript":"Where is the toilet?","to_mine":"Where is the toilet?","to_partner":"ห้องน้ำอยู่ที่ไหน","translation":"ห้องน้ำอยู่ที่ไหน","romanized":"hong nam yu thi nai"}))).await;
    let s = state(&model, "http://unused", None);
    let typed = json!({"mine":"en","partner":"th","text":"Where is the toilet?"});
    let cases = [
        ("first typed turn", "/v1/talk/turn", typed.clone(), 1),
        (
            "same turn with padding",
            "/v1/talk/turn",
            json!({"mine":"en","partner":"th","text":"  Where is the toilet? "}),
            0,
        ),
        (
            "new history",
            "/v1/talk/turn",
            json!({"mine":"en","partner":"th","text":"Where is the toilet?","history":[{"original":"Hi","translation":"สวัสดี"}]}),
            1,
        ),
        (
            "other partner",
            "/v1/talk/turn",
            json!({"mine":"en","partner":"lo","text":"Where is the toilet?"}),
            1,
        ),
        (
            "recording",
            "/v1/talk/turn",
            json!({"mine":"en","partner":"th","audio":{"mimeType":"audio/mp4","data":base64::Engine::encode(&base64::engine::general_purpose::STANDARD, include_bytes!("../testdata/speech-th.m4a"))}}),
            1,
        ),
        (
            "same recording",
            "/v1/talk/turn",
            json!({"mine":"en","partner":"th","audio":{"mimeType":"audio/mp4","data":base64::Engine::encode(&base64::engine::general_purpose::STANDARD, include_bytes!("../testdata/speech-th.m4a"))}}),
            1,
        ),
        (
            "first text",
            "/v1/translate/text",
            json!({"text":"Where is the toilet?","from":"en","to":"th"}),
            1,
        ),
        (
            "same text",
            "/v1/translate/text",
            json!({"text":"Where is the toilet? ","from":"en","to":"th"}),
            0,
        ),
        (
            "other target",
            "/v1/translate/text",
            json!({"text":"Where is the toilet?","from":"en","to":"lo"}),
            1,
        ),
        (
            "different case",
            "/v1/translate/text",
            json!({"text":"where is the toilet?","from":"en","to":"th"}),
            1,
        ),
    ];
    for (name, uri, request, model_calls) in cases {
        let before = hits.load(Ordering::SeqCst);
        let (status, body) = call(s.clone(), "POST", uri, Some(request)).await;
        assert_eq!(status, StatusCode::OK, "{name}: {body}");
        assert_eq!(
            hits.load(Ordering::SeqCst) - before,
            model_calls,
            "case {name}"
        );
        assert_eq!(body["translation"], "ห้องน้ำอยู่ที่ไหน", "case {name}");
    }
}

#[tokio::test]
async fn failed_answers_are_not_reused() {
    let (model, hits) = upstream(StatusCode::INTERNAL_SERVER_ERROR, json!({})).await;
    let s = state(&model, "http://unused", None);
    for _ in 0..2 {
        let (status, _) = call(
            s.clone(),
            "POST",
            "/v1/translate/text",
            Some(json!({"text":"Hello","from":"en","to":"th"})),
        )
        .await;
        assert_ne!(status, StatusCode::OK);
    }
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

fn with_phrasebook(state: Arc<AppState>, pool: sqlx::PgPool) -> Arc<AppState> {
    let mut s = Arc::into_inner(state).expect("sole owner");
    s.phrasebook = Some(crate::phrasebook::Phrasebook::new(pool, "test-model"));
    Arc::new(s)
}

/// Letters only, so the phrasebook never mistakes it for an account number.
fn unique_phrase(prefix: &str) -> String {
    let unique: String = uuid::Uuid::now_v7()
        .simple()
        .to_string()
        .chars()
        .map(|c| c.to_digit(10).map_or(c, |d| char::from(b'g' + d as u8)))
        .collect();
    format!("{prefix} {unique}")
}

async fn migrated() -> sqlx::PgPool {
    let pool = sqlx::PgPool::connect(&std::env::var("ROAMIE_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

/// The phrasebook writes in the background, so wait briefly for the entry to land.
async fn reaches_uses(pool: &sqlx::PgPool, source: &str, uses: i64) {
    for _ in 0..100 {
        let now: Option<i64> =
            sqlx::query_scalar("SELECT max(uses) FROM phrasebook WHERE source_text=$1")
                .bind(source)
                .fetch_one(pool)
                .await
                .unwrap();
        if now == Some(uses) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("phrase never reached {uses} uses");
}

async fn kept(pool: &sqlx::PgPool, source: &str) -> Vec<(String, String, String, String, String)> {
    for _ in 0..100 {
        let rows: Vec<(String, String, String, String, String)> = sqlx::query_as("SELECT surface,source_lang,target_lang,translation,model FROM phrasebook WHERE source_text=$1")
            .bind(source)
            .fetch_all(pool)
            .await
            .unwrap();
        if !rows.is_empty() {
            return rows;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    Vec::new()
}

#[tokio::test]
async fn an_unreachable_phrasebook_never_fails_a_translation() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(100))
        .connect_lazy("postgres://roamie@127.0.0.1:9/roamie")
        .unwrap();
    let (model, hits) = upstream(StatusCode::OK, model_reply(json!({"language":"en","confidence":0.95,"transcript":"Where is the toilet?","to_mine":"Where is the toilet?","to_partner":"ห้องน้ำอยู่ที่ไหน","to_mine_romanized":"","to_partner_romanized":"hong nam","translation":"ห้องน้ำอยู่ที่ไหน","romanized":"hong nam","source_romanized":"","alternatives":[]}))).await;
    let s = with_phrasebook(state(&model, "http://unused", None), pool);
    for (uri, request) in [
        (
            "/v1/translate/text",
            json!({"text":"Where is the toilet?","from":"en","to":"th"}),
        ),
        (
            "/v1/talk/turn",
            json!({"mine":"en","partner":"th","text":"Where is the toilet?"}),
        ),
    ] {
        let (status, body) = call(s.clone(), "POST", uri, Some(request)).await;
        assert_eq!(status, StatusCode::OK, "{uri}: {body}");
        assert_eq!(body["translation"], "ห้องน้ำอยู่ที่ไหน", "{uri}");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
#[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
async fn another_traveller_is_answered_from_the_phrasebook_without_the_model() {
    let pool = migrated().await;
    let source = unique_phrase("Where is the toilet");
    let (model, hits) = upstream(StatusCode::OK, model_reply(json!({"language":"en","translation":"ห้องน้ำอยู่ที่ไหน","romanized":"hong nam yu thi nai","source_romanized":"","alternatives":[]}))).await;
    for traveller in 1..=3 {
        let s = with_phrasebook(state(&model, "http://unused", None), pool.clone());
        let (status, body) = call(
            s,
            "POST",
            "/v1/translate/text",
            Some(json!({"text":source,"from":"en","to":"th"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            traveller,
            "uncommon phrases are not shared"
        );
        reaches_uses(&pool, &source, traveller as i64).await;
    }
    assert_eq!(
        kept(&pool, &source).await,
        [(
            "text".into(),
            "en".into(),
            "th".into(),
            "ห้องน้ำอยู่ที่ไหน".into(),
            "test-model".into()
        )]
    );
    let cases = [
        (
            "known source",
            json!({"text":format!(" {source}  "),"from":"en","to":"th"}),
            0,
        ),
        ("detected source", json!({"text":source,"to":"th"}), 1),
    ];
    for (name, request, model_calls) in cases {
        let other = with_phrasebook(state(&model, "http://unused", None), pool.clone());
        let before = hits.load(Ordering::SeqCst);
        let (status, body) = call(other, "POST", "/v1/translate/text", Some(request)).await;
        assert_eq!(status, StatusCode::OK, "{name}: {body}");
        assert_eq!(body["translation"], "ห้องน้ำอยู่ที่ไหน", "{name}");
        assert_eq!(body["romanized"], "hong nam yu thi nai", "{name}");
        assert_eq!(hits.load(Ordering::SeqCst) - before, model_calls, "{name}");
    }
}

#[tokio::test]
#[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
async fn conversation_turns_and_sign_lines_are_kept_in_the_phrasebook() {
    let pool = migrated().await;
    let spoken = unique_phrase("Where is the toilet");
    let (model, _) = upstream(StatusCode::OK, model_reply(json!({"language":"en","confidence":0.95,"transcript":spoken,"to_mine":spoken,"to_partner":"ห้องน้ำอยู่ที่ไหน","to_mine_romanized":"","to_partner_romanized":"hong nam"}))).await;
    let s = with_phrasebook(state(&model, "http://unused", None), pool.clone());
    let (status, body) = call(
        s,
        "POST",
        "/v1/talk/turn",
        Some(json!({"mine":"en","partner":"th","text":spoken})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        kept(&pool, &spoken).await,
        [(
            "talk".into(),
            "en".into(),
            "th".into(),
            "ห้องน้ำอยู่ที่ไหน".into(),
            "test-model".into()
        )]
    );
    let sign = unique_phrase("出口");
    let ocr = ocr_service("accepted", json!([observation(&sign, 0)])).await;
    let (model, _) = upstream(StatusCode::OK, model_reply(json!({"language":"ja", "gist":"Exit", "lines":[{"index":0,"translation":"Exit","romanized":"deguchi"}]}))).await;
    let s = with_phrasebook(
        with_ocr(state(&model, "http://unused", None), &ocr),
        pool.clone(),
    );
    let (status, body) = call(s, "POST", "/v1/signs/translate", Some(sign_photo())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        kept(&pool, &sign).await,
        [(
            "sign".into(),
            "ja".into(),
            "en".into(),
            "Exit".into(),
            "test-model".into()
        )]
    );
}

#[tokio::test]
async fn locked_partner_preserves_bengali_reply_target_and_allows_source_language_changes() {
    for (detected, expected, from_me) in [("ja", "bn", false), ("hi", "ja", true)] {
        let (ai, _) = upstream(StatusCode::OK, model_reply(json!({"language":detected,"confidence":0.99,"transcript":"test","to_mine":"Bengali reply","to_partner":"Japanese reply"}))).await;
        let (status, body) = call(state(&ai,"http://unused",None),"POST","/v1/talk/turn",Some(json!({"mine":"bn","partner":"ja","partnerLocked":true,"autoMine":true,"expectedSpeaker":"partner","text":"test"}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["target"], expected);
        assert_eq!(body["partner"], "ja");
        assert_eq!(body["fromMe"], from_me);
        assert_eq!(body["mine"], if from_me { detected } else { "bn" });
    }
}

#[tokio::test]
#[cfg(media_tests)]
async fn real_multilingual_audio_reaches_translation_after_speech_detection() {
    use base64::Engine;
    for audio in [
        include_bytes!("../testdata/speech-en.m4a").as_slice(),
        include_bytes!("../testdata/speech-ja.m4a").as_slice(),
        include_bytes!("../testdata/speech-hi.m4a").as_slice(),
        include_bytes!("../testdata/speech-th.m4a").as_slice(),
        include_bytes!("../testdata/short-en.m4a").as_slice(),
        include_bytes!("../testdata/short-ja.m4a").as_slice(),
        include_bytes!("../testdata/short-hi.m4a").as_slice(),
        include_bytes!("../testdata/short-th.m4a").as_slice(),
    ] {
        let (ai, hits) = upstream(StatusCode::OK, model_reply(json!({"language":"en","confidence":0.99,"transcript":"Hello","to_mine":"Hello","to_partner":"こんにちは"}))).await;
        let (status, body) = call(state(&ai,"http://unused",None), "POST", "/v1/talk/turn", Some(json!({"mine":"en","partner":"ja","audio":{"mimeType":"audio/mp4","data":base64::engine::general_purpose::STANDARD.encode(audio)}}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["transcript"], "Hello");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
#[cfg(media_tests)]
async fn quiet_audio_cannot_become_a_new_turn_even_when_history_contains_a_phrase() {
    use base64::Engine;
    let mut pcm = vec![0_i16; 32000];
    for sample in &mut pcm[16000..16080] {
        *sample = 12000;
    }
    let mut wav = b"RIFF".to_vec();
    wav.extend_from_slice(&(36 + pcm.len() as u32 * 2).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&16000_u32.to_le_bytes());
    wav.extend_from_slice(&32000_u32.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32 * 2).to_le_bytes());
    wav.extend(pcm.iter().flat_map(|sample| sample.to_le_bytes()));
    let (ai, hits) = upstream(
        StatusCode::OK,
        model_reply(json!({"language":"en","confidence":0.99,"transcript":"Water and a receipt, please.","to_mine":"Water and a receipt, please.","to_partner":"水と領収書をお願いします。"})),
    ).await;
    let (status, body) = call(
        state(&ai, "http://unused", None), "POST", "/v1/talk/turn",
        Some(json!({"mine":"en","partner":"ja","audio":{"mimeType":"audio/wav","data":base64::engine::general_purpose::STANDARD.encode(wav)},"history":[{"original":"Water and a receipt, please.","translation":"水と領収書をお願いします。"}]})),
    ).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "no_speech");
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
#[cfg(media_tests)]
async fn malformed_audio_is_rejected_without_contacting_translation() {
    let (ai, hits) = upstream(StatusCode::OK, json!({})).await;
    for data in [
        "not-base64".to_owned(),
        "AAAA".to_owned(),
        "A".repeat(3 * 1024 * 1024),
    ] {
        let (status, body) = call(
            state(&ai, "http://unused", None),
            "POST",
            "/v1/talk/turn",
            Some(json!({"mine":"en","partner":"ja","audio":{"mimeType":"audio/mp4","data":data}})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["error"], "invalid");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}
