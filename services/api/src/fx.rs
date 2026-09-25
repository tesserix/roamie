use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::money::Currency;

pub const FX_BASE: &str = "https://open.er-api.com/v6";
const TTL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rates {
    pub base: Currency,
    pub as_of: String,
    pub rates: HashMap<String, f64>,
}

#[derive(Deserialize)]
struct Upstream {
    result: String,
    time_last_update_utc: String,
    rates: HashMap<String, f64>,
}

/// Daily reference rates, cached per base currency.
#[derive(Debug)]
pub struct Fx {
    url: String,
    cache: Mutex<HashMap<String, (Instant, Rates)>>,
}

impl Fx {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            cache: Mutex::default(),
        }
    }

    pub async fn latest(&self, http: &reqwest::Client, base: Currency) -> Result<Rates> {
        let key = String::from(base.clone());
        if let Some((at, rates)) = self.cache.lock().expect("fx cache poisoned").get(&key) {
            if at.elapsed() < TTL {
                return Ok(rates.clone());
            }
        }
        let res = http
            .get(format!("{}/latest/{key}", self.url))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(Error::Upstream(format!("fx {}", res.status())));
        }
        let up: Upstream = res.json().await?;
        if up.result != "success" {
            return Err(Error::Upstream(format!("fx result {}", up.result)));
        }
        let rates = Rates {
            base,
            as_of: up.time_last_update_utc,
            rates: up.rates,
        };
        self.cache
            .lock()
            .expect("fx cache poisoned")
            .insert(key, (Instant::now(), rates.clone()));
        Ok(rates)
    }
}
