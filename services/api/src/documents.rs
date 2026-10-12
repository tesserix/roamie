use base64::Engine;
use serde::Serialize;
use serde_json::json;

use crate::decisions::{Decision, Jev};
use crate::error::{Error, Result};
use crate::ocr::{DocResult, Ocr};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub ocr_job_id: String,
    pub status: String,
    pub review_required: bool,
    pub decision_model: String,
}

pub struct Checked {
    pub text: String,
    pub source: Source,
}

pub fn printed_amount(text: &str, amount: &str) -> bool {
    if amount.is_empty() {
        return false;
    }
    let numeric = |c: char| c.is_ascii_digit() || c == '.' || c == ',';
    text.match_indices(amount).any(|(start, matched)| {
        !text[..start].chars().next_back().is_some_and(numeric)
            && !text[start + matched.len()..]
                .chars()
                .next()
                .is_some_and(numeric)
    })
}

pub fn decode(data: &str, mime: &str, pdf: bool) -> Result<Vec<u8>> {
    if !["image/jpeg", "image/png", "image/webp"].contains(&mime)
        && !(pdf && mime == "application/pdf")
    {
        return Err(Error::Invalid(
            "Choose a JPEG, PNG, WebP photo or a supported PDF.".into(),
        ));
    }
    if data.len() > 12 * 1024 * 1024 {
        return Err(Error::Invalid("This document is too large.".into()));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| Error::Invalid("The document is not valid base64.".into()))?;
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Err(Error::Invalid("Choose a document up to 8 MiB.".into()));
    }
    Ok(bytes)
}

fn text(document: DocResult) -> Result<String> {
    if document.pages.is_empty() || document.pages.len() > 20 {
        return Err(Error::Invalid(
            "Choose a document with one to twenty pages.".into(),
        ));
    }
    let mut text = String::new();
    for page in document.pages {
        let level = if page.observations.iter().any(|o| o.level == "line") {
            "line"
        } else {
            "paragraph"
        };
        let mut observations: Vec<_> = page
            .observations
            .into_iter()
            .filter(|o| o.level == level)
            .collect();
        observations.sort_by_key(|o| o.reading_order);
        for observation in observations {
            let line = observation.text.trim();
            if !line.is_empty() {
                text.push_str(line);
                text.push('\n');
            }
            if text.len() > 10000 {
                return Err(Error::Invalid(
                    "This document has too much text. Choose fewer pages.".into(),
                ));
            }
        }
    }
    if text.trim().is_empty() {
        return Err(Error::Unreadable);
    }
    Ok(text)
}

pub async fn read(
    ocr: &Ocr,
    jev: &Jev,
    data: &str,
    mime: &str,
    purpose: &str,
    pdf: bool,
) -> Result<Checked> {
    let extraction = ocr.read(decode(data, mime, pdf)?, mime).await?;
    let source_review = extraction.review_required();
    let minimum_confidence = extraction.minimum_confidence();
    let text = redact(&text(extraction.document)?);
    let review = jev
        .review(json!({"text":text,"status":extraction.status,"purpose":purpose,"minimum_confidence":minimum_confidence,"review_required":source_review}))
        .await?;
    let choice = review.answers.readability.choice;
    if choice == Decision::Retake {
        return Err(Error::Unreadable);
    }
    Ok(Checked {
        text,
        source: Source {
            ocr_job_id: extraction.job_id,
            status: extraction.status,
            review_required: source_review || choice == Decision::Review,
            decision_model: review.model,
        },
    })
}

/// Replaces card-number-length digit runs with the last four digits.
pub fn redact(text: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_part_of_a_printed_number_is_not_evidence_for_an_amount() {
        assert!(!printed_amount("TOTAL 99.00 AUD", "9.00"));
        assert!(!printed_amount("TOTAL 12.500 AUD", "12.50"));
        assert!(printed_amount("TOTAL AUD 12.50", "12.50"));
        assert!(printed_amount("TOTAL 1,234.56 AUD", "1,234.56"));
        assert!(!printed_amount("TOTAL 12.50 AUD", ""));
    }
}
