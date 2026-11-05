use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use moka::future::Cache;
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeAuthScopeSnapshot};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_core::vrchat_endpoints::{normalize_vrchat_api_endpoint, VRCHAT_API_DEFAULT_ENDPOINT};

use crate::scope_gate::ScopeGate;
use vrcx_0_application_core::{Error, Result};

const GATE: ScopeGate = ScopeGate::new("Avatar moderation query");

const AVATAR_MODERATION_CACHE_CAPACITY: u64 = 4;
const AVATAR_MODERATION_CACHE_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct AvatarModerationCacheKey {
    auth_generation: u64,
    current_user_id: String,
    endpoint: String,
    revision: u64,
}

#[derive(Clone)]
pub struct AvatarModerationRuntime {
    cache: Cache<AvatarModerationCacheKey, Arc<VrchatResponse>>,
    revision: Arc<AtomicU64>,
}

#[derive(Clone, Copy)]
pub struct AvatarModerationDeps<'a> {
    pub(crate) remote: &'a dyn super::AvatarRemote,
    pub auth_scope: &'a RuntimeAuthScope,
}

impl<'a> AvatarModerationDeps<'a> {
    pub fn new(remote: &'a dyn super::AvatarRemote, auth_scope: &'a RuntimeAuthScope) -> Self {
        Self { remote, auth_scope }
    }
}

impl AvatarModerationRuntime {
    pub fn new() -> Self {
        Self {
            cache: Cache::builder()
                .max_capacity(AVATAR_MODERATION_CACHE_CAPACITY)
                .time_to_live(AVATAR_MODERATION_CACHE_TTL)
                .build(),
            revision: Arc::new(AtomicU64::new(0)),
        }
    }

    fn cache_key(&self, scope: &RuntimeAuthScopeSnapshot) -> AvatarModerationCacheKey {
        AvatarModerationCacheKey {
            auth_generation: scope.generation,
            current_user_id: scope.current_user_id.clone(),
            endpoint: normalize_vrchat_api_endpoint(Some(&scope.endpoint)),
            revision: self.revision.load(Ordering::SeqCst),
        }
    }

    async fn resolve<F, Fut>(
        &self,
        key: AvatarModerationCacheKey,
        load: F,
    ) -> Result<VrchatResponse>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<VrchatResponse>>,
    {
        let response = self
            .cache
            .try_get_with(key.clone(), async move { load().await.map(Arc::new) })
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        if !(200..300).contains(&response.status) {
            self.cache.invalidate(&key).await;
        }
        Ok((*response).clone())
    }

    pub fn invalidate(&self) {
        self.revision.fetch_add(1, Ordering::SeqCst);
        self.cache.invalidate_all();
    }
}

impl Default for AvatarModerationRuntime {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn get_avatar_moderations(
    runtime: &AvatarModerationRuntime,
    deps: AvatarModerationDeps<'_>,
    command: &str,
    detail: impl Into<String>,
) -> Result<VrchatResponse> {
    let detail = detail.into();
    let scope = deps.auth_scope.snapshot();
    if !scope.active || scope.current_user_id.trim().is_empty() {
        return deps
            .remote
            .moderations(VRCHAT_API_DEFAULT_ENDPOINT, command, &detail)
            .await;
    }
    let key = runtime.cache_key(&scope);
    let request_endpoint = scope.endpoint.clone();
    let response = runtime
        .resolve(key, move || async move {
            deps.remote
                .moderations(&request_endpoint, command, &detail)
                .await
        })
        .await?;
    GATE.ensure_matches(deps.auth_scope, &scope)?;
    Ok(response)
}

pub async fn execute_avatar_moderation_mutation(
    deps: &super::AvatarRemoteMutationDeps<'_>,
    command: &str,
    detail: String,
    mutation: super::AvatarRemoteMutation,
) -> Result<VrchatResponse> {
    let response = super::execute_avatar_remote_mutation(deps, command, detail, mutation).await?;
    if (200..300).contains(&response.status) {
        deps.avatar_moderation.invalidate();
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::sync::Notify;

    use super::*;

    fn scope(generation: u64) -> RuntimeAuthScopeSnapshot {
        RuntimeAuthScopeSnapshot {
            current_user_id: "usr_self".into(),
            endpoint: "https://api.example.test/api/1".into(),
            generation,
            active: true,
        }
    }

    fn response(status: i32, data: &str) -> VrchatResponse {
        VrchatResponse {
            status,
            data: data.into(),
        }
    }

    #[tokio::test]
    async fn reuses_successful_response_until_mutation_invalidation() {
        let runtime = AvatarModerationRuntime::new();
        let calls = Arc::new(AtomicUsize::new(0));

        for expected in [1, 1] {
            let calls = Arc::clone(&calls);
            let actual = runtime
                .resolve(runtime.cache_key(&scope(7)), move || async move {
                    let count = calls.fetch_add(1, Ordering::SeqCst) + 1;
                    Ok(response(200, &count.to_string()))
                })
                .await
                .unwrap();
            assert_eq!(actual.data, expected.to_string());
        }

        runtime.invalidate();
        let calls_after_invalidation = Arc::clone(&calls);
        let actual = runtime
            .resolve(runtime.cache_key(&scope(7)), move || async move {
                let count = calls_after_invalidation.fetch_add(1, Ordering::SeqCst) + 1;
                Ok(response(200, &count.to_string()))
            })
            .await
            .unwrap();

        assert_eq!(actual.data, "2");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn does_not_cache_unsuccessful_response() {
        let runtime = AvatarModerationRuntime::new();
        let calls = Arc::new(AtomicUsize::new(0));

        for _ in 0..2 {
            let calls = Arc::clone(&calls);
            runtime
                .resolve(runtime.cache_key(&scope(7)), move || async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(response(500, "failure"))
                })
                .await
                .unwrap();
        }

        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn concurrent_queries_share_one_loader() {
        let runtime = AvatarModerationRuntime::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(Notify::new());
        let first_runtime = runtime.clone();
        let first_calls = Arc::clone(&calls);
        let first_release = Arc::clone(&release);
        let first = tokio::spawn(async move {
            first_runtime
                .resolve(first_runtime.cache_key(&scope(7)), move || async move {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    first_release.notified().await;
                    Ok(response(200, "first"))
                })
                .await
        });

        while calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        let second_runtime = runtime.clone();
        let second_calls = Arc::clone(&calls);
        let second = tokio::spawn(async move {
            second_runtime
                .resolve(second_runtime.cache_key(&scope(7)), move || async move {
                    second_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(response(200, "second"))
                })
                .await
        });
        tokio::task::yield_now().await;
        release.notify_waiters();

        assert_eq!(first.await.unwrap().unwrap().data, "first");
        assert_eq!(second.await.unwrap().unwrap().data, "first");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn separates_auth_generations() {
        let runtime = AvatarModerationRuntime::new();
        let calls = Arc::new(AtomicUsize::new(0));

        for generation in [7, 8] {
            let calls = Arc::clone(&calls);
            runtime
                .resolve(runtime.cache_key(&scope(generation)), move || async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(response(200, "ok"))
                })
                .await
                .unwrap();
        }

        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
