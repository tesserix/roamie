use crate::{
    auth::Customer,
    error::{Error, Result},
    group_budget::{self as ledger, Budget, Participant, Share},
    money::Currency,
    AppState,
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;
#[path = "group_budget_currencies.rs"]
mod currencies;

fn pool(state: &AppState) -> Result<&PgPool> {
    state
        .database
        .as_ref()
        .map(|d| &d.pool)
        .ok_or(Error::Unavailable("Group budgets"))
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn currency(value: &str) -> Result<Currency> {
    if !currencies::CODES.contains(&value) {
        return Err(Error::Invalid(
            "Choose a three-letter currency code.".into(),
        ));
    }
    Currency::parse(value).ok_or_else(|| Error::Invalid("Choose a currency.".into()))
}
fn request_id(value: &str) -> Result<Uuid> {
    if !text(value, 100) {
        return Err(Error::Invalid("Invalid request identity.".into()));
    }
    let hash = Sha256::digest(value.as_bytes());
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    Ok(Uuid::from_bytes(bytes))
}
fn date(value: &str) -> Result<time::Date> {
    let day = time::Date::parse(
        value,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .map_err(|_| Error::Invalid("Use a valid expense date.".into()))?;
    if day.year() < 1900 || day > time::OffsetDateTime::now_utc().date() + time::Duration::days(1) {
        return Err(Error::Invalid("Choose today or an earlier date.".into()));
    }
    Ok(day)
}
fn email_valid(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let parts: Vec<_> = value.split('@').collect();
    value.len() <= 254
        && value.is_ascii()
        && !value
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || ",;?&#".contains(c))
        && parts.len() == 2
        && !parts[0].is_empty()
        && parts[1].contains('.')
        && !parts[1].starts_with('.')
        && !parts[1].ends_with('.')
}
fn phone_valid(value: &str) -> bool {
    value.is_empty()
        || (value.starts_with('+')
            && (8..=16).contains(&value.len())
            && value.as_bytes()[1] != b'0'
            && value[1..].bytes().all(|b| b.is_ascii_digit()))
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| Error::Unavailable("Group budgets"))
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "CreateGroup")]
pub struct Create {
    request_id: String,
    title: String,
    currency: String,
    display_name: String,
}
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    after: Option<Uuid>,
}
#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "GroupCommand")]
pub struct Command {
    request_id: String,
    #[ts(type = "number")]
    expected_revision: i64,
    #[serde(rename = "change")]
    action: Action,
}
#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(rename = "GroupChange")]
pub enum Action {
    Participant {
        #[ts(type = "string | null")]
        id: Option<Uuid>,
        name: String,
        email: String,
        whatsapp: String,
    },
    Expense {
        #[ts(type = "string | null")]
        id: Option<Uuid>,
        #[ts(type = "string")]
        payer_id: Uuid,
        description: String,
        currency: String,
        #[ts(type = "number")]
        amount_minor: i64,
        occurred_on: String,
        #[ts(type = "'equal' | 'percentage' | 'exact'")]
        method: String,
        shares: Vec<Share>,
        home_currency: String,
    },
    VoidExpense {
        #[ts(type = "string")]
        id: Uuid,
    },
    Settlement {
        #[ts(type = "string")]
        from_id: Uuid,
        #[ts(type = "string")]
        to_id: Uuid,
        currency: String,
        #[ts(type = "number")]
        amount_minor: i64,
        occurred_on: String,
    },
    VoidSettlement {
        #[ts(type = "string")]
        id: Uuid,
    },
    Invite {
        #[ts(type = "string")]
        participant_id: Uuid,
    },
    EmailReminder {
        #[ts(type = "string")]
        from_id: Uuid,
        #[ts(type = "string")]
        to_id: Uuid,
        currency: String,
    },
    RevokeAccess {
        #[ts(type = "string")]
        participant_id: Uuid,
    },
    RevokeInvite {
        #[ts(type = "string")]
        participant_id: Uuid,
    },
}

async fn scoped<'a>(
    pool: &'a PgPool,
    subject: &str,
    id: Uuid,
    write: bool,
) -> Result<(Transaction<'a, Postgres>, String, i64)> {
    let mut tx = pool.begin().await?;
    let query = if write {
        "SELECT g.owner_subject,g.revision FROM trip_groups g JOIN group_memberships m ON m.group_id=g.id AND m.subject=$2 AND m.active WHERE g.id=$1 FOR UPDATE OF g"
    } else {
        "SELECT g.owner_subject,g.revision FROM trip_groups g JOIN group_memberships m ON m.group_id=g.id AND m.subject=$2 AND m.active WHERE g.id=$1 FOR SHARE OF g"
    };
    let (owner, revision): (String, i64) = sqlx::query_as(query)
        .bind(id)
        .bind(subject)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Error::NotFound)?;
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(subject)
        .execute(&mut *tx)
        .await?;
    Ok((tx, owner, revision))
}
async fn document(
    tx: &mut Transaction<'_, Postgres>,
    subject: &str,
    id: Uuid,
    owner: &str,
) -> Result<Budget> {
    let (title, currency, revision): (String, String, i64) =
        sqlx::query_as("SELECT title,currency,revision FROM trip_groups WHERE id=$1")
            .bind(id)
            .fetch_one(&mut **tx)
            .await?;
    let participants:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'whatsapp',whatsapp,'isSelf',coalesce(subject=$2,false),'hasAccount',subject IS NOT NULL,'invitedUntil',invited_until) ORDER BY created_at,id),'[]'::jsonb) FROM group_participants WHERE group_id=$1").bind(id).bind(subject).fetch_one(&mut **tx).await?;
    let expenses:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(x.doc ORDER BY x.occurred_on DESC,x.id DESC),'[]'::jsonb) FROM (SELECT e.id,e.occurred_on,jsonb_build_object('id',e.id,'payerId',e.payer_id,'description',e.description,'currency',e.currency,'amountMinor',e.amount_minor,'occurredOn',e.occurred_on::text,'method',e.split_method,'shares',e.split_input,'splits',(SELECT coalesce(jsonb_agg(jsonb_build_object('participantId',s.participant_id,'amountMinor',s.amount_minor) ORDER BY s.participant_id),'[]'::jsonb) FROM group_expense_splits s WHERE s.group_id=e.group_id AND s.expense_id=e.id),'homeCurrency',coalesce(e.home_currency,e.currency),'homeMinor',coalesce(e.home_minor,e.amount_minor),'rateAsOf',coalesce(e.rate_as_of,''),'canEdit',e.created_by=$2 OR $3) AS doc FROM group_expenses e WHERE e.group_id=$1 AND e.voided_at IS NULL ORDER BY e.occurred_on DESC,e.id DESC LIMIT 1000) x").bind(id).bind(subject).bind(owner==subject).fetch_one(&mut **tx).await?;
    let settlements:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'fromId',from_id,'toId',to_id,'currency',currency,'amountMinor',amount_minor,'occurredOn',occurred_on::text) ORDER BY occurred_on,id),'[]'::jsonb) FROM group_settlements WHERE group_id=$1 AND voided_at IS NULL").bind(id).fetch_one(&mut **tx).await?;
    let emails:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(doc ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM (SELECT created_at,id,jsonb_build_object('id',id,'fromId',from_id,'toId',to_id,'currency',currency,'amountMinor',amount_minor,'status',status,'requestedAt',created_at) doc FROM group_mail_outbox WHERE group_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20) recent").bind(id).fetch_one(&mut **tx).await?;
    Ok(Budget {
        id,
        title,
        currency,
        revision,
        is_owner: owner == subject,
        participants: decode(participants)?,
        expenses: decode(expenses)?,
        settlements: decode(settlements)?,
        emails: decode(emails)?,
    })
}
pub async fn load(pool: &PgPool, subject: &str, id: Uuid) -> Result<Budget> {
    let (mut tx, owner, _) = scoped(pool, subject, id, false).await?;
    let data = document(&mut tx, subject, id, &owner).await?;
    tx.commit().await?;
    Ok(data)
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Query(page): Query<Page>,
) -> Result<Json<Value>> {
    let pool = pool(&state)?;
    let mut groups:Vec<(Uuid,String,String)>=sqlx::query_as("SELECT g.id,g.title,g.currency FROM trip_groups g JOIN group_memberships m ON m.group_id=g.id WHERE m.subject=$1 AND m.active AND ($2::uuid IS NULL OR g.id<$2) ORDER BY g.id DESC LIMIT 51").bind(&customer.sub).bind(page.after).fetch_all(pool).await?;
    let next = if groups.len() > 50 {
        groups.truncate(50);
        groups.last().map(|x| x.0)
    } else {
        None
    };
    let invitations: Vec<(Uuid, String, String)> = if customer.email_verified {
        sqlx::query_as("SELECT g.id,g.title,g.currency FROM trip_groups g JOIN group_participants p ON p.group_id=g.id WHERE lower(p.email)=lower($1) AND p.subject IS NULL AND p.invited_until>now() ORDER BY g.id DESC LIMIT 50").bind(&customer.email).fetch_all(pool).await?
    } else {
        vec![]
    };
    let map = |items: Vec<(Uuid, String, String)>| {
        items
            .into_iter()
            .map(|(id, title, currency)| json!({"id":id,"title":title,"currency":currency}))
            .collect::<Vec<_>>()
    };
    Ok(Json(
        json!({"groups":map(groups),"invitations":map(invitations),"nextCursor":next}),
    ))
}
pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Json(input): Json<Create>,
) -> Result<Json<Budget>> {
    if !text(&input.title, 120) || !text(&input.display_name, 100) {
        return Err(Error::Invalid("Add a group name and your name.".into()));
    }
    currency(&input.currency)?;
    let key = request_id(&input.request_id)?;
    let creation_hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&input).map_err(|_| Error::Invalid("Invalid group.".into()))?,
    ));
    let pool = pool(&state)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(&customer.sub)
        .execute(&mut *tx)
        .await?;
    let id = Uuid::now_v7();
    let inserted:Option<Uuid>=sqlx::query_scalar("INSERT INTO trip_groups(id,owner_subject,title,request_key,currency,creation_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_subject,request_key) DO NOTHING RETURNING id").bind(id).bind(&customer.sub).bind(input.title.trim()).bind(key).bind(&input.currency).bind(&creation_hash).fetch_optional(&mut *tx).await?;
    let id = if let Some(id) = inserted {
        sqlx::query(
            "INSERT INTO group_memberships(group_id,subject,display_name) VALUES($1,$2,$3)",
        )
        .bind(id)
        .bind(&customer.sub)
        .bind(input.display_name.trim())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO group_participants(group_id,id,subject,name,email) VALUES($1,$2,$3,$4,$5)",
        )
        .bind(id)
        .bind(Uuid::now_v7())
        .bind(&customer.sub)
        .bind(input.display_name.trim())
        .bind(if customer.email_verified {
            customer.email.as_str()
        } else {
            ""
        })
        .execute(&mut *tx)
        .await?;
        id
    } else {
        let (id, previous_hash): (Uuid, Option<String>) = sqlx::query_as(
            "SELECT id,creation_hash FROM trip_groups WHERE owner_subject=$1 AND request_key=$2",
        )
        .bind(&customer.sub)
        .bind(key)
        .fetch_one(&mut *tx)
        .await?;
        if previous_hash.as_deref() != Some(creation_hash.as_str()) {
            return Err(Error::BudgetChanged);
        }
        id
    };
    let data = document(&mut tx, &customer.sub, id, &customer.sub).await?;
    tx.commit().await?;
    Ok(Json(data))
}
pub async fn get(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(id): Path<Uuid>,
) -> Result<Json<Budget>> {
    Ok(Json(load(pool(&state)?, &customer.sub, id).await?))
}

pub async fn join(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(id): Path<Uuid>,
) -> Result<Json<Budget>> {
    if !customer.email_verified {
        return Err(Error::NotFound);
    }
    let pool = pool(&state)?;
    let mut tx = pool.begin().await?;
    let owner:String=sqlx::query_scalar("SELECT g.owner_subject FROM trip_groups g WHERE g.id=$1 AND (EXISTS(SELECT 1 FROM group_participants p WHERE p.group_id=g.id AND p.subject IS NULL AND lower(p.email)=lower($2) AND p.invited_until>now()) OR EXISTS(SELECT 1 FROM group_memberships m WHERE m.group_id=g.id AND m.subject=$3 AND m.active)) FOR UPDATE").bind(id).bind(&customer.email).bind(&customer.sub).fetch_optional(&mut *tx).await?.ok_or(Error::NotFound)?;
    sqlx::query("SELECT set_config('roamie.actor',$1,true)")
        .bind(&customer.sub)
        .execute(&mut *tx)
        .await?;
    let already:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM group_memberships WHERE group_id=$1 AND subject=$2 AND active)").bind(id).bind(&customer.sub).fetch_one(&mut *tx).await?;
    if !already {
        let participant:Option<(Uuid,String)>=sqlx::query_as("SELECT id,name FROM group_participants WHERE group_id=$1 AND subject IS NULL AND lower(email)=lower($2) AND invited_until>now() ORDER BY id LIMIT 1 FOR UPDATE").bind(id).bind(&customer.email).fetch_optional(&mut *tx).await?;
        let (pid, name) = participant.ok_or(Error::NotFound)?;
        sqlx::query("INSERT INTO group_memberships(group_id,subject,display_name) VALUES($1,$2,$3) ON CONFLICT(group_id,subject) DO UPDATE SET active=true,updated_at=now()").bind(id).bind(&customer.sub).bind(name).execute(&mut *tx).await?;
        sqlx::query("UPDATE group_participants SET subject=$3,invited_until=NULL,updated_at=now() WHERE group_id=$1 AND id=$2").bind(id).bind(pid).bind(&customer.sub).execute(&mut *tx).await?;
        sqlx::query("UPDATE trip_groups SET revision=revision+1,updated_at=now() WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let data = document(&mut tx, &customer.sub, id, &owner).await?;
    tx.commit().await?;
    Ok(Json(data))
}

struct Quote {
    currency: String,
    minor: i64,
    as_of: String,
}
async fn quote(state: &AppState, amount: i64, from: &str, home: &str) -> Result<Quote> {
    let source = currency(from)?;
    let target = currency(home)?;
    if from == home {
        return Ok(Quote {
            currency: home.into(),
            minor: amount,
            as_of: time::OffsetDateTime::now_utc().to_string(),
        });
    }
    let rates = state.fx.latest(&state.http, target.clone()).await?;
    let rate = rates
        .rates
        .get(from)
        .copied()
        .filter(|x| x.is_finite() && *x > 0.0)
        .ok_or(Error::Unavailable("This currency conversion"))?;
    let minor = (amount as f64 / 10f64.powi(source.exponent() as i32) / rate
        * 10f64.powi(target.exponent() as i32))
    .round();
    if !minor.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&minor) {
        return Err(Error::Invalid(
            "This conversion exceeds the supported amount.".into(),
        ));
    }
    Ok(Quote {
        currency: home.into(),
        minor: minor as i64,
        as_of: rates.as_of,
    })
}
fn participant(budget: &Budget, id: Uuid) -> Result<&Participant> {
    budget
        .participants
        .iter()
        .find(|p| p.id == id)
        .ok_or(Error::NotFound)
}

pub async fn command(
    State(state): State<Arc<AppState>>,
    Extension(customer): Extension<Customer>,
    Path(id): Path<Uuid>,
    Json(input): Json<Command>,
) -> Result<Json<Budget>> {
    let key = request_id(&input.request_id)?;
    let hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&input).map_err(|_| Error::Invalid("Invalid group update.".into()))?,
    ));
    let pool = pool(&state)?;
    let initial = load(pool, &customer.sub, id).await?;
    let replay: Option<(String, String)> = sqlx::query_as(
        "SELECT actor_subject,request_hash FROM group_budget_commands WHERE group_id=$1 AND id=$2",
    )
    .bind(id)
    .bind(key)
    .fetch_optional(pool)
    .await?;
    if let Some((actor, previous)) = replay {
        if actor != customer.sub || previous != hash {
            return Err(Error::BudgetChanged);
        }
        return Ok(Json(initial));
    }
    if initial.revision != input.expected_revision {
        return Err(Error::BudgetChanged);
    }
    let conversion = if let Action::Expense {
        amount_minor,
        currency,
        home_currency,
        method,
        shares,
        occurred_on,
        ..
    } = &input.action
    {
        load(pool, &customer.sub, id).await?;
        ledger::allocate(*amount_minor, method, shares)?;
        date(occurred_on)?;
        Some(quote(&state, *amount_minor, currency, home_currency).await?)
    } else {
        None
    };
    let (mut tx, owner, revision) = scoped(pool, &customer.sub, id, true).await?;
    let previous: Option<(String, String)> = sqlx::query_as(
        "SELECT actor_subject,request_hash FROM group_budget_commands WHERE group_id=$1 AND id=$2",
    )
    .bind(id)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((actor, previous)) = previous {
        if actor != customer.sub || previous != hash {
            return Err(Error::BudgetChanged);
        }
        let data = document(&mut tx, &customer.sub, id, &owner).await?;
        tx.commit().await?;
        return Ok(Json(data));
    }
    if revision != input.expected_revision {
        return Err(Error::BudgetChanged);
    }
    let current = document(&mut tx, &customer.sub, id, &owner).await?;
    let is_owner = owner == customer.sub;
    match input.action {
        Action::Participant {
            id: pid,
            name,
            email,
            whatsapp,
        } => {
            if !text(&name, 100) || !email_valid(&email) || !phone_valid(&whatsapp) {
                return Err(Error::Invalid(
                    "Check the name, email and international WhatsApp number.".into(),
                ));
            }
            if !email.is_empty()
                && current
                    .participants
                    .iter()
                    .any(|p| Some(p.id) != pid && p.email.eq_ignore_ascii_case(email.trim()))
            {
                return Err(Error::Invalid(
                    "That email already belongs to a traveller in this group.".into(),
                ));
            }
            if let Some(pid) = pid {
                let p = participant(&current, pid)?;
                if !is_owner && !p.is_self {
                    return Err(Error::NotFound);
                }
                sqlx::query("UPDATE group_participants SET name=$3,email=$4,whatsapp=$5,invited_until=CASE WHEN email<>$4 THEN NULL ELSE invited_until END,updated_at=now() WHERE group_id=$1 AND id=$2").bind(id).bind(pid).bind(name.trim()).bind(email.trim()).bind(whatsapp).execute(&mut *tx).await?;
            } else {
                if !is_owner {
                    return Err(Error::NotFound);
                }
                if current.participants.len() >= 20 {
                    return Err(Error::Invalid(
                        "A group supports up to 20 travellers.".into(),
                    ));
                }
                sqlx::query("INSERT INTO group_participants(group_id,id,name,email,whatsapp) VALUES($1,$2,$3,$4,$5)").bind(id).bind(key).bind(name.trim()).bind(email.trim()).bind(whatsapp).execute(&mut *tx).await?;
            }
        }
        Action::Expense {
            id: eid,
            payer_id,
            description,
            currency: cur,
            amount_minor,
            occurred_on,
            method,
            shares,
            home_currency: _,
        } => {
            if !text(&description, 160) {
                return Err(Error::Invalid(
                    "Add a description up to 160 characters.".into(),
                ));
            }
            currency(&cur)?;
            let day = date(&occurred_on)?;
            participant(&current, payer_id)?;
            for share in &shares {
                participant(&current, share.participant_id)?;
            }
            let splits = ledger::allocate(amount_minor, &method, &shares)?;
            let converted = conversion.ok_or(Error::Unavailable("Currency conversion"))?;
            let eid = if let Some(eid) = eid {
                if !current.expenses.iter().any(|e| e.id == eid && e.can_edit) {
                    return Err(Error::NotFound);
                }
                eid
            } else {
                let count: i64 =
                    sqlx::query_scalar("SELECT count(*) FROM group_expenses WHERE group_id=$1")
                        .bind(id)
                        .fetch_one(&mut *tx)
                        .await?;
                if count >= 1000 {
                    return Err(Error::Invalid(
                        "This group has reached its 1,000-expense limit.".into(),
                    ));
                }
                key
            };
            sqlx::query("INSERT INTO group_expenses(group_id,id,payer_id,description,currency,amount_minor,occurred_on,request_key,request_hash,created_by,split_method,split_input,home_currency,home_minor,rate_as_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(group_id,id) DO UPDATE SET payer_id=$3,description=$4,currency=$5,amount_minor=$6,occurred_on=$7,request_key=$8,request_hash=$9,split_method=$11,split_input=$12,home_currency=$13,home_minor=$14,rate_as_of=$15,version=group_expenses.version+1,updated_at=now()")
    .bind(id).bind(eid).bind(payer_id).bind(description.trim()).bind(cur).bind(amount_minor).bind(day).bind(key).bind(&hash).bind(&customer.sub).bind(method).bind(json!(shares)).bind(converted.currency).bind(converted.minor).bind(converted.as_of).execute(&mut *tx).await?;
            sqlx::query("DELETE FROM group_expense_splits WHERE group_id=$1 AND expense_id=$2")
                .bind(id)
                .bind(eid)
                .execute(&mut *tx)
                .await?;
            let ids: Vec<_> = splits.iter().map(|s| s.participant_id).collect();
            let values: Vec<_> = splits.iter().map(|s| s.amount_minor).collect();
            sqlx::query("INSERT INTO group_expense_splits(group_id,expense_id,participant_id,amount_minor) SELECT $1,$2,* FROM unnest($3::uuid[],$4::bigint[])").bind(id).bind(eid).bind(ids).bind(values).execute(&mut *tx).await?;
        }
        Action::VoidExpense { id: eid } => {
            if !current.expenses.iter().any(|e| e.id == eid && e.can_edit) {
                return Err(Error::NotFound);
            }
            sqlx::query("UPDATE group_expenses SET voided_at=now(),updated_at=now(),version=version+1 WHERE group_id=$1 AND id=$2").bind(id).bind(eid).execute(&mut *tx).await?;
        }
        Action::Settlement {
            from_id,
            to_id,
            currency: cur,
            amount_minor,
            occurred_on,
        } => {
            let from = participant(&current, from_id)?;
            let to = participant(&current, to_id)?;
            if !is_owner && !from.is_self && !to.is_self {
                return Err(Error::NotFound);
            }
            currency(&cur)?;
            let day = date(&occurred_on)?;
            let owed = ledger::debts(
                &current.expenses,
                &current.settlements,
                time::OffsetDateTime::now_utc().date(),
            )
            .into_iter()
            .find(|d| d.from_id == from_id && d.to_id == to_id && d.currency == cur)
            .map_or(0, |d| d.amount_minor);
            if amount_minor <= 0 || amount_minor > owed {
                return Err(Error::Invalid(
                    "Repayment must be positive and no more than the current amount owed.".into(),
                ));
            }
            let count: i64 =
                sqlx::query_scalar("SELECT count(*) FROM group_settlements WHERE group_id=$1")
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await?;
            if count >= 1000 {
                return Err(Error::Invalid(
                    "This group has reached its repayment limit.".into(),
                ));
            }
            sqlx::query("INSERT INTO group_settlements(group_id,id,from_id,to_id,currency,amount_minor,occurred_on,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(id).bind(key).bind(from_id).bind(to_id).bind(cur).bind(amount_minor).bind(day).bind(&customer.sub).execute(&mut *tx).await?;
        }
        Action::VoidSettlement { id: sid } => {
            let s = current
                .settlements
                .iter()
                .find(|s| s.id == sid)
                .ok_or(Error::NotFound)?;
            if !is_owner
                && !participant(&current, s.from_id)?.is_self
                && !participant(&current, s.to_id)?.is_self
            {
                return Err(Error::NotFound);
            }
            sqlx::query("UPDATE group_settlements SET voided_at=now(),updated_at=now() WHERE group_id=$1 AND id=$2").bind(id).bind(sid).execute(&mut *tx).await?;
        }
        Action::Invite { participant_id } => {
            let p = participant(&current, participant_id)?;
            if !is_owner || p.has_account {
                return Err(Error::NotFound);
            }
            if p.email.is_empty() {
                return Err(Error::Invalid(
                    "Add their email before inviting them to Roamie.".into(),
                ));
            }
            sqlx::query("UPDATE group_participants SET invited_until=now()+interval '7 days',updated_at=now() WHERE group_id=$1 AND id=$2").bind(id).bind(participant_id).execute(&mut *tx).await?;
        }
        Action::EmailReminder {
            from_id,
            to_id,
            currency: cur,
        } => {
            if state.mail.is_none() {
                return Err(Error::Unavailable("Email reminders"));
            }
            crate::mail::enqueue(&mut tx, &current, &customer, key, from_id, to_id, &cur).await?;
        }
        Action::RevokeAccess { participant_id } => {
            let p = participant(&current, participant_id)?;
            if !is_owner || p.is_self || !p.has_account {
                return Err(Error::NotFound);
            }
            sqlx::query("UPDATE group_memberships SET active=false,updated_at=now() WHERE group_id=$1 AND subject=(SELECT subject FROM group_participants WHERE group_id=$1 AND id=$2)").bind(id).bind(participant_id).execute(&mut *tx).await?;
            sqlx::query("UPDATE group_participants SET subject=NULL,invited_until=NULL,updated_at=now() WHERE group_id=$1 AND id=$2").bind(id).bind(participant_id).execute(&mut *tx).await?;
        }
        Action::RevokeInvite { participant_id } => {
            if !is_owner {
                return Err(Error::NotFound);
            }
            participant(&current, participant_id)?;
            sqlx::query("UPDATE group_participants SET invited_until=NULL,updated_at=now() WHERE group_id=$1 AND id=$2").bind(id).bind(participant_id).execute(&mut *tx).await?;
        }
    }
    sqlx::query("INSERT INTO group_budget_commands(group_id,id,actor_subject,request_hash) VALUES($1,$2,$3,$4)").bind(id).bind(key).bind(&customer.sub).bind(hash).execute(&mut *tx).await?;
    sqlx::query("UPDATE trip_groups SET revision=revision+1,updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let data = document(&mut tx, &customer.sub, id, &owner).await?;
    tx.commit().await?;
    Ok(Json(data))
}

#[cfg(test)]
#[path = "group_budget_api_tests.rs"]
mod tests;
