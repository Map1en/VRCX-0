use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use moka::future::Cache;
use moka::Expiry;

use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_application_core::Error;

const QUERY_CAPACITY: u64 = 256;

const TTL_DIALOG_SECS: u64 = 60;
const TTL_LIVE_FRIEND_SECS: u64 = 300;
const TTL_LIVE_NONFRIEND_SECS: u64 = 120;
const TTL_NEGATIVE_NOT_FOUND_SECS: u64 = 900;
const TTL_NEGATIVE_FORBIDDEN_SECS: u64 = 60;

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
            Self::Dialog => Duration::from_secs(TTL_DIALOG_SECS),
            Self::LiveFriend => Duration::from_secs(TTL_LIVE_FRIEND_SECS),
            Self::LiveNonFriend => Duration::from_secs(TTL_LIVE_NONFRIEND_SECS),
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
        404 => Some(Duration::from_secs(TTL_NEGATIVE_NOT_FOUND_SECS)),
        403 => Some(Duration::from_secs(TTL_NEGATIVE_FORBIDDEN_SECS)),
        _ => None,
    }
}

pub(crate) fn is_negative_cacheable_status(status: i32) -> bool {
    negative_ttl(status).is_some()
}

struct UserQueryExpiry;

impl Expiry<String, Arc<VrchatApiResponse>> for UserQueryExpiry {
    fn expire_after_create(
        &self,
        key: &String,
        value: &Arc<VrchatApiResponse>,
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
    cache: Cache<String, Arc<VrchatApiResponse>>,
}

impl UserQueryCache {
    pub(crate) fn new() -> Self {
        Self {
            cache: Cache::builder()
                .max_capacity(QUERY_CAPACITY)
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
    ) -> Result<Arc<VrchatApiResponse>, Arc<Error>>
    where
        F: Future<Output = Result<Arc<VrchatApiResponse>, Error>>,
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
