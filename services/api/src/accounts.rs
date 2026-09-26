use crate::{
    auth::Customer,
    error::{Error, Result},
    AppState,
};
use axum::{
    extract::{Query, State},
    http::header,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;

fn pool(state: &AppState) -> Result<&sqlx::PgPool> {
    state
        .database
        .as_ref()
        .map(|db| &db.pool)
        .ok_or(Error::Unavailable("Account storage"))
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
) -> Result<impl axum::response::IntoResponse> {
    let issuer = state
        .auth
        .as_ref()
        .map(|auth| auth.issuer())
        .unwrap_or("local-development");
    let mut tx = pool(&state)?.begin().await?;
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(&customer.sub)
        .execute(&mut *tx)
        .await?;
    let name = customer.name.chars().take(120).collect::<String>();
    let result=sqlx::query("INSERT INTO accounts(subject,issuer,email,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(subject) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,updated_at=now() WHERE accounts.issuer=excluded.issuer AND (accounts.email IS DISTINCT FROM excluded.email OR accounts.display_name IS DISTINCT FROM excluded.display_name)")
        .bind(&customer.sub).bind(issuer).bind(customer.email.to_lowercase()).bind(name).execute(&mut *tx).await;
    match result {
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505") => {
            return Err(Error::Conflict)
        }
        other => {
            other?;
        }
    }
    let matches: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE subject=$1 AND issuer=$2)")
            .bind(&customer.sub)
            .bind(issuer)
            .fetch_one(&mut *tx)
            .await?;
    if !matches {
        return Err(Error::Conflict);
    }
    tx.commit().await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(customer)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    after: Option<i64>,
}
#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    id: String,
    operation: String,
    entity_type: String,
    entity_id: String,
    changed_columns: Vec<String>,
    created_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    items: Vec<AuditEvent>,
    next_cursor: Option<String>,
}

pub async fn audit(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Query(page): Query<Page>,
) -> Result<impl axum::response::IntoResponse> {
    if page.after.is_some_and(|id| id < 0) {
        return Err(Error::Invalid("Invalid audit cursor.".into()));
    }
    let mut items=sqlx::query_as::<_,AuditEvent>("SELECT id::text,operation,entity_type,entity_id,changed_columns,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS created_at FROM audit_events WHERE actor_subject=$1 AND ($2::bigint IS NULL OR id>$2) ORDER BY id LIMIT 21")
        .bind(&customer.sub).bind(page.after).fetch_all(pool(&state)?).await?;
    let more = items.len() > 20;
    items.truncate(20);
    let next_cursor = if more {
        items.last().map(|item| item.id.clone())
    } else {
        None
    };
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(AuditPage { items, next_cursor }),
    ))
}

pub async fn styles(State(state): State<Arc<AppState>>) -> Result<Json<Vec<serde_json::Value>>> {
    let rows = sqlx::query("SELECT code,label FROM travel_styles ORDER BY sort_order")
        .fetch_all(pool(&state)?)
        .await?;
    Ok(Json(rows.into_iter().map(|row|serde_json::json!({"code":row.get::<String,_>("code"),"label":row.get::<String,_>("label")})).collect()))
}
