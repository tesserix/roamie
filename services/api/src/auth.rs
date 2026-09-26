use std::{collections::HashSet, sync::Arc, time::Duration};

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::{sync::Mutex, time::Instant};

use crate::AppState;

pub fn development_mode(flag: &str, development_build: bool) -> anyhow::Result<bool> {
    match flag {
        "true" => Ok(false),
        "false" if development_build => Ok(true),
        "false" => anyhow::bail!("AUTH_ENABLED=false is only allowed in debug builds"),
        _ => anyhow::bail!("AUTH_ENABLED must be true or false"),
    }
}

const MAX_RESPONSE: usize = 32 * 1024;

pub struct Config {
    pub public: Option<PublicConfig>,
    pub issuer: String,
    pub audience: String,
    pub organization: String,
    pub clients: HashSet<String>,
    pub jwks_url: String,
    pub userinfo_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    pub issuer: String,
    pub organization_id: String,
    pub project_id: String,
    pub client_ids: serde_json::Value,
    pub providers: serde_json::Value,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    fn from_lookup(input: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let required = |key| {
            input(key)
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("{key} is required"))
        };
        let issuer = required("ZITADEL_ISSUER")?;
        let url = reqwest::Url::parse(&issuer)?;
        anyhow::ensure!(
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.query().is_none()
                && url.fragment().is_none(),
            "ZITADEL_ISSUER must be an HTTPS origin"
        );
        anyhow::ensure!(
            issuer.trim_end_matches('/') == issuer && url.path() == "/",
            "ZITADEL_ISSUER must not contain a path or trailing slash"
        );
        let ios = required("ZITADEL_IOS_CLIENT_ID")?;
        let android = required("ZITADEL_ANDROID_CLIENT_ID")?;
        let organization = required("ZITADEL_ORG_ID")?;
        let audience = required("ZITADEL_PROJECT_ID")?;
        let mut providers = serde_json::Map::new();
        for (name, key) in [
            ("google", "ZITADEL_GOOGLE_IDP_ID"),
            ("facebook", "ZITADEL_FACEBOOK_IDP_ID"),
            ("apple", "ZITADEL_APPLE_IDP_ID"),
        ] {
            if let Some(id) = input(key).filter(|id| !id.trim().is_empty()) {
                providers.insert(name.into(), id.into());
            }
        }
        anyhow::ensure!(
            !providers.is_empty(),
            "at least one social provider is required"
        );
        let public = PublicConfig {
            issuer: issuer.clone(),
            organization_id: organization.clone(),
            project_id: audience.clone(),
            client_ids: serde_json::json!({"ios":ios,"android":android}),
            providers: providers.into(),
        };
        let clients = [ios, android].into();
        Ok(Self {
            jwks_url: format!("{issuer}/oauth/v2/keys"),
            userinfo_url: format!("{issuer}/oidc/v1/userinfo"),
            issuer,
            clients,
            audience,
            organization,
            public: Some(public),
        })
    }
}

pub struct Verifier {
    config: Config,
    http: reqwest::Client,
    keys: Mutex<Option<(Instant, JwkSet)>>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Customer {
    pub sub: String,
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(skip_serializing)]
    pub email_verified: bool,
    #[serde(rename = "urn:zitadel:iam:user:resourceowner:id", skip_serializing)]
    pub organization: String,
}

#[derive(Clone, Deserialize)]
struct Claims {
    sub: String,
    client_id: String,
}

#[derive(Clone, Copy, Debug)]
pub enum AuthError {
    Required,
    Forbidden,
    Unavailable,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Required => (
                StatusCode::UNAUTHORIZED,
                "authentication_required",
                "Sign in to continue.",
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "account_not_verified",
                "Use a verified account to continue.",
            ),
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "authentication_unavailable",
                "Sign-in is temporarily unavailable. Try again shortly.",
            ),
        };
        let mut response = (
            status,
            Json(serde_json::json!({"error":code,"message":message})),
        )
            .into_response();
        if status == StatusCode::UNAUTHORIZED {
            response.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                header::HeaderValue::from_static("Bearer"),
            );
        }
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
        response
    }
}

impl Verifier {
    pub fn issuer(&self) -> &str {
        &self.config.issuer
    }
    pub fn new(config: Config) -> anyhow::Result<Self> {
        Ok(Self {
            config,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            keys: Mutex::new(None),
        })
    }

    async fn key(&self, kid: &str) -> Result<DecodingKey, AuthError> {
        let mut cache = self.keys.lock().await;
        let refresh = match cache.as_ref() {
            None => true,
            Some((loaded, keys)) => {
                loaded.elapsed() >= Duration::from_secs(300)
                    || (keys.find(kid).is_none() && loaded.elapsed() >= Duration::from_secs(30))
            }
        };
        if refresh {
            let response = self
                .http
                .get(&self.config.jwks_url)
                .send()
                .await
                .map_err(|_| AuthError::Unavailable)?;
            if !response.status().is_success() {
                return Err(AuthError::Unavailable);
            }
            let keys: JwkSet = bounded_json(response).await?;
            if keys.keys.is_empty() || keys.keys.len() > 32 {
                return Err(AuthError::Unavailable);
            }
            *cache = Some((Instant::now(), keys));
        }
        let key = cache
            .as_ref()
            .and_then(|(_, keys)| keys.find(kid))
            .ok_or(AuthError::Required)?;
        DecodingKey::from_jwk(key).map_err(|_| AuthError::Required)
    }

    pub async fn verify(&self, token: &str) -> Result<Customer, AuthError> {
        if token.len() > 16 * 1024 {
            return Err(AuthError::Required);
        }
        let header = decode_header(token).map_err(|_| AuthError::Required)?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::Required);
        }
        let kid = header
            .kid
            .filter(|k| !k.is_empty() && k.len() <= 200)
            .ok_or(AuthError::Required)?;
        let key = self.key(&kid).await?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.config.issuer]);
        validation.set_audience(&[&self.config.audience]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        validation.leeway = 15;
        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|_| AuthError::Required)?
            .claims;
        if claims.sub.is_empty()
            || claims.sub.len() > 200
            || !self.config.clients.contains(&claims.client_id)
        {
            return Err(AuthError::Required);
        }
        let response = self
            .http
            .get(&self.config.userinfo_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| AuthError::Unavailable)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::Required);
        }
        if !response.status().is_success() {
            return Err(AuthError::Unavailable);
        }
        let customer: Customer = bounded_json(response).await?;
        if customer.sub != claims.sub
            || customer.organization != self.config.organization
            || !customer.email_verified
            || customer.email.len() > 254
            || !customer.email.contains('@')
            || customer.email.chars().any(char::is_whitespace)
        {
            return Err(AuthError::Forbidden);
        }
        Ok(customer)
    }
}

async fn bounded_json<T: DeserializeOwned>(
    mut response: reqwest::Response,
) -> Result<T, AuthError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| AuthError::Unavailable)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err(AuthError::Unavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| AuthError::Unavailable)
}

pub async fn require_customer(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    if cfg!(debug_assertions) && state.development_auth_disabled {
        request.extensions_mut().insert(Customer {
            sub: "local-development".into(),
            email: "developer@roamie.invalid".into(),
            name: "Local traveller".into(),
            email_verified: false,
            organization: "local-development".into(),
        });
        return Ok(next.run(request).await);
    }
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .filter(|t| !t.is_empty())
        .ok_or(AuthError::Required)?;
    let customer = state
        .auth
        .as_ref()
        .ok_or(AuthError::Unavailable)?
        .verify(token)
        .await?;
    request.extensions_mut().insert(customer);
    Ok(next.run(request).await)
}

pub async fn configuration(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AuthError> {
    let config = state
        .auth
        .as_ref()
        .and_then(|v| v.config.public.clone())
        .ok_or(AuthError::Unavailable)?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(config)))
}

#[cfg(test)]
mod config_tests {
    use super::*;
    #[test]
    fn absent_facebook_does_not_disable_configured_social_providers() {
        let config = Config::from_lookup(|key| match key {
            "ZITADEL_ISSUER" => Some("https://auth.tesserix.app".into()),
            "ZITADEL_FACEBOOK_IDP_ID" => None,
            _ => Some("123".into()),
        })
        .expect("valid provider configuration");
        let public = config.public.expect("public configuration");
        assert_eq!(public.providers["google"], "123");
        assert!(public.providers.get("facebook").is_none());
    }
}

#[cfg(test)]
mod development_tests {
    use super::development_mode;
    #[test]
    fn bypass_requires_explicit_false_and_a_debug_build() {
        assert!(!development_mode("true", true).expect("default"));
        assert!(development_mode("false", true).expect("development"));
        assert!(development_mode("false", false).is_err());
        assert!(development_mode("False", true).is_err());
        assert!(development_mode("", true).is_err());
    }
}
