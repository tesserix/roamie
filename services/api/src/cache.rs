use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::time::Instant;

const TTL: Duration = Duration::from_secs(30 * 60);
const CAPACITY: usize = 2048;

pub type Key = [u8; 32];

/// Answers a traveller asked for in the last half hour, held in memory only.
pub struct Recent<T> {
    entries: Mutex<HashMap<Key, (Instant, T)>>,
}

impl<T> Default for Recent<T> {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

/// Travellers never share an answer: the owner is part of every key.
pub fn key(owner: &str, request: &Value) -> Key {
    let mut hash = Sha256::new();
    hash.update((owner.len() as u64).to_be_bytes());
    hash.update(owner.as_bytes());
    hash.update(request.to_string().as_bytes());
    hash.finalize().into()
}

impl<T: Clone> Recent<T> {
    pub fn get(&self, key: &Key) -> Option<T> {
        let entries = self.entries.lock().ok()?;
        entries
            .get(key)
            .filter(|(at, _)| at.elapsed() < TTL)
            .map(|(_, value)| value.clone())
    }

    pub fn put(&self, key: Key, value: T) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.retain(|_, (at, _)| at.elapsed() < TTL);
        if entries.len() >= CAPACITY {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| *k)
            {
                entries.remove(&oldest);
            }
        }
        entries.insert(key, (Instant::now(), value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn owners_and_requests_get_distinct_keys() {
        let request = json!({"text":"Hello"});
        assert_eq!(key("a", &request), key("a", &request));
        assert_ne!(key("a", &request), key("b", &request));
        assert_ne!(key("a", &request), key("a", &json!({"text":"Hello!"})));
        assert_ne!(key("ab", &json!("c")), key("a", &json!("bc")));
    }

    #[test]
    fn another_traveller_never_sees_an_answer() {
        let cache = Recent::default();
        let request = json!({"text":"Hello"});
        cache.put(key("a", &request), "สวัสดี");
        assert_eq!(cache.get(&key("a", &request)), Some("สวัสดี"));
        assert_eq!(cache.get(&key("b", &request)), None);
    }

    #[tokio::test(start_paused = true)]
    async fn answers_expire_after_half_an_hour() {
        let cache = Recent::default();
        let k = key("a", &json!("Hello"));
        cache.put(k, 1);
        tokio::time::advance(TTL - Duration::from_secs(1)).await;
        assert_eq!(cache.get(&k), Some(1));
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(cache.get(&k), None);
    }

    #[tokio::test(start_paused = true)]
    async fn a_full_cache_drops_its_oldest_answer() {
        let cache = Recent::default();
        for i in 0..CAPACITY {
            cache.put(key("a", &json!(i)), i);
            tokio::time::advance(Duration::from_millis(1)).await;
        }
        cache.put(key("a", &json!("new")), 0);
        assert_eq!(cache.get(&key("a", &json!(0))), None);
        assert_eq!(cache.get(&key("a", &json!(1))), Some(1));
        assert_eq!(cache.get(&key("a", &json!("new"))), Some(0));
    }
}
