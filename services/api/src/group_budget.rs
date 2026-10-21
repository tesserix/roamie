use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "ShareInput")]
pub struct Share {
    #[ts(type = "string")]
    pub participant_id: Uuid,
    #[ts(type = "number")]
    pub value: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    #[ts(type = "string")]
    pub participant_id: Uuid,
    #[ts(type = "number")]
    pub amount_minor: i64,
}
pub fn allocate(amount: i64, method: &str, shares: &[Share]) -> Result<Vec<Split>> {
    let invalid = || Error::Invalid("Check the expense total and selected travellers.".into());
    if !(1..=1_000_000_000).contains(&amount) || shares.is_empty() || shares.len() > 20 {
        return Err(invalid());
    }
    let mut sorted = shares.to_vec();
    sorted.sort_by_key(|x| x.participant_id);
    if sorted
        .windows(2)
        .any(|w| w[0].participant_id == w[1].participant_id)
        || sorted
            .iter()
            .any(|x| !(0..=1_000_000_000).contains(&x.value))
    {
        return Err(invalid());
    }
    let total: i64 = sorted.iter().map(|x| x.value).sum();
    if method == "exact" {
        if total != amount {
            return Err(Error::Invalid(
                "Exact amounts must equal the expense total.".into(),
            ));
        }
        return Ok(sorted
            .iter()
            .map(|x| Split {
                participant_id: x.participant_id,
                amount_minor: x.value,
            })
            .collect());
    }
    if method != "equal" && method != "percentage" {
        return Err(invalid());
    }
    if method == "percentage" && total != 10000 {
        return Err(Error::Invalid("Percentages must total 100%.".into()));
    }
    let denominator = if method == "equal" {
        sorted.len() as i64
    } else {
        total
    };
    let mut parts: Vec<_> = sorted
        .iter()
        .map(|s| {
            let weight = if method == "equal" { 1 } else { s.value };
            (
                Split {
                    participant_id: s.participant_id,
                    amount_minor: amount * weight / denominator,
                },
                amount * weight % denominator,
            )
        })
        .collect();
    let left = amount - parts.iter().map(|(s, _)| s.amount_minor).sum::<i64>();
    let mut order: Vec<_> = (0..parts.len()).collect();
    order.sort_by_key(|&i| (std::cmp::Reverse(parts[i].1), parts[i].0.participant_id));
    for i in order.into_iter().take(left as usize) {
        parts[i].0.amount_minor += 1;
    }
    Ok(parts.into_iter().map(|(s, _)| s).collect())
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    #[ts(type = "string")]
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub whatsapp: String,
    pub is_self: bool,
    pub has_account: bool,
    pub invited_until: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "GroupExpense")]
pub struct Expense {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub payer_id: Uuid,
    pub description: String,
    pub currency: String,
    #[ts(type = "number")]
    pub amount_minor: i64,
    pub occurred_on: String,
    #[ts(type = "'equal' | 'percentage' | 'exact'")]
    pub method: String,
    pub shares: Vec<Share>,
    pub splits: Vec<Split>,
    pub home_currency: String,
    #[ts(type = "number")]
    pub home_minor: i64,
    pub rate_as_of: String,
    pub can_edit: bool,
}
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub from_id: Uuid,
    #[ts(type = "string")]
    pub to_id: Uuid,
    pub currency: String,
    #[ts(type = "number")]
    pub amount_minor: i64,
    pub occurred_on: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "Group")]
pub struct Budget {
    #[ts(type = "string")]
    pub id: Uuid,
    pub title: String,
    pub currency: String,
    #[ts(type = "number")]
    pub revision: i64,
    pub is_owner: bool,
    pub participants: Vec<Participant>,
    pub expenses: Vec<Expense>,
    pub settlements: Vec<Settlement>,
    #[serde(default)]
    pub emails: Vec<EmailNotice>,
}
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct EmailNotice {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub from_id: Uuid,
    #[ts(type = "string")]
    pub to_id: Uuid,
    pub currency: String,
    #[ts(type = "number")]
    pub amount_minor: i64,
    #[ts(type = "'queued' | 'accepted' | 'failed' | 'cancelled'")]
    pub status: String,
    pub requested_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Debt {
    #[ts(type = "string")]
    pub from_id: Uuid,
    #[ts(type = "string")]
    pub to_id: Uuid,
    pub currency: String,
    #[ts(type = "number")]
    pub amount_minor: i64,
    pub oldest_on: String,
    pub overdue: bool,
}
pub fn debts(expenses: &[Expense], settlements: &[Settlement], today: time::Date) -> Vec<Debt> {
    use std::collections::BTreeMap;
    type Item = (i64, String, Uuid);
    let mut pairs: BTreeMap<(Uuid, Uuid, String), Vec<Item>> = BTreeMap::new();
    for e in expenses {
        for s in &e.splits {
            if s.participant_id == e.payer_id || s.amount_minor == 0 {
                continue;
            }
            let (a, b, sign) = if s.participant_id < e.payer_id {
                (s.participant_id, e.payer_id, 1)
            } else {
                (e.payer_id, s.participant_id, -1)
            };
            pairs.entry((a, b, e.currency.clone())).or_default().push((
                s.amount_minor * sign,
                e.occurred_on.clone(),
                e.id,
            ));
        }
    }
    for s in settlements {
        let (a, b, sign) = if s.from_id < s.to_id {
            (s.from_id, s.to_id, -1)
        } else {
            (s.to_id, s.from_id, 1)
        };
        pairs.entry((a, b, s.currency.clone())).or_default().push((
            s.amount_minor * sign,
            s.occurred_on.clone(),
            s.id,
        ));
    }
    pairs
        .into_iter()
        .filter_map(|((a, b, currency), mut items)| {
            let net: i64 = items.iter().map(|x| x.0).sum();
            if net == 0 {
                return None;
            }
            let sign = net.signum();
            let mut offset: i64 = items
                .iter()
                .filter(|x| x.0.signum() != sign)
                .map(|x| x.0.abs())
                .sum();
            items.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)));
            let oldest = items.iter().filter(|x| x.0.signum() == sign).find(|x| {
                if offset >= x.0.abs() {
                    offset -= x.0.abs();
                    false
                } else {
                    true
                }
            })?;
            let parsed = time::Date::parse(
                &oldest.1,
                time::macros::format_description!("[year]-[month]-[day]"),
            )
            .ok()?;
            Some(Debt {
                from_id: if sign > 0 { a } else { b },
                to_id: if sign > 0 { b } else { a },
                currency,
                amount_minor: net.abs(),
                oldest_on: oldest.1.clone(),
                overdue: (today - parsed).whole_days() >= 30,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn allocate_equal_percentages_and_exact_without_losing_cents() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let c = Uuid::from_u128(3);
        let shares = vec![
            Share {
                participant_id: c,
                value: 1,
            },
            Share {
                participant_id: a,
                value: 1,
            },
            Share {
                participant_id: b,
                value: 1,
            },
        ];
        assert_eq!(
            allocate(100, "equal", &shares)
                .unwrap()
                .iter()
                .map(|x| x.amount_minor)
                .collect::<Vec<_>>(),
            [34, 33, 33]
        );
        let shares = vec![
            Share {
                participant_id: a,
                value: 5000,
            },
            Share {
                participant_id: b,
                value: 5000,
            },
        ];
        assert_eq!(
            allocate(101, "percentage", &shares)
                .unwrap()
                .iter()
                .map(|x| x.amount_minor)
                .collect::<Vec<_>>(),
            [51, 50]
        );
        assert!(allocate(100, "exact", &shares).is_err());
        assert!(allocate(
            100,
            "equal",
            &[
                Share {
                    participant_id: a,
                    value: 1
                },
                Share {
                    participant_id: a,
                    value: 1
                }
            ]
        )
        .is_err());
    }
}

#[cfg(test)]
mod balance_tests {
    use super::*;
    fn expense(
        id: u128,
        payer: u128,
        person: u128,
        amount: i64,
        date: &str,
        currency: &str,
    ) -> Expense {
        Expense {
            id: Uuid::from_u128(id),
            payer_id: Uuid::from_u128(payer),
            description: "Test".into(),
            currency: currency.into(),
            amount_minor: amount,
            occurred_on: date.into(),
            method: "exact".into(),
            shares: vec![],
            splits: vec![Split {
                participant_id: Uuid::from_u128(person),
                amount_minor: amount,
            }],
            home_currency: currency.into(),
            home_minor: amount,
            rate_as_of: String::new(),
            can_edit: true,
        }
    }
    #[test]
    fn partial_repayments_consume_oldest_shares_and_keep_currencies_separate() {
        let items = vec![
            expense(1, 1, 2, 100, "2026-09-01", "AUD"),
            expense(2, 1, 2, 200, "2026-10-15", "AUD"),
            expense(3, 1, 2, 500, "2026-09-01", "INR"),
        ];
        let settlement = Settlement {
            id: Uuid::from_u128(9),
            from_id: Uuid::from_u128(2),
            to_id: Uuid::from_u128(1),
            currency: "AUD".into(),
            amount_minor: 100,
            occurred_on: "2026-10-01".into(),
        };
        let result = debts(&items, &[settlement], time::macros::date!(2026 - 10 - 21));
        assert_eq!(result.len(), 2);
        let aud = result.iter().find(|x| x.currency == "AUD").unwrap();
        assert_eq!(aud.amount_minor, 200);
        assert_eq!(aud.oldest_on, "2026-10-15");
        assert!(!aud.overdue);
        assert!(result.iter().find(|x| x.currency == "INR").unwrap().overdue);
    }
    #[test]
    fn correcting_an_expense_after_payment_keeps_the_overpaid_credit() {
        let settlement = Settlement {
            id: Uuid::from_u128(9),
            from_id: Uuid::from_u128(2),
            to_id: Uuid::from_u128(1),
            currency: "AUD".into(),
            amount_minor: 100,
            occurred_on: "2026-09-01".into(),
        };
        let result = debts(
            &[expense(1, 1, 2, 40, "2026-09-01", "AUD")],
            &[settlement],
            time::macros::date!(2026 - 10 - 21),
        );
        assert_eq!(result[0].from_id, Uuid::from_u128(1));
        assert_eq!(result[0].to_id, Uuid::from_u128(2));
        assert_eq!(result[0].amount_minor, 60);
        assert!(result[0].overdue);
    }
}

#[cfg(test)]
mod mobile_contract {
    use super::*;
    use crate::group_budget_api::{Action, Command, Create};
    use ts_rs::TS;

    pub fn source() -> String {
        let declarations = [
            Share::decl(),
            Split::decl(),
            Participant::decl(),
            Expense::decl(),
            Settlement::decl(),
            Budget::decl(),
            EmailNotice::decl(),
            Debt::decl(),
            Action::decl(),
            Command::decl(),
            Create::decl(),
        ];
        let mut source = format!(
            "// Generated from Rust group budget models; do not edit manually.\n{}\n",
            declarations.map(|s| format!("export {s}")).join("\n")
        );
        for name in [
            "ShareInput",
            "Split",
            "Participant",
            "GroupExpense",
            "Settlement",
            "EmailNotice",
        ] {
            source = source.replace(&format!("Array<{name}>"), &format!("{name}[]"));
        }
        source
    }

    #[test]
    fn mobile_group_contract_matches_backend() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/mobile/src/lib/group-budget-contract.ts"
        );
        let expected = source();
        if std::env::var_os("ROAMIE_EXPORT_GROUP_CONTRACT").is_some() {
            std::fs::write(path, &expected).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(path).expect("generated mobile group contract"),
            expected
        );
    }
}
