use crate::{
    auth::Customer,
    error::{Error, Result},
    AppState,
};
use axum::{
    extract::State,
    http::{header, StatusCode},
    Extension, Json,
};
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize, sqlx::FromRow, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RequestStatus {
    id: String,
    status: String,
    requested_at: String,
    due_at: String,
    owner: String,
}

const SELECT: &str = "SELECT id::text,status,to_char(requested_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS requested_at,to_char(due_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS due_at,'sales@tesserix.app'::text AS owner FROM account_deletion_requests WHERE subject=$1 AND issuer=$2";

pub async fn get(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
) -> Result<impl axum::response::IntoResponse> {
    let db = state
        .database
        .as_ref()
        .ok_or(Error::Unavailable("Account storage"))?;
    let issuer = state
        .auth
        .as_ref()
        .ok_or(Error::Unavailable("Account verification"))?
        .issuer();
    let request = sqlx::query_as::<_, RequestStatus>(SELECT)
        .bind(&customer.sub)
        .bind(issuer)
        .fetch_optional(&db.pool)
        .await?
        .ok_or(Error::NotFound)?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(request)))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
) -> Result<impl axum::response::IntoResponse> {
    let db = state
        .database
        .as_ref()
        .ok_or(Error::Unavailable("Account storage"))?;
    let issuer = state
        .auth
        .as_ref()
        .ok_or(Error::Unavailable("Account verification"))?
        .issuer();
    let mut tx = db.pool.begin().await?;
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(&customer.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO account_deletion_requests(id,subject,issuer,contact_email) VALUES($1,$2,$3,$4) ON CONFLICT(subject) DO NOTHING")
        .bind(uuid::Uuid::now_v7()).bind(&customer.sub).bind(issuer).bind(&customer.email).execute(&mut *tx).await?;
    let request = sqlx::query_as::<_, RequestStatus>(SELECT)
        .bind(&customer.sub)
        .bind(issuer)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Error::NotFound)?;
    tx.commit().await?;
    Ok((
        StatusCode::ACCEPTED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(request),
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_account_deletion_contract() {
        use ts_rs::TS;
        std::fs::write(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/mobile/src/lib/account-deletion-contract.ts"),
            format!("// Generated from Rust account_deletion.rs; run cargo test export_account_deletion_contract.\nexport {}\n", super::RequestStatus::decl()),
        ).expect("write deletion request contract");
    }
}
