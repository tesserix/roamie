use crate::auth::{AuthError, Config, Verifier};
use aws_lc_rs::{
    encoding::AsDer,
    rsa::{KeyPair, KeySize, PublicKeyComponents},
    signature::KeyPair as _,
};
use axum::{routing::get, Json, Router};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

fn key() -> &'static KeyPair {
    static KEY: OnceLock<KeyPair> = OnceLock::new();
    KEY.get_or_init(|| KeyPair::generate(KeySize::Rsa2048).expect("test RSA key"))
}

pub fn token(overrides: Value) -> String {
    let mut claims = json!({"sub":"customer-a","iss":"https://identity.example","aud":["roamie-project"],"client_id":"roamie-ios","exp":SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_secs()+600});
    for (name, value) in overrides.as_object().expect("overrides") {
        claims[name] = value.clone();
    }
    let der = key().as_der().expect("test DER");
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key".into());
    let pem = format!(
        "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----",
        STANDARD.encode(der.as_ref())
    );
    let encoding = EncodingKey::from_rsa_pem(pem.as_bytes()).expect("test encoding key");
    encode(&header, &claims, &encoding).expect("test JWT")
}

pub fn profile() -> Value {
    json!({"sub":"customer-a","email":"traveller@example.com","email_verified":true,"name":"Traveller","urn:zitadel:iam:user:resourceowner:id":"tesserix-org"})
}

pub fn verifier(profile: Value) -> (Verifier, Arc<AtomicUsize>) {
    verifier_with_statuses(
        profile,
        axum::http::StatusCode::OK,
        axum::http::StatusCode::OK,
    )
}

fn verifier_with_statuses(
    profile: Value,
    keys_status: axum::http::StatusCode,
    userinfo_status: axum::http::StatusCode,
) -> (Verifier, Arc<AtomicUsize>) {
    let public = PublicKeyComponents::from(key().public_key());
    let keys = json!({"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"test-key","n":URL_SAFE_NO_PAD.encode(public.n),"e":URL_SAFE_NO_PAD.encode(public.e)}]});
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    let app = Router::new()
        .route(
            "/keys",
            get(move || {
                let body = keys.clone();
                count.fetch_add(1, Ordering::SeqCst);
                async move { (keys_status, Json(body)) }
            }),
        )
        .route(
            "/userinfo",
            get(move || {
                let body = profile.clone();
                async move { (userinfo_status, Json(body)) }
            }),
        );
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.set_nonblocking(true).expect("nonblocking");
    let addr = listener.local_addr().expect("address");
    let listener = tokio::net::TcpListener::from_std(listener).expect("listener");
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("test identity server")
    });
    (
        Verifier::new(Config {
            public: None,
            issuer: "https://identity.example".into(),
            audience: "roamie-project".into(),
            organization: "tesserix-org".into(),
            clients: ["roamie-ios".to_string(), "roamie-android".to_string()].into(),
            jwks_url: format!("http://{addr}/keys"),
            userinfo_url: format!("http://{addr}/userinfo"),
        })
        .expect("verifier"),
        hits,
    )
}

#[tokio::test]
async fn only_signed_unexpired_project_tokens_from_allowed_clients_are_accepted() {
    let (verifier, _) = verifier(profile());
    assert_eq!(
        verifier
            .verify(&token(json!({})))
            .await
            .expect("valid identity")
            .sub,
        "customer-a"
    );
    for invalid in [
        json!({"iss":"https://attacker.example"}),
        json!({"aud":["another-product"]}),
        json!({"client_id":"another-client"}),
        json!({"exp":1}),
        json!({"sub":""}),
        json!({"nbf":u64::MAX/2}),
    ] {
        assert!(
            matches!(
                verifier.verify(&token(invalid.clone())).await,
                Err(AuthError::Required)
            ),
            "accepted {invalid}"
        );
    }
    let mut tampered = token(json!({}));
    let index = tampered.rfind('.').expect("signature") + 1;
    tampered.replace_range(
        index..index + 1,
        if &tampered[index..index + 1] == "A" {
            "B"
        } else {
            "A"
        },
    );
    assert!(matches!(
        verifier.verify(&tampered).await,
        Err(AuthError::Required)
    ));
    assert!(matches!(
        verifier.verify("not-a-token").await,
        Err(AuthError::Required)
    ));
}

#[tokio::test]
async fn unverified_email_other_org_and_mismatched_userinfo_subject_are_denied() {
    for (field, value) in [
        ("email_verified", json!(false)),
        (
            "urn:zitadel:iam:user:resourceowner:id",
            json!("another-org"),
        ),
        ("sub", json!("customer-b")),
        ("email", json!("")),
    ] {
        let mut data = profile();
        data[field] = value;
        let (verifier, _) = verifier(data);
        assert!(
            matches!(
                verifier.verify(&token(json!({}))).await,
                Err(AuthError::Forbidden)
            ),
            "accepted {field}"
        );
    }
}

#[tokio::test]
async fn jwks_are_cached_across_authenticated_requests() {
    let (verifier, hits) = verifier(profile());
    let token = token(json!({}));
    for _ in 0..3 {
        assert!(verifier.verify(&token).await.is_ok());
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn conflicting_authorization_headers_are_rejected_before_identity_lookup() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    let mut state = crate::tests::state("http://unused", "http://unused", None);
    let (verifier, hits) = verifier(profile());
    let owner = Arc::get_mut(&mut state).expect("unique state");
    owner.development_auth_disabled = false;
    owner.auth = Some(verifier);
    let valid = format!("Bearer {}", token(json!({})));
    for credentials in [
        [valid.as_str(), "Bearer invalid"],
        ["Bearer invalid", valid.as_str()],
    ] {
        let response = crate::router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/memories/capabilities")
                    .header("authorization", credentials[0])
                    .header("authorization", credentials[1])
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

const CUSTOMER_ROUTES: &[(&str, &str)] = &[
    ("GET", "/v1/trips/another-users-trip/profile"),
    ("PUT", "/v1/trips/another-users-trip/profile"),
    ("POST", "/v1/talk/turn"),
    ("POST", "/v1/talk/speech"),
    ("POST", "/v1/translate/text"),
    ("POST", "/v1/destinations/search"),
    ("GET", "/v1/nearby?lat=1&lng=2&kind=food&diet=none"),
    ("GET", "/v1/fx?base=AUD"),
    ("GET", "/v1/auth/me"),
    ("GET", "/v1/auth/audit"),
    ("GET", "/v1/reference/trip-styles"),
    ("POST", "/v1/trips/plan"),
    ("POST", "/v1/memories/capabilities"),
    ("POST", "/v1/trip-manager"),
    ("POST", "/v1/signs/translate"),
    ("POST", "/v1/receipts/extract"),
    ("POST", "/v1/statements/extract"),
    ("POST", "/v1/memories/render"),
];

async fn customer_request(
    state: Arc<crate::AppState>,
    method: &str,
    path: &str,
    authorization: Option<&str>,
) -> axum::response::Response {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    let mut request = Request::builder().method(method).uri(path);
    if let Some(authorization) = authorization {
        request = request.header("authorization", authorization);
    }
    crate::router(state)
        .oneshot(request.body(Body::empty()).expect("request"))
        .await
        .expect("response")
}

#[tokio::test]
async fn every_customer_route_rejects_missing_invalid_and_workload_credentials() {
    use axum::http::StatusCode;

    let mut state = crate::tests::state("http://unused", "http://unused", None);
    let owner = Arc::get_mut(&mut state).expect("unique state");
    owner.development_auth_disabled = false;
    owner.auth = Some(verifier(profile()).0);
    owner.travel_mcp_key = Some("k".repeat(32));
    let mut credentials = vec![
        None,
        Some("Bearer ".into()),
        Some("Bearer not-a-token".into()),
        Some("Basic credentials".into()),
        Some(format!("Bearer {}", "k".repeat(32))),
        Some(format!("Bearer {}", "x".repeat(16 * 1024 + 1))),
    ];
    for claims in [
        json!({"iss":"https://attacker.example"}),
        json!({"aud":["another-product"]}),
        json!({"client_id":"another-client"}),
        json!({"exp":1}),
        json!({"exp":null}),
        json!({"sub":""}),
        json!({"nbf":u64::MAX/2}),
    ] {
        credentials.push(Some(format!("Bearer {}", token(claims))));
    }
    for &(method, path) in CUSTOMER_ROUTES {
        for (case, authorization) in credentials.iter().enumerate() {
            let response =
                customer_request(state.clone(), method, path, authorization.as_deref()).await;
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{method} {path}, case {case}"
            );
            assert_eq!(response.headers()["www-authenticate"], "Bearer");
            assert_eq!(response.headers()["cache-control"], "no-store");
        }
    }
}

#[tokio::test]
async fn every_customer_route_denies_unverified_and_foreign_accounts() {
    use axum::http::StatusCode;

    let authorization = format!("Bearer {}", token(json!({})));
    for (field, value) in [
        ("email_verified", json!(false)),
        (
            "urn:zitadel:iam:user:resourceowner:id",
            json!("another-org"),
        ),
        ("sub", json!("another-user")),
    ] {
        let mut profile = profile();
        profile[field] = value;
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        let owner = Arc::get_mut(&mut state).expect("unique state");
        owner.development_auth_disabled = false;
        owner.auth = Some(verifier(profile).0);
        for &(method, path) in CUSTOMER_ROUTES {
            let response =
                customer_request(state.clone(), method, path, Some(&authorization)).await;
            assert_eq!(
                response.status(),
                StatusCode::FORBIDDEN,
                "{method} {path}, {field}"
            );
            assert_eq!(response.headers()["cache-control"], "no-store");
        }
    }
}

#[tokio::test]
async fn verified_ios_and_android_customers_can_access_customer_routes() {
    use axum::http::StatusCode;

    let mut state = crate::tests::state("http://unused", "http://unused", None);
    let owner = Arc::get_mut(&mut state).expect("unique state");
    owner.development_auth_disabled = false;
    owner.auth = Some(verifier(profile()).0);
    for client in ["roamie-ios", "roamie-android"] {
        let authorization = format!("Bearer {}", token(json!({"client_id":client})));
        let response = customer_request(
            state.clone(),
            "POST",
            "/v1/memories/capabilities",
            Some(&authorization),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK, "{client}");
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .expect("body");
        assert_eq!(
            serde_json::from_slice::<Value>(&body).expect("JSON")["editorVersion"],
            1
        );
    }
}

#[tokio::test]
async fn revoked_tokens_and_identity_provider_failures_never_allow_access() {
    use axum::http::StatusCode;

    let authorization = format!("Bearer {}", token(json!({})));
    for (keys_status, userinfo_status, expected) in [
        (
            StatusCode::OK,
            StatusCode::UNAUTHORIZED,
            StatusCode::UNAUTHORIZED,
        ),
        (
            StatusCode::OK,
            StatusCode::SERVICE_UNAVAILABLE,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            StatusCode::OK,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        let owner = Arc::get_mut(&mut state).expect("unique state");
        owner.development_auth_disabled = false;
        owner.auth = Some(verifier_with_statuses(profile(), keys_status, userinfo_status).0);
        let response = customer_request(
            state,
            "POST",
            "/v1/memories/capabilities",
            Some(&authorization),
        )
        .await;
        assert_eq!(response.status(), expected);
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
}

#[tokio::test]
async fn missing_verifier_fails_closed_on_every_customer_route() {
    use axum::http::StatusCode;

    let mut state = crate::tests::state("http://unused", "http://unused", None);
    Arc::get_mut(&mut state)
        .expect("unique state")
        .development_auth_disabled = false;
    let authorization = format!("Bearer {}", token(json!({})));
    for &(method, path) in CUSTOMER_ROUTES {
        let response = customer_request(state.clone(), method, path, Some(&authorization)).await;
        assert_eq!(
            response.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "{method} {path}"
        );
    }
}
