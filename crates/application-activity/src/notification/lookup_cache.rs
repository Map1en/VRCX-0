use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use moka::policy::EvictionPolicy;
use moka::sync::Cache;

pub(super) struct LookupCacheLimits {
    pub success_capacity: u64,
    pub success_ttl: Duration,
    pub failure_capacity: u64,
    pub failure_ttl: Duration,
}

pub(super) struct LookupCache {
    success: Cache<String, String>,
    failures: Cache<String, ()>,
    inflight: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
}

impl LookupCache {
    pub(super) fn new(limits: LookupCacheLimits) -> Self {
        Self {
            success: Cache::builder()
                .max_capacity(limits.success_capacity)
                .time_to_live(limits.success_ttl)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            failures: Cache::builder()
                .max_capacity(limits.failure_capacity)
                .time_to_live(limits.failure_ttl)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            inflight: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn cached(&self, key: &str) -> Option<String> {
        self.success.get(key)
    }

    pub(super) async fn resolve(
        &self,
        key: &str,
        fetch: impl Future<Output = Option<String>>,
    ) -> Option<String> {
        if let Some(value) = self.cached(key) {
            return Some(value);
        }
        if self.recently_failed(key) {
            return None;
        }
        let inflight = self.inflight_lock(key);
        let _guard = inflight.lock().await;
        if let Some(value) = self.cached(key) {
            return Some(value);
        }
        if self.recently_failed(key) {
            return None;
        }
        match fetch.await {
            Some(value) => {
                self.store(key, &value);
                Some(value)
            }
            None => {
                self.record_failure(key);
                None
            }
        }
    }

    fn store(&self, key: &str, value: &str) {
        self.success.insert(key.to_string(), value.to_string());
    }

    fn recently_failed(&self, key: &str) -> bool {
        self.failures.get(key).is_some()
    }

    fn record_failure(&self, key: &str) {
        self.failures.insert(key.to_string(), ());
    }

    fn inflight_lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = lock(&self.inflight);
        if let Some(existing) = map.get(key).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(tokio::sync::Mutex::new(()));
        map.insert(key.to_string(), Arc::downgrade(&guard));
        guard
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_cache_uses_bounded_moka_storage() {
        let cache = LookupCache::new(LookupCacheLimits {
            success_capacity: 8,
            success_ttl: Duration::from_secs(60),
            failure_capacity: 4,
            failure_ttl: Duration::from_secs(60),
        });

        for index in 0..16 {
            let key = format!("key_{index}");
            cache.store(&key, &format!("value_{index}"));
            cache.record_failure(&key);
        }
        cache.success.run_pending_tasks();
        cache.failures.run_pending_tasks();

        assert!(cache.success.entry_count() <= 8);
        assert!(cache.failures.entry_count() <= 4);
    }
}
