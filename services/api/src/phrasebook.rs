use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::Semaphore;

use crate::error::Result;
use crate::lang::Lang;
use crate::translate::TextResponse;

/// Bump when any translation prompt changes; older answers stay stored but are no longer served.
pub const PROMPT_VERSION: i16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Talk,
    Text,
    Sign,
}

impl Surface {
    fn as_str(self) -> &'static str {
        match self {
            Self::Talk => "talk",
            Self::Text => "text",
            Self::Sign => "sign",
        }
    }
}

const RECALL_BUDGET: Duration = Duration::from_millis(150);
const WRITES_IN_FLIGHT: usize = 2;
/// A variant answers other travellers only once it is this common, never a one-off sentence.
const SHARED_AFTER_USES: i64 = 3;

/// Every translation Roamie gives, kept without the traveller who asked (ADR-0016).
pub struct Phrasebook {
    pool: PgPool,
    model: String,
    writes: Arc<Semaphore>,
}

impl Phrasebook {
    pub fn new(pool: PgPool, model: &str) -> Self {
        Self {
            pool,
            model: model.into(),
            writes: Arc::new(Semaphore::new(WRITES_IN_FLIGHT)),
        }
    }

    /// The settled answer for exactly this text, or `None` when the database is slow or down.
    pub async fn recall(&self, from: &Lang, to: &Lang, text: &str) -> Option<TextResponse> {
        match tokio::time::timeout(RECALL_BUDGET, lookup(&self.pool, from, to, text)).await {
            Ok(Ok(found)) => found,
            Ok(Err(error)) => {
                tracing::warn!(%error, "phrasebook lookup failed");
                None
            }
            Err(_) => None,
        }
    }

    pub fn remember(&self, entries: Vec<Entry>) {
        if entries.is_empty() {
            return;
        }
        let Ok(permit) = self.writes.clone().try_acquire_owned() else {
            tracing::warn!("phrasebook busy, entries dropped");
            return;
        };
        let (pool, model) = (self.pool.clone(), self.model.clone());
        // Detached on purpose: a translation never waits for, or fails with, the phrasebook.
        tokio::spawn(async move {
            for entry in &entries {
                if let Err(error) = save(&pool, &model, entry).await {
                    tracing::warn!(%error, "phrasebook entry dropped");
                    break;
                }
            }
            drop(permit);
        });
    }
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub surface: Surface,
    pub from: Lang,
    pub to: Lang,
    pub source: String,
    pub translation: String,
    pub romanized: String,
    pub source_romanized: String,
    pub alternatives: Vec<String>,
    pub confidence: Option<f32>,
    pub review_required: bool,
}

/// Same words, same entry: spacing never splits a phrase.
pub fn normalise(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Card, phone and account numbers or email addresses are never kept.
fn sensitive(text: &str) -> bool {
    let email = text.split_whitespace().any(|word| {
        word.split_once('@')
            .is_some_and(|(user, host)| !user.is_empty() && host.contains('.'))
    });
    let (mut run, mut longest) = (0, 0);
    for c in text.chars() {
        if c.is_numeric() {
            run += 1;
            longest = longest.max(run);
        } else if run == 0 || !matches!(c, ' ' | '-' | '.' | '/' | '(' | ')' | '+') {
            run = 0;
        }
    }
    email || longest >= 9
}

/// Returns whether the entry was kept.
async fn save(pool: &PgPool, model: &str, entry: &Entry) -> Result<bool> {
    let source = normalise(&entry.source);
    let translation = entry.translation.trim();
    let fits = source.chars().count() <= crate::translate::MAX_TEXT_CHARS
        && [translation, &entry.romanized, &entry.source_romanized]
            .iter()
            .all(|text| text.chars().count() <= 2 * crate::translate::MAX_TEXT_CHARS);
    if source.is_empty()
        || translation.is_empty()
        || entry.from == entry.to
        || !fits
        || [translation, &entry.romanized, &entry.source_romanized]
            .into_iter()
            .chain(entry.alternatives.iter().map(String::as_str))
            .chain([source.as_str()])
            .any(sensitive)
    {
        return Ok(false);
    }
    sqlx::query("INSERT INTO phrasebook(surface,source_lang,target_lang,prompt_version,model,source_digest,translation_digest,source_text,translation,romanized,source_romanized,alternatives,confidence,review_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(source_digest,source_lang,target_lang,surface,prompt_version,model,translation_digest) DO UPDATE SET uses=phrasebook.uses+1,last_seen=now(),confidence=EXCLUDED.confidence,review_required=phrasebook.review_required OR EXCLUDED.review_required")
        .bind(entry.surface.as_str())
        .bind(entry.from.as_str())
        .bind(entry.to.as_str())
        .bind(PROMPT_VERSION)
        .bind(model)
        .bind(digest(&source))
        .bind(digest(translation))
        .bind(&source)
        .bind(translation)
        .bind(entry.romanized.trim())
        .bind(entry.source_romanized.trim())
        .bind(entry.alternatives.iter().take(2).collect::<Vec<_>>())
        .bind(entry.confidence.map(|c| c.clamp(0.0, 1.0)))
        .bind(entry.review_required)
        .execute(pool)
        .await?;
    Ok(true)
}

async fn lookup(pool: &PgPool, from: &Lang, to: &Lang, text: &str) -> Result<Option<TextResponse>> {
    let row: Option<(String, String, String, Vec<String>)> = sqlx::query_as("SELECT translation,romanized,source_romanized,alternatives FROM phrasebook WHERE source_digest=$1 AND source_lang=$2 AND target_lang=$3 AND surface='text' AND prompt_version=$4 AND NOT review_required AND uses>=$5 ORDER BY uses DESC,last_seen DESC LIMIT 1")
        .bind(digest(&normalise(text)))
        .bind(from.as_str())
        .bind(to.as_str())
        .bind(PROMPT_VERSION)
        .bind(SHARED_AFTER_USES)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(
        |(translation, romanized, source_romanized, alternatives)| TextResponse {
            detected: from.clone(),
            translation,
            romanized,
            source_romanized,
            alternatives,
        },
    ))
}

fn digest(text: &str) -> Vec<u8> {
    Sha256::digest(text.as_bytes()).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spacing_never_splits_a_phrase() {
        let cases = [
            ("  Where is   the toilet? ", "Where is the toilet?"),
            ("ห้องน้ำ\u{a0}อยู่ไหน\n", "ห้องน้ำ อยู่ไหน"),
            ("Where is the toilet?", "Where is the toilet?"),
            ("   ", ""),
        ];
        for (text, want) in cases {
            assert_eq!(normalise(text), want, "case {text:?}");
        }
    }

    #[test]
    fn numbers_and_addresses_that_identify_someone_are_sensitive() {
        let cases = [
            ("My card is 4111 1111 1111 1111", true),
            ("Call me on 0412-345-678", true),
            ("मेरा नंबर ९८७६५४३२१० है", true),
            ("Booking 123456789", true),
            ("Call +61 (412) 345.678", true),
            ("Ring 04.12.34.56.78", true),
            ("Bus 12/13 at gate 4", false),
            ("Email me at traveller@example.com", true),
            ("That is 1.500.000 dong", false),
            ("Room 402, two nights", false),
            ("It costs 150000 dong", false),
            ("Meet at 10:30 on 2026-10-21", false),
            ("Where is the toilet?", false),
        ];
        for (text, want) in cases {
            assert_eq!(sensitive(text), want, "case {text:?}");
        }
    }

    fn lang(code: &str) -> Lang {
        Lang::parse(code).unwrap()
    }

    fn entry(surface: Surface, source: &str, translation: &str) -> Entry {
        Entry {
            surface,
            from: lang("en"),
            to: lang("th"),
            source: source.into(),
            translation: translation.into(),
            romanized: "hong nam yu thi nai".into(),
            source_romanized: String::new(),
            alternatives: vec!["ห้องน้ำอยู่ตรงไหน".into()],
            confidence: Some(0.9),
            review_required: false,
        }
    }

    async fn owner() -> PgPool {
        let pool = PgPool::connect(&std::env::var("ROAMIE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn phrase() -> String {
        let unique: String = uuid::Uuid::now_v7()
            .simple()
            .to_string()
            .chars()
            .map(|c| c.to_digit(10).map_or(c, |d| char::from(b'g' + d as u8)))
            .collect();
        format!("Where is the toilet {unique}?")
    }

    async fn settle(pool: &PgPool, entry: &Entry) {
        for _ in 0..SHARED_AFTER_USES {
            save(pool, "m", entry).await.unwrap();
        }
    }

    async fn served(pool: &PgPool, source: &str) -> Option<String> {
        lookup(pool, &lang("en"), &lang("th"), source)
            .await
            .unwrap()
            .map(|answer| answer.translation)
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn repeats_are_counted_and_the_most_used_answer_is_served() {
        let pool = owner().await;
        let source = phrase();
        assert_eq!(served(&pool, &source).await, None);
        settle(&pool, &entry(Surface::Text, &source, "A")).await;
        let answer = lookup(&pool, &lang("en"), &lang("th"), &source)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(answer.detected, lang("en"));
        assert_eq!(answer.translation, "A");
        assert_eq!(answer.romanized, "hong nam yu thi nai");
        assert_eq!(answer.alternatives, ["ห้องน้ำอยู่ตรงไหน"]);
        settle(&pool, &entry(Surface::Text, &source, "B")).await;
        save(
            &pool,
            "m",
            &entry(Surface::Text, &format!("  {source} "), "B"),
        )
        .await
        .unwrap();
        assert_eq!(
            served(&pool, &format!("{source}  ")).await.as_deref(),
            Some("B")
        );
        let variants: Vec<(String, i64)> = sqlx::query_as(
            "SELECT translation,uses FROM phrasebook WHERE source_text=$1 ORDER BY translation",
        )
        .bind(&source)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(variants, [("A".into(), 3), ("B".into(), 4)]);
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn a_phrase_is_shared_only_after_repeated_use() {
        let pool = owner().await;
        let source = phrase();
        for _ in 1..SHARED_AFTER_USES {
            save(&pool, "m", &entry(Surface::Text, &source, "A"))
                .await
                .unwrap();
            assert_eq!(served(&pool, &source).await, None);
        }
        save(&pool, "m", &entry(Surface::Text, &source, "A"))
            .await
            .unwrap();
        assert_eq!(served(&pool, &source).await.as_deref(), Some("A"));
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn only_unreviewed_text_answers_from_the_current_prompt_are_served() {
        let pool = owner().await;
        let spoken = phrase();
        settle(&pool, &entry(Surface::Talk, &spoken, "spoken")).await;
        assert_eq!(served(&pool, &spoken).await, None, "conversation turns");
        let flagged = phrase();
        let mut review = entry(Surface::Text, &flagged, "flagged");
        review.review_required = true;
        save(&pool, "m", &review).await.unwrap();
        settle(&pool, &entry(Surface::Text, &flagged, "flagged")).await;
        assert_eq!(
            served(&pool, &flagged).await,
            None,
            "flagged once stays flagged"
        );
        let elsewhere = phrase();
        settle(&pool, &entry(Surface::Text, &elsewhere, "Thai")).await;
        let other_target = lookup(&pool, &lang("en"), &lang("lo"), &elsewhere)
            .await
            .unwrap();
        assert!(other_target.is_none(), "another target language");
        sqlx::query("UPDATE phrasebook SET prompt_version=prompt_version+1 WHERE source_text=$1")
            .bind(&elsewhere)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            served(&pool, &elsewhere).await,
            None,
            "another prompt version"
        );
    }

    #[tokio::test]
    #[ignore = "requires isolated ROAMIE_TEST_DATABASE_URL"]
    async fn identifying_empty_or_untranslated_text_is_never_kept() {
        let pool = owner().await;
        let card = format!("{} card 4111 1111 1111 1111", phrase());
        let mut same = entry(Surface::Talk, &phrase(), "same");
        same.to = lang("en");
        let mut alternative = entry(Surface::Text, &phrase(), "โทรหาฉัน");
        alternative.alternatives = vec!["โทร +66 (81) 234.5678".into()];
        let mut spoken = entry(Surface::Talk, &phrase(), "โทรหาฉัน");
        spoken.romanized = "thor 081 234 5678".into();
        let cases = [
            ("card number", entry(Surface::Talk, &card, "บัตร")),
            (
                "email in translation",
                entry(Surface::Text, &phrase(), "a@b.co"),
            ),
            ("empty translation", entry(Surface::Text, &phrase(), "  ")),
            ("empty source", entry(Surface::Sign, " ", "ป้าย")),
            ("same language", same),
            ("phone in an alternative", alternative),
            ("phone in romanization", spoken),
        ];
        for (name, case) in cases {
            assert!(!save(&pool, "m", &case).await.unwrap(), "case {name}");
            let kept: i64 =
                sqlx::query_scalar("SELECT count(*) FROM phrasebook WHERE source_text=$1")
                    .bind(normalise(&case.source))
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(kept, 0, "case {name}");
        }
    }

    #[tokio::test]
    #[ignore = "requires isolated Postgres and runtime role"]
    async fn runtime_role_can_add_and_count_but_never_delete_or_alter() {
        use std::str::FromStr;
        owner().await;
        let options = sqlx::postgres::PgConnectOptions::from_str(
            &std::env::var("ROAMIE_TEST_DATABASE_URL").unwrap(),
        )
        .unwrap()
        .username("roamie_app")
        .password(&std::env::var("ROAMIE_TEST_RUNTIME_PASSWORD").unwrap_or_default());
        let runtime = PgPool::connect_with(options).await.unwrap();
        let source = phrase();
        for _ in 0..2 {
            assert!(save(&runtime, "m", &entry(Surface::Sign, &source, "ป้าย"))
                .await
                .unwrap());
        }
        for query in [
            "DELETE FROM phrasebook",
            "TRUNCATE phrasebook",
            "ALTER TABLE phrasebook DROP COLUMN source_text",
        ] {
            let error = sqlx::query(query)
                .execute(&runtime)
                .await
                .expect_err("privilege denied");
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("42501"),
                "{query}"
            );
        }
    }
}
