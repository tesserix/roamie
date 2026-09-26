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
                async move { Json(body) }
            }),
        )
        .route(
            "/userinfo",
            get(move || {
                let body = profile.clone();
                async move { Json(body) }
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
