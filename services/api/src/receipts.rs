use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{Error, Result};
use crate::gemini::Gemini;
use crate::money::{to_minor, Currency};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRequest {
    pub data: String,
    pub mime_type: String,
    pub local_currency: Option<Currency>,
}

#[derive(Debug, Deserialize)]
struct Read {
    merchant: String,
    total: String,
    currency: String,
    date: String,
    category: String,
    confidence: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub merchant: String,
    pub amount_minor: Option<i64>,
    pub currency: Option<Currency>,
    pub date: Option<String>,
    pub category: &'static str,
    pub confidence: f32,
}

pub const CATEGORIES: [&str; 6] = [
    "food",
    "stay",
    "transport",
    "activities",
    "shopping",
    "other",
];

const SYSTEM: &str = "You read a photographed receipt for a traveller's expense tracker. \
Return the merchant name, the grand total exactly as printed (after tax and tip, digits and separators only), \
the ISO 4217 currency, the date as YYYY-MM-DD (empty if absent), one category, and your confidence from 0 to 1. \
Never guess a total that is not printed; return an empty total instead.";

pub async fn extract(ai: &Gemini, req: &ReceiptRequest) -> Result<Receipt> {
    if !req.mime_type.starts_with("image/") || req.data.is_empty() {
        return Err(Error::Invalid("send one image".into()));
    }
    let hint = req.local_currency.as_ref().map(|c| {
        format!(
            "The traveller is in a country using {}.",
            String::from(c.clone())
        )
    });
    let schema = json!({
        "type": "OBJECT",
        "properties": {
            "merchant": { "type": "STRING" },
            "total": { "type": "STRING" },
            "currency": { "type": "STRING" },
            "date": { "type": "STRING" },
            "category": { "type": "STRING", "enum": CATEGORIES },
            "confidence": { "type": "NUMBER" }
        },
        "required": ["merchant", "total", "currency", "date", "category", "confidence"]
    });
    let mut parts = vec![Gemini::inline(&req.mime_type, &req.data)];
    parts.extend(hint.map(Gemini::text));
    let read: Read = ai.json(SYSTEM, parts, schema).await?;

    let currency = Currency::parse(&read.currency).or_else(|| req.local_currency.clone());
    Ok(Receipt {
        amount_minor: currency.as_ref().and_then(|c| to_minor(&read.total, c)),
        currency,
        merchant: read.merchant.trim().to_string(),
        date: Some(read.date).filter(|d| d.len() == 10),
        category: CATEGORIES
            .into_iter()
            .find(|c| *c == read.category)
            .unwrap_or("other"),
        confidence: read.confidence.clamp(0.0, 1.0),
    })
}
