use serde::{Deserialize, Serialize};

/// A primary BCP-47 language subtag, lowercased: `en`, `ja`, `zh`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Lang(String);

impl Lang {
    pub fn parse(raw: &str) -> Option<Self> {
        let primary = raw.trim().split(['-', '_']).next()?.to_ascii_lowercase();
        let valid =
            (2..=3).contains(&primary.len()) && primary.bytes().all(|b| b.is_ascii_lowercase());
        valid.then_some(Self(primary))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Lang {
    type Error = String;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(&raw).ok_or_else(|| format!("invalid language code {raw:?}"))
    }
}

impl From<Lang> for String {
    fn from(lang: Lang) -> Self {
        lang.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_primary_subtag() {
        let cases = [
            ("en", Some("en")),
            ("en-AU", Some("en")),
            ("ZH_Hant", Some("zh")),
            ("fil", Some("fil")),
            ("", None),
            ("e", None),
            ("english", None),
            ("1a", None),
        ];
        for (raw, want) in cases {
            assert_eq!(
                Lang::parse(raw).as_ref().map(Lang::as_str),
                want,
                "case {raw:?}"
            );
        }
    }
}
