use crate::{
    error::{Error, Result},
    AppState,
};
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::Row;
use std::{fmt, sync::Arc, time::Duration};
use tokio::sync::watch;
use uuid::Uuid;

pub struct Sender {
    key: String,
    from: String,
    url: String,
}
impl fmt::Debug for Sender {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ResendSender([redacted])")
    }
}
impl Sender {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let key = std::env::var("RESEND_API_KEY")
            .ok()
            .filter(|v| !v.trim().is_empty());
        let from = std::env::var("RESEND_FROM")
            .ok()
            .filter(|v| !v.trim().is_empty());
        match (key, from) {
            (None, None) => Ok(None),
            (Some(key), Some(from)) => {
                anyhow::ensure!(
                    !from.chars().any(char::is_control) && from.len() <= 200 && from.contains('@'),
                    "invalid RESEND_FROM"
                );
                Ok(Some(Self {
                    key,
                    from,
                    url: "https://api.resend.com/emails".into(),
                }))
            }
            _ => anyhow::bail!("configure both RESEND_API_KEY and RESEND_FROM"),
        }
    }
    async fn send(&self, http: &Client, id: &str, to: &str, text: &str) -> Outcome {
        let result=http.post(&self.url).bearer_auth(&self.key).header("Idempotency-Key",id).timeout(Duration::from_secs(15)).json(&json!({"from":self.from,"to":[to],"subject":"Roamie: a friendly shared trip reminder","text":text})).send().await;
        let Ok(mut response) = result else {
            return Outcome::Retry;
        };
        let code = response.status();
        if code.is_success() {
            let mut bytes = Vec::new();
            loop {
                match response.chunk().await {
                    Ok(Some(chunk)) if bytes.len() + chunk.len() <= 16384 => {
                        bytes.extend_from_slice(&chunk)
                    }
                    Ok(None) => break,
                    _ => return Outcome::Retry,
                }
            }
            let id = serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| {
                v.get("id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty() && s.len() <= 200)
                    .map(str::to_owned)
            });
            return id.map_or(Outcome::Retry, Outcome::Accepted);
        }
        if code.is_server_error() || code.as_u16() == 429 {
            Outcome::Retry
        } else {
            Outcome::Failed
        }
    }
}
enum Outcome {
    Accepted(String),
    Retry,
    Failed,
}

fn display_amount(minor: i64, currency: &str) -> String {
    let exponent = crate::money::Currency::parse(currency).map_or(2, |c| c.exponent());
    if exponent == 0 {
        return format!("{currency} {minor}");
    }
    let scale = 10_i64.pow(exponent);
    format!(
        "{currency} {}.{:0width$}",
        minor / scale,
        minor % scale,
        width = exponent as usize
    )
}

pub async fn enqueue(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    group: &crate::group_budget::Budget,
    customer: &crate::auth::Customer,
    key: Uuid,
    from: Uuid,
    to: Uuid,
    currency: &str,
) -> Result<()> {
    let creditor = group
        .participants
        .iter()
        .find(|p| p.id == to)
        .ok_or(Error::NotFound)?;
    if !customer.email_verified || (!group.is_owner && !creditor.is_self) {
        return Err(Error::NotFound);
    }
    let debtor = group
        .participants
        .iter()
        .find(|p| p.id == from)
        .ok_or(Error::NotFound)?;
    if debtor.email.is_empty() {
        return Err(Error::Invalid(
            "Add an email address for this traveller first.".into(),
        ));
    }
    let owed = crate::group_budget::debts(
        &group.expenses,
        &group.settlements,
        time::OffsetDateTime::now_utc().date(),
    )
    .into_iter()
    .find(|d| d.from_id == from && d.to_id == to && d.currency == currency)
    .ok_or_else(|| Error::Invalid("This balance is already settled. Refresh the group.".into()))?;
    if !owed.overdue {
        return Err(Error::Invalid(
            "Email reminders are available after 30 days unpaid.".into(),
        ));
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('roamie-mail-actor:'||$1,0))")
        .bind(&customer.sub)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('roamie-mail-recipient:'||lower($1),0))",
    )
    .bind(&debtor.email)
    .execute(&mut **tx)
    .await?;
    let recipient_count:i64=sqlx::query_scalar("SELECT count(*) FROM group_mail_outbox WHERE lower(recipient)=lower($1) AND created_at>now()-interval '1 day'").bind(&debtor.email).fetch_one(&mut **tx).await?;
    let recent:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM group_mail_outbox WHERE group_id=$1 AND from_id=$2 AND to_id=$3 AND currency=$4 AND created_at>now()-interval '7 days' AND status IN ('queued','accepted'))").bind(group.id).bind(from).bind(to).bind(currency).fetch_one(&mut **tx).await?;
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM group_mail_outbox WHERE actor_subject=$1 AND created_at>now()-interval '1 day'").bind(&customer.sub).fetch_one(&mut **tx).await?;
    if recent || count >= 20 || recipient_count >= 5 {
        return Err(Error::ReminderCooldown);
    }
    let body=format!("Hi {},\n\nA friendly reminder for {}. When this reminder was requested, Roamie recorded {} as owed to {}. The oldest unpaid share was dated {}.\n\nPlease open Roamie > Budget > Split with a group to check the current balance. If you have already repaid this amount, please ask the group to record the repayment. This email is a reminder, not a payment request from your bank. Roamie does not move money.\n\nThis reminder was requested by a member of your Roamie group. If it is unexpected, contact sales@tesserix.app.\n",debtor.name,group.title,display_amount(owed.amount_minor,currency),creditor.name,owed.oldest_on);
    sqlx::query("INSERT INTO group_mail_outbox(group_id,id,actor_subject,from_id,to_id,currency,amount_minor,recipient,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(group.id).bind(key).bind(&customer.sub).bind(from).bind(to).bind(currency).bind(owed.amount_minor).bind(&debtor.email).bind(body).execute(&mut **tx).await?;
    Ok(())
}

pub async fn deliver_one(state: &AppState) -> Result<bool> {
    deliver(state, None).await
}
async fn deliver(state: &AppState, scope: Option<Uuid>) -> Result<bool> {
    let (Some(database), Some(sender)) = (&state.database, &state.mail) else {
        return Ok(false);
    };
    let row=sqlx::query("UPDATE group_mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '90 seconds',updated_at=now() WHERE (group_id,id)=(SELECT group_id,id FROM group_mail_outbox WHERE status='queued' AND ($1::uuid IS NULL OR group_id=$1) AND next_attempt_at<=now() AND attempts<5 AND created_at>now()-interval '23 hours' ORDER BY created_at,group_id,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING group_id,id,actor_subject,from_id,to_id,currency,amount_minor,recipient,body,attempts").bind(scope).fetch_optional(&database.pool).await?;
    let Some(row) = row else {
        return Ok(false);
    };
    let group: Uuid = row.get("group_id");
    let id: Uuid = row.get("id");
    let actor: String = row.get("actor_subject");
    let from: Uuid = row.get("from_id");
    let to: Uuid = row.get("to_id");
    let currency: String = row.get("currency");
    let amount: i64 = row.get("amount_minor");
    let recipient: String = row.get("recipient");
    let body: String = row.get("body");
    let attempts: i32 = row.get("attempts");
    let current = crate::group_budget_api::load(&database.pool, &actor, group).await;
    let valid = match current {
        Ok(budget) => {
            budget
                .participants
                .iter()
                .any(|p| p.id == from && p.email == recipient)
                && crate::group_budget::debts(
                    &budget.expenses,
                    &budget.settlements,
                    time::OffsetDateTime::now_utc().date(),
                )
                .iter()
                .any(|d| {
                    d.from_id == from
                        && d.to_id == to
                        && d.currency == currency
                        && d.amount_minor == amount
                        && d.overdue
                })
        }
        Err(Error::NotFound) => false,
        Err(error) => return Err(error),
    };
    let outcome = if valid {
        sender
            .send(
                &state.http,
                &format!("roamie-group-{group}-{id}"),
                &recipient,
                &body,
            )
            .await
    } else {
        Outcome::Failed
    };
    let (status, provider_id) = match outcome {
        Outcome::Accepted(id) => ("accepted", Some(id)),
        Outcome::Retry if attempts < 5 => ("queued", None),
        _ => (if valid { "failed" } else { "cancelled" }, None),
    };
    let delay = [5, 30, 120, 300, 900][(attempts - 1).clamp(0, 4) as usize]
        + i32::from(id.as_bytes()[0] % 7);
    sqlx::query("UPDATE group_mail_outbox SET status=$3,provider_id=$4,next_attempt_at=now()+make_interval(secs=>$5),updated_at=now() WHERE group_id=$1 AND id=$2 AND status='queued'").bind(group).bind(id).bind(status).bind(provider_id).bind(f64::from(delay)).execute(&database.pool).await?;
    Ok(true)
}
pub async fn run(state: Arc<AppState>, mut shutdown: watch::Receiver<bool>) {
    if state.mail.is_none() {
        return;
    }
    let mut timer = tokio::time::interval(Duration::from_secs(5));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {changed=shutdown.changed()=>{if changed.is_err()||*shutdown.borrow(){break;}},_=timer.tick()=>{
         for _ in 0..4{match deliver_one(&state).await{Ok(true)=>{},Ok(false)=>break,Err(_)=>{tracing::warn!("group email queue unavailable");break;}}}
         if let Some(db)=&state.database{let _=sqlx::query("UPDATE group_mail_outbox SET status='failed',updated_at=now() WHERE status='queued' AND (attempts>=5 OR created_at<=now()-interval '23 hours') AND next_attempt_at<=now()").execute(&db.pool).await;}
        }}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json};
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test]
    async fn resend_retries_use_the_same_key_and_only_accept_a_valid_provider_id() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let app = axum::Router::new().route(
            "/emails",
            post(
                move |headers: axum::http::HeaderMap, Json(body): Json<Value>| {
                    let calls = seen.clone();
                    async move {
                        assert_eq!(
                            headers.get("idempotency-key").unwrap(),
                            "synthetic-operation"
                        );
                        assert_eq!(body["to"][0], "delivered@resend.dev");
                        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                            (
                                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                                Json(json!({"error":"temporary"})),
                            )
                        } else {
                            (
                                axum::http::StatusCode::OK,
                                Json(json!({"id":"synthetic-email"})),
                            )
                        }
                    }
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/emails", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let sender = Sender {
            key: "synthetic-test-key".into(),
            from: "Roamie <test@example.invalid>".into(),
            url,
        };
        assert!(!format!("{sender:?}").contains("synthetic-test-key"));
        assert!(matches!(
            sender
                .send(
                    &Client::new(),
                    "synthetic-operation",
                    "delivered@resend.dev",
                    "Synthetic reminder"
                )
                .await,
            Outcome::Retry
        ));
        assert!(
            matches!(sender.send(&Client::new(),"synthetic-operation","delivered@resend.dev","Synthetic reminder").await,Outcome::Accepted(id) if id=="synthetic-email")
        );
        task.abort();
    }
}

#[cfg(test)]
mod queue_tests {
    use super::*;
    use crate::{auth::Customer, group_budget::Budget, group_budget_api as api};
    use axum::{
        extract::{Path, State},
        routing::post,
        Extension, Json,
    };
    use sqlx::postgres::PgConnectOptions;
    use std::{
        str::FromStr,
        sync::atomic::{AtomicUsize, Ordering},
    };
    async fn fixture(state: &Arc<AppState>, who: &Customer) -> Budget {
        let recipient = format!("synthetic-{}@example.invalid", Uuid::now_v7());
        let group=api::create(State(state.clone()),Extension(who.clone()),Json(serde_json::from_value(json!({"requestId":Uuid::now_v7().to_string(),"title":"Synthetic email QA","currency":"AUD","displayName":"Alice"})).unwrap())).await.unwrap().0;
        let group=api::command(State(state.clone()),Extension(who.clone()),Path(group.id),Json(serde_json::from_value(json!({"requestId":Uuid::now_v7().to_string(),"expectedRevision":group.revision,"change":{"action":"participant","id":null,"name":"Synthetic traveller","email":recipient,"whatsapp":""}})).unwrap())).await.unwrap().0;
        api::command(State(state.clone()),Extension(who.clone()),Path(group.id),Json(serde_json::from_value(json!({"requestId":Uuid::now_v7().to_string(),"expectedRevision":group.revision,"change":{"action":"expense","id":null,"payerId":group.participants[0].id,"description":"Synthetic dinner","currency":"AUD","amountMinor":10000,"occurredOn":"2026-09-01","method":"equal","shares":group.participants.iter().map(|p|json!({"participantId":p.id,"value":1})).collect::<Vec<_>>(),"homeCurrency":"AUD"}})).unwrap())).await.unwrap().0
    }
    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn outbox_is_durable_deduplicated_and_cancels_settled_debts() {
        let db = crate::database::Database::connect(
            PgConnectOptions::from_str(&std::env::var("ROAMIE_TEST_DATABASE_URL").unwrap())
                .unwrap(),
        )
        .await
        .unwrap();
        db.migrate().await.unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let app = axum::Router::new().route(
            "/emails",
            post(move |Json(body): Json<Value>| {
                let calls = seen.clone();
                async move {
                    assert!(body["to"][0]
                        .as_str()
                        .unwrap()
                        .ends_with("@example.invalid"));
                    calls.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"id":"synthetic-email-id"}))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/emails", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut state = crate::tests::state("http://unused", "http://unused", None);
        let mutable = Arc::get_mut(&mut state).unwrap();
        mutable.database = Some(db.clone());
        mutable.mail = Some(Sender {
            key: "synthetic-only".into(),
            from: "Roamie <test@example.invalid>".into(),
            url,
        });
        let who = Customer {
            sub: format!("mail-test-{}", Uuid::now_v7()),
            email: "owner@example.invalid".into(),
            name: "Alice".into(),
            email_verified: true,
            organization: "test".into(),
        };
        let group = fixture(&state, &who).await;
        let from = group.participants[1].id;
        let to = group.participants[0].id;
        let payload = json!({"requestId":Uuid::now_v7().to_string(),"expectedRevision":group.revision,"change":{"action":"emailReminder","fromId":from,"toId":to,"currency":"AUD"}});
        let queued = api::command(
            State(state.clone()),
            Extension(who.clone()),
            Path(group.id),
            Json(serde_json::from_value(payload.clone()).unwrap()),
        )
        .await
        .unwrap()
        .0;
        let key = queued.emails[0].id;
        assert_eq!(queued.emails[0].status, "queued");
        let replay = api::command(
            State(state.clone()),
            Extension(who.clone()),
            Path(group.id),
            Json(serde_json::from_value(payload).unwrap()),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(replay.emails.len(), 1);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "enqueue must not call the provider"
        );
        assert!(deliver(&state, Some(group.id)).await.unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!deliver(&state, Some(group.id)).await.unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let status: String =
            sqlx::query_scalar("SELECT status FROM group_mail_outbox WHERE group_id=$1 AND id=$2")
                .bind(group.id)
                .bind(key)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(status, "accepted");
        let mut tx = db.pool.begin().await.unwrap();
        assert!(matches!(
            enqueue(&mut tx, &group, &who, Uuid::now_v7(), from, to, "AUD").await,
            Err(Error::ReminderCooldown)
        ));
        tx.rollback().await.unwrap();
        let other = fixture(&state, &who).await;
        let from = other.participants[1].id;
        let to = other.participants[0].id;
        let key = Uuid::now_v7();
        let mut tx = db.pool.begin().await.unwrap();
        enqueue(&mut tx, &other, &who, key, from, to, "AUD")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let _ = api::command(State(state.clone()),Extension(who.clone()),Path(other.id),Json(serde_json::from_value(json!({"requestId":Uuid::now_v7().to_string(),"expectedRevision":other.revision,"change":{"action":"settlement","fromId":from,"toId":to,"currency":"AUD","amountMinor":5000,"occurredOn":"2026-10-01"}})).unwrap())).await.unwrap();
        assert!(deliver(&state, Some(other.id)).await.unwrap());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "settled reminder must not send"
        );
        task.abort();
    }
}
