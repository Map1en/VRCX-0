use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use moka::future::Cache;
use moka::Expiry;

use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use vrcx_0_application_core::Error;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

const QUERY_CAPACITY: u64 = 128;
const NEGATIVE_ENTRY_WEIGHT: u32 = 4;

const TTL_DIALOG: Duration = Duration::from_secs(60);
const TTL_LIVE_FRIEND: Duration = Duration::from_secs(300);
const TTL_LIVE_NONFRIEND: Duration = Duration::from_secs(120);
const TTL_NEGATIVE_NOT_FOUND: Duration = Duration::from_secs(900);
const TTL_NEGATIVE_FORBIDDEN: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserQueryKind {
    Dialog,
    LiveFriend,
    LiveNonFriend,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserQueryCachePolicy {
    UseCache,
    Refresh,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UserQueryOptions {
    pub kind: UserQueryKind,
    pub cache_policy: UserQueryCachePolicy,
}

impl UserQueryKind {
    fn prefix(self) -> &'static str {
        match self {
            Self::Dialog => "dlg",
            Self::LiveFriend => "livf",
            Self::LiveNonFriend => "livn",
        }
    }

    fn all() -> [Self; 3] {
        [Self::Dialog, Self::LiveFriend, Self::LiveNonFriend]
    }

    fn positive_ttl(self) -> Duration {
        match self {
            Self::Dialog => TTL_DIALOG,
            Self::LiveFriend => TTL_LIVE_FRIEND,
            Self::LiveNonFriend => TTL_LIVE_NONFRIEND,
        }
    }
}

fn cache_key(kind: UserQueryKind, endpoint: &str, user_id: &str) -> String {
    format!(
        "{}::{}::{}",
        kind.prefix(),
        normalize_vrchat_api_endpoint(Some(endpoint)),
        user_id.trim()
    )
}

fn kind_from_key(key: &str) -> Option<UserQueryKind> {
    match key.split("::").next()? {
        "dlg" => Some(UserQueryKind::Dialog),
        "livf" => Some(UserQueryKind::LiveFriend),
        "livn" => Some(UserQueryKind::LiveNonFriend),
        _ => None,
    }
}

fn negative_ttl(status: i32) -> Option<Duration> {
    match status {
        404 => Some(TTL_NEGATIVE_NOT_FOUND),
        403 => Some(TTL_NEGATIVE_FORBIDDEN),
        _ => None,
    }
}

fn cache_entry_weight(_key: &String, value: &Arc<VrchatResponse>) -> u32 {
    if negative_ttl(value.status).is_some() {
        NEGATIVE_ENTRY_WEIGHT
    } else {
        1
    }
}

pub(crate) fn is_negative_cacheable_status(status: i32) -> bool {
    negative_ttl(status).is_some()
}

struct UserQueryExpiry;

impl Expiry<String, Arc<VrchatResponse>> for UserQueryExpiry {
    fn expire_after_create(
        &self,
        key: &String,
        value: &Arc<VrchatResponse>,
        _created_at: Instant,
    ) -> Option<Duration> {
        if let Some(ttl) = negative_ttl(value.status) {
            return Some(ttl);
        }
        Some(match kind_from_key(key) {
            Some(kind) => kind.positive_ttl(),
            None => {
                debug_assert!(false, "user query cache key missing kind prefix: {key}");
                UserQueryKind::Dialog.positive_ttl()
            }
        })
    }
}

pub(crate) struct UserQueryCache {
    cache: Cache<String, Arc<VrchatResponse>>,
}

impl UserQueryCache {
    pub(crate) fn new() -> Self {
        Self {
            cache: Cache::builder()
                .max_capacity(QUERY_CAPACITY)
                .weigher(cache_entry_weight)
                .expire_after(UserQueryExpiry)
                .build(),
        }
    }

    pub(crate) async fn get_or_fetch<F>(
        &self,
        kind: UserQueryKind,
        endpoint: &str,
        user_id: &str,
        init: F,
    ) -> Result<Arc<VrchatResponse>, Arc<Error>>
    where
        F: Future<Output = Result<Arc<VrchatResponse>, Error>>,
    {
        self.cache
            .try_get_with(cache_key(kind, endpoint, user_id), init)
            .await
    }

    pub(crate) async fn invalidate(&self, kind: UserQueryKind, endpoint: &str, user_id: &str) {
        self.cache
            .invalidate(&cache_key(kind, endpoint, user_id))
            .await;
    }

    pub(crate) async fn invalidate_user(&self, endpoint: &str, user_id: &str) {
        for kind in UserQueryKind::all() {
            self.cache
                .invalidate(&cache_key(kind, endpoint, user_id))
                .await;
        }
    }

    pub(crate) fn clear(&self) {
        self.cache.invalidate_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn negative_query_results_are_bounded_to_quarter_capacity() {
        let cache = UserQueryCache::new();
        for index in 0..QUERY_CAPACITY {
            cache
                .cache
                .insert(
                    cache_key(
                        UserQueryKind::Dialog,
                        "https://api.vrchat.cloud/api/1",
                        &format!("usr_{index}"),
                    ),
                    Arc::new(VrchatResponse {
                        status: 404,
                        data: "{}".into(),
                    }),
                )
                .await;
        }
        cache.cache.run_pending_tasks().await;

        assert!(cache.cache.entry_count() <= 32);
        assert!(cache.cache.weighted_size() <= QUERY_CAPACITY);
    }
}
