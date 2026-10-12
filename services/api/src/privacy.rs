use axum::http::header;
use axum::response::{Html, IntoResponse};

fn page(html: &'static str) -> impl IntoResponse {
    (
        [
            (header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        Html(html),
    )
}

pub async fn privacy() -> impl IntoResponse {
    page(include_str!("../public/privacy.html"))
}

pub async fn account_deletion() -> impl IntoResponse {
    page(include_str!("../public/account-deletion.html"))
}
