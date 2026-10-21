use super::*;
use sqlx::postgres::PgConnectOptions;
use std::str::FromStr;
fn customer(name: &str) -> Customer {
    Customer {
        sub: format!("group-test-{name}"),
        email: format!("{name}@example.invalid"),
        name: name.into(),
        email_verified: true,
        organization: "test".into(),
    }
}
async fn state() -> Arc<AppState> {
    let url = std::env::var("ROAMIE_TEST_DATABASE_URL").expect("isolated database");
    let db = crate::database::Database::connect(PgConnectOptions::from_str(&url).unwrap())
        .await
        .unwrap();
    db.migrate().await.unwrap();
    let mut state = crate::tests::state("http://unused", "http://unused", None);
    Arc::get_mut(&mut state).unwrap().database = Some(db);
    state
}
fn command_input(revision: i64, change: Value) -> Command {
    serde_json::from_value(
        json!({"requestId":Uuid::now_v7().to_string(),"expectedRevision":revision,"change":change}),
    )
    .unwrap()
}
async fn apply(state: &Arc<AppState>, who: &Customer, g: &Budget, change: Value) -> Budget {
    command(
        State(state.clone()),
        Extension(who.clone()),
        Path(g.id),
        Json(command_input(g.revision, change)),
    )
    .await
    .unwrap()
    .0
}
#[tokio::test]
#[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
async fn shared_ledger_lifecycle_permissions_replay_and_concurrent_edits() {
    let state = state().await;
    let who = customer(&Uuid::now_v7().to_string());
    let stranger = customer(&Uuid::now_v7().to_string());
    let value = json!({"requestId":Uuid::now_v7().to_string(),"title":"Australia friends","currency":"AUD","displayName":"Alice"});
    let mut group = create(
        State(state.clone()),
        Extension(who.clone()),
        Json(serde_json::from_value(value.clone()).unwrap()),
    )
    .await
    .unwrap()
    .0;
    let replay = create(
        State(state.clone()),
        Extension(who.clone()),
        Json(serde_json::from_value(value).unwrap()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(group.id, replay.id);
    assert!(matches!(
        load(pool(&state).unwrap(), &stranger.sub, group.id).await,
        Err(Error::NotFound)
    ));
    let a = group.participants[0].id;
    group=apply(&state,&who,&group,json!({"action":"participant","id":null,"name":"Bob","email":stranger.email,"whatsapp":"+61412345678"})).await;
    let b = group
        .participants
        .iter()
        .find(|p| p.name == "Bob")
        .unwrap()
        .id;
    let input = command_input(
        group.revision,
        json!({"action":"expense","id":null,"payerId":a,"description":"Dinner","currency":"AUD","amountMinor":10001,"occurredOn":"2026-09-01","method":"equal","shares":[{"participantId":a,"value":1},{"participantId":b,"value":1}],"homeCurrency":"AUD"}),
    );
    let serialized = serde_json::to_value(&input).unwrap();
    group = command(
        State(state.clone()),
        Extension(who.clone()),
        Path(group.id),
        Json(input),
    )
    .await
    .unwrap()
    .0;
    let original = group.expenses[0].id;
    assert_eq!(
        group.expenses[0]
            .splits
            .iter()
            .map(|x| x.amount_minor)
            .sum::<i64>(),
        10001
    );
    let again = command(
        State(state.clone()),
        Extension(who.clone()),
        Path(group.id),
        Json(serde_json::from_value(serialized).unwrap()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(again.expenses.len(), 1);
    assert_eq!(again.revision, group.revision);
    let balance = ledger::debts(&group.expenses, &[], time::OffsetDateTime::now_utc().date());
    let owed = balance[0].amount_minor;
    assert_eq!(balance[0].from_id, b);
    assert!(balance[0].overdue);
    let bad = command_input(
        group.revision,
        json!({"action":"settlement","fromId":b,"toId":a,"currency":"AUD","amountMinor":owed+1,"occurredOn":"2026-10-01"}),
    );
    assert!(matches!(
        command(
            State(state.clone()),
            Extension(who.clone()),
            Path(group.id),
            Json(bad)
        )
        .await,
        Err(Error::Invalid(_))
    ));
    group=apply(&state,&who,&group,json!({"action":"settlement","fromId":b,"toId":a,"currency":"AUD","amountMinor":100,"occurredOn":"2026-10-01"})).await;
    assert_eq!(
        ledger::debts(
            &group.expenses,
            &group.settlements,
            time::OffsetDateTime::now_utc().date()
        )[0]
        .amount_minor,
        owed - 100
    );
    group = apply(
        &state,
        &who,
        &group,
        json!({"action":"invite","participantId":b}),
    )
    .await;
    let joined = join(
        State(state.clone()),
        Extension(stranger.clone()),
        Path(group.id),
    )
    .await
    .unwrap()
    .0;
    assert!(
        joined
            .participants
            .iter()
            .find(|p| p.id == b)
            .unwrap()
            .is_self
    );
    assert!(!joined.is_owner);
    let wrong = customer("different-person");
    assert!(matches!(
        join(State(state.clone()), Extension(wrong), Path(group.id)).await,
        Err(Error::NotFound)
    ));
    let bad = command_input(
        joined.revision,
        json!({"action":"voidExpense","id":original}),
    );
    assert!(matches!(
        command(
            State(state.clone()),
            Extension(stranger.clone()),
            Path(group.id),
            Json(bad)
        )
        .await,
        Err(Error::NotFound)
    ));
    group = load(pool(&state).unwrap(), &who.sub, group.id)
        .await
        .unwrap();
    let one = command_input(
        group.revision,
        json!({"action":"participant","id":null,"name":"Carol","email":"","whatsapp":""}),
    );
    let two = command_input(
        group.revision,
        json!({"action":"participant","id":null,"name":"Dan","email":"","whatsapp":""}),
    );
    let (x, y) = tokio::join!(
        command(
            State(state.clone()),
            Extension(who.clone()),
            Path(group.id),
            Json(one)
        ),
        command(
            State(state.clone()),
            Extension(who.clone()),
            Path(group.id),
            Json(two)
        )
    );
    assert!(x.is_ok() ^ y.is_ok());
    assert!(matches!(x, Err(Error::BudgetChanged)) || matches!(y, Err(Error::BudgetChanged)));
    let final_group = load(pool(&state).unwrap(), &who.sub, group.id)
        .await
        .unwrap();
    assert_eq!(final_group.participants.len(), 3);
    let revoked = apply(
        &state,
        &who,
        &final_group,
        json!({"action":"revokeAccess","participantId":b}),
    )
    .await;
    assert_eq!(revoked.expenses.len(), 1);
    assert_eq!(revoked.settlements.len(), 1);
    assert!(matches!(
        load(pool(&state).unwrap(), &stranger.sub, group.id).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        join(State(state.clone()), Extension(stranger), Path(group.id)).await,
        Err(Error::NotFound)
    ));
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE group_id=$1 AND actor_subject=$2",
    )
    .bind(group.id)
    .bind(&who.sub)
    .fetch_one(pool(&state).unwrap())
    .await
    .unwrap();
    assert!(events > 0);
}
#[test]
fn contact_and_command_boundaries_reject_injection_and_unknown_fields() {
    assert!(!email_valid("a@example.com\r\nBcc:b@example.com"));
    assert!(!phone_valid("javascript:alert(1)"));
    assert!(phone_valid("+919876543210"));
    assert!(serde_json::from_value::<Command>(json!({"requestId":"x","expectedRevision":1,"actor":"owner","change":{"action":"voidExpense","id":Uuid::now_v7()}})).is_err());
}

#[tokio::test]
#[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
async fn home_conversion_is_server_quoted_and_replay_survives_fx_failure() {
    use axum::routing::get;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let service=axum::Router::new().route("/latest/INR",get(||async{Json(json!({"result":"success","time_last_update_utc":"Wed, 21 Oct 2026 00:00:00 +0000","rates":{"INR":1,"AUD":0.018}}))}));
    let task = tokio::spawn(async move { axum::serve(listener, service).await.unwrap() });
    let mut state = state().await;
    Arc::get_mut(&mut state).unwrap().fx = crate::fx::Fx::new(format!("http://{address}"));
    let who = customer(&Uuid::now_v7().to_string());
    let mut group=create(State(state.clone()),Extension(who.clone()),Json(serde_json::from_value(json!({"requestId":Uuid::now_v7().to_string(),"title":"India to Australia","currency":"AUD","displayName":"Traveller"})).unwrap())).await.unwrap().0;
    let input = command_input(
        group.revision,
        json!({"action":"expense","id":null,"payerId":group.participants[0].id,"description":"Train","currency":"AUD","amountMinor":10000,"occurredOn":"2026-10-01","method":"equal","shares":[{"participantId":group.participants[0].id,"value":1}],"homeCurrency":"INR"}),
    );
    let replay = serde_json::to_value(&input).unwrap();
    group = command(
        State(state.clone()),
        Extension(who.clone()),
        Path(group.id),
        Json(input),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(group.expenses[0].home_minor, 555556);
    assert_eq!(group.expenses[0].amount_minor, 10000);
    assert_eq!(group.expenses[0].home_currency, "INR");
    assert!(group.expenses[0].rate_as_of.contains("21 Oct 2026"));
    Arc::get_mut(&mut state).unwrap().fx = crate::fx::Fx::new("http://127.0.0.1:1");
    let again = command(
        State(state.clone()),
        Extension(who.clone()),
        Path(group.id),
        Json(serde_json::from_value(replay).unwrap()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(again.expenses.len(), 1);
    let invalid = command_input(
        again.revision,
        json!({"action":"expense","id":null,"payerId":again.participants[0].id,"description":"Invalid","currency":"ZZZ","amountMinor":100,"occurredOn":"2026-10-01","method":"equal","shares":[{"participantId":again.participants[0].id,"value":1}],"homeCurrency":"INR"}),
    );
    assert!(matches!(
        command(
            State(state.clone()),
            Extension(who),
            Path(group.id),
            Json(invalid)
        )
        .await,
        Err(Error::Invalid(_))
    ));
    task.abort();
}
