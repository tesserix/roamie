use serde::{Deserialize, Serialize};

/// ISO 4217 code, uppercased.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Currency(String);

impl Currency {
    pub fn parse(raw: &str) -> Option<Self> {
        let code = raw.trim().to_ascii_uppercase();
        (code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())).then_some(Self(code))
    }

    pub fn exponent(&self) -> u32 {
        match self.0.as_str() {
            "BIF" | "CLP" | "DJF" | "GNF" | "ISK" | "JPY" | "KMF" | "KRW" | "PYG" | "RWF"
            | "UGX" | "VND" | "VUV" | "XAF" | "XOF" | "XPF" => 0,
            "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => 3,
            _ => 2,
        }
    }
}

impl TryFrom<String> for Currency {
    type Error = String;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(&raw).ok_or_else(|| format!("invalid currency {raw:?}"))
    }
}

impl From<Currency> for String {
    fn from(c: Currency) -> Self {
        c.0
    }
}

/// Parses a printed amount ("1,234.50", "฿ 120", "1.234,50") into integer minor units.
pub fn to_minor(printed: &str, currency: &Currency) -> Option<i64> {
    if printed.contains('-') {
        return None;
    }
    let kept: String = printed
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    let exp = currency.exponent();
    let (whole, frac) = match kept.rfind(['.', ',']) {
        Some(p) => {
            let frac = &kept[p + 1..];
            if (1..=exp as usize).contains(&frac.len()) {
                (&kept[..p], frac)
            } else if frac.len() == 3 {
                (kept.as_str(), "")
            } else {
                return None;
            }
        }
        None => (kept.as_str(), ""),
    };
    let whole: String = whole.chars().filter(char::is_ascii_digit).collect();
    if whole.is_empty() && frac.is_empty() {
        return None;
    }
    let units: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().ok()?
    };
    let frac: i64 = format!("{frac:0<width$}", width = exp as usize)
        .parse()
        .unwrap_or(0);
    units.checked_mul(10_i64.pow(exp))?.checked_add(frac)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(code: &str) -> Currency {
        Currency::parse(code).unwrap()
    }

    #[test]
    fn converts_printed_amounts_to_minor_units() {
        let cases = [
            ("plain", "12.50", "AUD", Some(1250)),
            ("thousands comma", "1,234.50", "USD", Some(123_450)),
            ("european format", "1.234,50", "EUR", Some(123_450)),
            ("decimal comma", "12,5", "EUR", Some(1250)),
            ("symbol and space", "฿ 120", "THB", Some(12_000)),
            ("zero-decimal currency", "1,500", "JPY", Some(1500)),
            (
                "zero-decimal with grouping dots",
                "150.000",
                "VND",
                Some(150_000),
            ),
            ("three-decimal currency", "1.250", "KWD", Some(1250)),
            ("more decimals than currency allows", "12.3456", "USD", None),
            (
                "three digits after separator is grouping",
                "12.345",
                "INR",
                Some(1_234_500),
            ),
            ("empty", "", "USD", None),
            ("negative", "-5.00", "USD", None),
            ("garbage", "abc", "USD", None),
        ];
        for (name, printed, cur, want) in cases {
            assert_eq!(to_minor(printed, &c(cur)), want, "case {name}");
        }
    }

    #[test]
    fn exponent_defaults_to_two() {
        assert_eq!(c("jpy").exponent(), 0);
        assert_eq!(c("KWD").exponent(), 3);
        assert_eq!(c("INR").exponent(), 2);
        assert!(Currency::parse("EURO").is_none());
    }
}
