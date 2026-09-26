use serde::{Deserialize, Serialize};
use serde_json::json;
use time::{macros::format_description, Date};

use crate::error::{Error, Result};
use crate::gemini::Gemini;
use crate::money::{to_minor, Currency};
use crate::receipts::CATEGORIES;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementRequest {
    pub data: String,
    pub mime_type: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
struct Line {
    date: String,
    merchant: String,
    amount: String,
    currency: String,
    kind: String,
    category: String,
}

#[derive(Debug, Deserialize)]
struct Read {
    transactions: Vec<Line>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub date: String,
    pub merchant: String,
    pub amount_minor: i64,
    pub currency: Currency,
    pub category: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub transactions: Vec<Transaction>,
    pub outside_trip: usize,
    pub unreadable: usize,
}

const SYSTEM: &str = "You read a credit or debit card statement for a traveller's expense tracker. \
List every transaction line: posting or transaction date as YYYY-MM-DD, the merchant or description, \
the amount exactly as printed without sign (digits and separators only), the ISO 4217 currency of that amount, \
its kind, and one category. Use kind fee for foreign transaction and bank fees, refund for credits back to the card, \
payment for repayments of the card balance. Never invent a line or an amount that is not printed.";

const MAX_DAYS: i64 = 90;

fn range(req: &StatementRequest) -> Result<(Date, Date)> {
    let fmt = format_description!("[year]-[month]-[day]");
    let bad = || Error::Invalid("Choose trip dates up to 90 days apart.".into());
    let from = Date::parse(&req.from, fmt).map_err(|_| bad())?;
    let to = Date::parse(&req.to, fmt).map_err(|_| bad())?;
    if to < from || (to - from).whole_days() >= MAX_DAYS {
        return Err(bad());
    }
    Ok((from, to))
}

/// Replaces card-number-length digit runs with the last four digits.
fn mask(text: &str) -> String {
    let mut out = String::new();
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        let digits: String = run.chars().filter(char::is_ascii_digit).collect();
        if (12..=19).contains(&digits.len()) {
            out.push_str("••••");
            out.push_str(&digits[digits.len() - 4..]);
            out.extend(
                run.chars()
                    .rev()
                    .take_while(|c| !c.is_ascii_digit())
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev(),
            );
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for c in text.chars() {
        if c.is_ascii_digit() || (!run.is_empty() && (c == ' ' || c == '-')) {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

pub async fn extract(ai: &Gemini, req: &StatementRequest) -> Result<Statement> {
    if !(req.mime_type.starts_with("image/") || req.mime_type == "application/pdf")
        || req.data.is_empty()
    {
        return Err(Error::Invalid(
            "send one PDF or image of your statement".into(),
        ));
    }
    let (from, to) = range(req)?;
    let schema = json!({
        "type": "OBJECT",
        "properties": { "transactions": { "type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "date": { "type": "STRING" },
                "merchant": { "type": "STRING" },
                "amount": { "type": "STRING" },
                "currency": { "type": "STRING" },
                "kind": { "type": "STRING", "enum": ["purchase", "fee", "refund", "payment"] },
                "category": { "type": "STRING", "enum": CATEGORIES }
            },
            "required": ["date", "merchant", "amount", "currency", "kind", "category"]
        } } },
        "required": ["transactions"]
    });
    let read: Read = ai
        .json(
            SYSTEM,
            vec![Gemini::inline(&req.mime_type, &req.data)],
            schema,
        )
        .await?;

    let fmt = format_description!("[year]-[month]-[day]");
    let mut statement = Statement {
        transactions: Vec::new(),
        outside_trip: 0,
        unreadable: 0,
    };
    for line in read.transactions {
        if line.kind == "payment" {
            continue;
        }
        let Ok(date) = Date::parse(line.date.trim(), fmt) else {
            statement.unreadable += 1;
            continue;
        };
        if date < from || date > to {
            statement.outside_trip += 1;
            continue;
        }
        let Some((currency, minor)) = Currency::parse(&line.currency)
            .and_then(|c| to_minor(&line.amount, &c).map(|m| (c, m)))
        else {
            statement.unreadable += 1;
            continue;
        };
        statement.transactions.push(Transaction {
            date: date.to_string(),
            merchant: mask(line.merchant.trim()).chars().take(120).collect(),
            amount_minor: if line.kind == "refund" { -minor } else { minor },
            currency,
            category: if line.kind == "fee" {
                "other"
            } else {
                CATEGORIES
                    .into_iter()
                    .find(|c| *c == line.category)
                    .unwrap_or("other")
            },
        });
    }
    Ok(statement)
}

#[cfg(test)]
mod tests {
    use super::mask;

    #[test]
    fn card_numbers_are_masked_but_references_survive() {
        for (input, want) in [
            ("VISA 4111 1111 1111 1111 SAPA", "VISA ••••1111 SAPA"),
            ("AMEX 3782-822463-10005", "AMEX ••••0005"),
            ("Ref 123456 order 42", "Ref 123456 order 42"),
            ("", ""),
        ] {
            assert_eq!(mask(input), want, "{input}");
        }
    }
}
