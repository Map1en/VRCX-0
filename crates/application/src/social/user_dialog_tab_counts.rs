use std::collections::HashSet;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use futures_util::stream::{self, StreamExt};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeAuthScopeSnapshot};

use crate::scope_gate::ScopeGate;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::json::RawJson;

const GATE: ScopeGate = ScopeGate::new("User dialog tab counts");

const MAX_PROFILE_PAGES: usize = 50;
const TAB_COUNTS_CACHE_CAPACITY: u64 = 32;
const TAB_COUNTS_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const WORLD_PAGE_SIZE: usize = 100;
const WORLD_MAX_OFFSET: i32 = ((MAX_PROFILE_PAGES - 1) * WORLD_PAGE_SIZE) as i32;
const FAVORITE_GROUP_PAGE_SIZE: usize = 50;
const FAVORITE_GROUP_FETCH_CONCURRENCY: usize = 8;
const FAVORITE_WORLD_PAGE_SIZE: usize = 300;
const FAVORITE_WORLD_MAX_OFFSET: i32 = ((MAX_PROFILE_PAGES - 1) * FAVORITE_WORLD_PAGE_SIZE) as i32;
const MY_AVATAR_PAGE_SIZE: usize = 50;
const MY_AVATAR_MAX_OFFSET: i32 = 5_000;
pub const DEFAULT_AVATAR_PROVIDER: &str = "https://api.avtrdb.com/v3/avatar/search/vrcx";

#[derive(Clone)]
pub struct UserDialogTabCountsDeps {
    source: Arc<dyn UserDialogTabCountsSource>,
    pub auth_scope: RuntimeAuthScope,
}

impl UserDialogTabCountsDeps {
    pub fn new(source: Arc<dyn UserDialogTabCountsSource>, auth_scope: RuntimeAuthScope) -> Self {
        Self { source, auth_scope }
    }
}

#[derive(Clone, Debug)]
pub struct AvatarProviderConfig {
    pub enabled: bool,
    pub providers: RawJson,
    pub selected: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserDialogCountPage {
    pub row_count: usize,
    pub selected_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserDialogFavoriteGroupPage {
    pub row_count: usize,
    pub world_group_names: Vec<String>,
}

pub type UserDialogTabCountsFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait UserDialogTabCountsSource: Send + Sync {
    fn avatar_provider_config(&self) -> Result<AvatarProviderConfig>;
    fn mutual_friend_count<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
    ) -> UserDialogTabCountsFuture<'a, usize>;
    fn group_count<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
    ) -> UserDialogTabCountsFuture<'a, usize>;
    fn worlds_page<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        n: i32,
        offset: i32,
        release_status: AvatarReleaseStatus,
    ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage>;
    fn favorite_worlds_page<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        group_name: &'a str,
        n: i32,
        offset: i32,
    ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage>;
    fn favorite_groups_page<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        n: i32,
        offset: i32,
    ) -> UserDialogTabCountsFuture<'a, UserDialogFavoriteGroupPage>;
    fn my_avatars_page<'a>(
        &'a self,
        endpoint: &'a str,
        n: i32,
        offset: i32,
        release_status: AvatarReleaseStatus,
    ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage>;
    fn external_avatar_count<'a>(
        &'a self,
        provider: &'a str,
        target_user_id: &'a str,
    ) -> UserDialogTabCountsFuture<'a, usize>;
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename = "UserDialogAvatarReleaseStatus")]
pub enum AvatarReleaseStatus {
    #[serde(rename = "all")]
    All,
    #[serde(rename = "hidden")]
    Hidden,
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "public")]
    Public,
}

impl AvatarReleaseStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Hidden => "hidden",
            Self::Private => "private",
            Self::Public => "public",
        }
    }
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct UserDialogTabCountsCacheKey {
    auth_generation: u64,
    current_user_id: String,
    endpoint: String,
    target_user_id: String,
    avatar_release_status: String,
    avatar_provider: String,
    include_mutual_friends: bool,
}

#[derive(Clone)]
pub struct UserDialogTabCountsRuntime {
    cache: Cache<UserDialogTabCountsCacheKey, Arc<UserDialogTabCountsOutput>>,
}

impl UserDialogTabCountsRuntime {
    pub fn new() -> Self {
        Self {
            cache: Cache::builder()
                .max_capacity(TAB_COUNTS_CACHE_CAPACITY)
                .time_to_live(TAB_COUNTS_CACHE_TTL)
                .build(),
        }
    }

    async fn resolve<F, Fut>(
        &self,
        key: UserDialogTabCountsCacheKey,
        force: bool,
        include_mutual_friends: bool,
        load: F,
    ) -> Result<UserDialogTabCountsOutput>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<UserDialogTabCountsOutput>>,
    {
        if force {
            self.cache.invalidate(&key).await;
        }
        let counts = self
            .cache
            .try_get_with(key.clone(), async move { load().await.map(Arc::new) })
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        if !counts.is_complete(include_mutual_friends) {
            self.cache.invalidate(&key).await;
        }
        Ok((*counts).clone())
    }
}

impl Default for UserDialogTabCountsRuntime {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn get_user_dialog_tab_counts(
    runtime: &UserDialogTabCountsRuntime,
    deps: UserDialogTabCountsDeps,
    input: UserDialogTabCountsInput,
) -> Result<UserDialogTabCountsOutput> {
    let scope = GATE.require_active(&deps.auth_scope)?;
    let target_user_id = input.user_id.trim().to_string();
    if target_user_id.is_empty() {
        return Err(Error::Custom(
            "User dialog tab counts require a user id.".into(),
        ));
    }
    let avatar_release_status = input.avatar_release_status;
    let avatar_provider = if target_user_id == scope.current_user_id {
        Ok(None)
    } else {
        selected_avatar_provider(deps.source.as_ref())
    };
    let avatar_provider_key = match &avatar_provider {
        Ok(Some(provider)) => provider.clone(),
        Ok(None) => "disabled".into(),
        Err(_) => "config-error".into(),
    };
    let key = UserDialogTabCountsCacheKey {
        auth_generation: scope.generation,
        current_user_id: scope.current_user_id.clone(),
        endpoint: scope.endpoint.clone(),
        target_user_id: target_user_id.clone(),
        avatar_release_status: avatar_release_status.as_str().to_string(),
        avatar_provider: avatar_provider_key,
        include_mutual_friends: input.include_mutual_friends,
    };
    runtime
        .resolve(
            key,
            input.force,
            input.include_mutual_friends,
            move || async move {
                load_user_dialog_tab_counts(
                    deps,
                    scope,
                    target_user_id,
                    avatar_release_status,
                    avatar_provider,
                    input.include_mutual_friends,
                )
                .await
            },
        )
        .await
}

async fn load_user_dialog_tab_counts(
    deps: UserDialogTabCountsDeps,
    scope: RuntimeAuthScopeSnapshot,
    target_user_id: String,
    avatar_release_status: AvatarReleaseStatus,
    avatar_provider: Result<Option<String>>,
    include_mutual_friends: bool,
) -> Result<UserDialogTabCountsOutput> {
    let mutual_friends = async {
        if include_mutual_friends {
            Some(count_mutual_friends(&deps, &scope, &target_user_id).await)
        } else {
            None
        }
    };
    let avatars = count_avatars(
        &deps,
        &scope,
        &target_user_id,
        avatar_release_status,
        avatar_provider,
    );
    let (mutual_friends, groups, worlds, favorite_worlds, avatars) = tokio::join!(
        mutual_friends,
        count_groups(&deps, &scope, &target_user_id),
        count_worlds(&deps, &scope, &target_user_id),
        count_favorite_worlds(&deps, &scope, &target_user_id),
        avatars,
    );
    Ok(counts_from_results(
        mutual_friends,
        groups,
        worlds,
        favorite_worlds,
        avatars,
    ))
}

async fn count_mutual_friends(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
) -> Result<usize> {
    execute_scoped(
        deps,
        scope,
        deps.source
            .mutual_friend_count(&scope.endpoint, target_user_id),
    )
    .await
}

async fn count_groups(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
) -> Result<usize> {
    execute_scoped(
        deps,
        scope,
        deps.source.group_count(&scope.endpoint, target_user_id),
    )
    .await
}

async fn count_worlds(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
) -> Result<usize> {
    let release_status = if target_user_id == scope.current_user_id {
        AvatarReleaseStatus::All
    } else {
        AvatarReleaseStatus::Public
    };
    count_pages_bounded(WORLD_PAGE_SIZE, WORLD_MAX_OFFSET, |offset| {
        execute_scoped(
            deps,
            scope,
            deps.source.worlds_page(
                &scope.endpoint,
                target_user_id,
                WORLD_PAGE_SIZE as i32,
                offset,
                release_status,
            ),
        )
    })
    .await
}

async fn count_favorite_worlds(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
) -> Result<usize> {
    let group_names = collect_world_favorite_group_names(deps, scope, target_user_id).await?;
    let results = stream::iter(group_names)
        .map(|group_name| async move {
            count_pages_bounded(
                FAVORITE_WORLD_PAGE_SIZE,
                FAVORITE_WORLD_MAX_OFFSET,
                |offset| {
                    execute_scoped(
                        deps,
                        scope,
                        deps.source.favorite_worlds_page(
                            &scope.endpoint,
                            target_user_id,
                            &group_name,
                            FAVORITE_WORLD_PAGE_SIZE as i32,
                            offset,
                        ),
                    )
                },
            )
            .await
        })
        .buffer_unordered(FAVORITE_GROUP_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
    let mut count = 0;
    for result in results {
        match result {
            Ok(group_count) => count += group_count,
            Err(error) => tracing::debug!(%error, "favorite world count source failed"),
        }
    }
    Ok(count)
}

async fn collect_world_favorite_group_names(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
) -> Result<Vec<String>> {
    let mut group_names = Vec::new();
    for page_index in 0..MAX_PROFILE_PAGES {
        let page = execute_scoped(
            deps,
            scope,
            deps.source.favorite_groups_page(
                &scope.endpoint,
                target_user_id,
                FAVORITE_GROUP_PAGE_SIZE as i32,
                (page_index * FAVORITE_GROUP_PAGE_SIZE) as i32,
            ),
        )
        .await?;
        group_names.extend(page.world_group_names);
        if page.row_count < FAVORITE_GROUP_PAGE_SIZE || page_index + 1 == MAX_PROFILE_PAGES {
            return Ok(group_names);
        }
    }
    Ok(group_names)
}

async fn count_avatars(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
    release_status: AvatarReleaseStatus,
    avatar_provider: Result<Option<String>>,
) -> Result<usize> {
    if target_user_id == scope.current_user_id {
        return count_pages_bounded(MY_AVATAR_PAGE_SIZE, MY_AVATAR_MAX_OFFSET, |offset| {
            execute_scoped(
                deps,
                scope,
                deps.source.my_avatars_page(
                    &scope.endpoint,
                    MY_AVATAR_PAGE_SIZE as i32,
                    offset,
                    release_status,
                ),
            )
        })
        .await;
    }

    let Some(provider) = avatar_provider? else {
        return Ok(0);
    };
    deps.source
        .external_avatar_count(&provider, target_user_id)
        .await
}

async fn execute_scoped<T, F>(
    deps: &UserDialogTabCountsDeps,
    scope: &RuntimeAuthScopeSnapshot,
    operation: F,
) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    GATE.ensure_matches(&deps.auth_scope, scope)?;
    let result = operation.await?;
    GATE.ensure_matches(&deps.auth_scope, scope)?;
    Ok(result)
}

fn selected_avatar_provider(source: &dyn UserDialogTabCountsSource) -> Result<Option<String>> {
    let config = source.avatar_provider_config()?;
    if !config.enabled {
        return Ok(None);
    }
    let mut provider_values = match config.providers.into_value() {
        Value::Array(values) => values,
        _ => vec![Value::String(DEFAULT_AVATAR_PROVIDER.into())],
    };
    let selected = config.selected.trim().to_string();
    if !selected.is_empty()
        && !provider_values
            .iter()
            .any(|value| value.as_str() == Some(selected.as_str()))
    {
        provider_values.push(Value::String(selected.clone()));
    }

    let mut seen = HashSet::new();
    let providers = provider_values
        .into_iter()
        .filter_map(|value| value.as_str().and_then(normalize_avatar_provider))
        .filter(|provider| seen.insert(provider.clone()))
        .collect::<Vec<_>>();
    let selected = normalize_avatar_provider(&selected)
        .filter(|provider| providers.contains(provider))
        .or_else(|| providers.first().cloned());
    Ok(selected)
}

fn normalize_avatar_provider(value: &str) -> Option<String> {
    match value.trim() {
        "" | "https://avtr.just-h.party/vrcx_search.php" => None,
        "https://api.avtrdb.com/v1/avatar/search/vrcx"
        | "https://api.avtrdb.com/v2/avatar/search/vrcx" => Some(DEFAULT_AVATAR_PROVIDER.into()),
        value => Some(value.to_string()),
    }
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserDialogTabCountsInput {
    pub user_id: String,
    #[serde(default = "default_avatar_release_status")]
    pub avatar_release_status: AvatarReleaseStatus,
    #[serde(default)]
    pub include_mutual_friends: bool,
    #[serde(default)]
    pub force: bool,
}

fn default_avatar_release_status() -> AvatarReleaseStatus {
    AvatarReleaseStatus::All
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserDialogTabCountsOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutual_friends: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worlds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite_worlds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatars: Option<u32>,
}

impl UserDialogTabCountsOutput {
    fn is_complete(&self, include_mutual_friends: bool) -> bool {
        (!include_mutual_friends || self.mutual_friends.is_some())
            && self.groups.is_some()
            && self.worlds.is_some()
            && self.favorite_worlds.is_some()
            && self.avatars.is_some()
    }
}

fn counts_from_results(
    mutual_friends: Option<Result<usize>>,
    groups: Result<usize>,
    worlds: Result<usize>,
    favorite_worlds: Result<usize>,
    avatars: Result<usize>,
) -> UserDialogTabCountsOutput {
    UserDialogTabCountsOutput {
        mutual_friends: mutual_friends.and_then(|result| resolved_count("mutual friends", result)),
        groups: resolved_count("groups", groups),
        worlds: resolved_count("worlds", worlds),
        favorite_worlds: resolved_count("favorite worlds", favorite_worlds),
        avatars: resolved_count("avatars", avatars),
    }
}

fn resolved_count(source: &str, result: Result<usize>) -> Option<u32> {
    match result {
        Ok(count) => Some(crate::wire_count(count)),
        Err(error) => {
            tracing::debug!(%error, source, "user dialog tab count source failed");
            None
        }
    }
}

async fn count_pages_bounded<F, Fut>(
    page_size: usize,
    max_offset: i32,
    fetch_page: F,
) -> Result<usize>
where
    F: FnMut(i32) -> Fut,
    Fut: Future<Output = Result<UserDialogCountPage>>,
{
    let mut fetch_page = fetch_page;
    let mut count = 0;
    let mut offset = 0;
    loop {
        let page = fetch_page(offset).await?;
        count += page.selected_count;
        if page.row_count < page_size || offset >= max_offset {
            return Ok(count);
        }
        offset += page_size as i32;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct WorldPageCall {
        endpoint: String,
        user_id: String,
        n: i32,
        offset: i32,
        release_status: AvatarReleaseStatus,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct FavoriteWorldPageCall {
        endpoint: String,
        user_id: String,
        group_name: String,
        n: i32,
        offset: i32,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct MyAvatarPageCall {
        endpoint: String,
        n: i32,
        offset: i32,
        release_status: AvatarReleaseStatus,
    }

    #[derive(Default)]
    struct RecordingUserDialogTabCountsSource {
        avatar_provider_config_calls: AtomicUsize,
        world_calls: Mutex<Vec<WorldPageCall>>,
        favorite_world_calls: Mutex<Vec<FavoriteWorldPageCall>>,
        my_avatar_calls: Mutex<Vec<MyAvatarPageCall>>,
        avatar_calls: Mutex<Vec<(String, String)>>,
    }

    impl UserDialogTabCountsSource for RecordingUserDialogTabCountsSource {
        fn avatar_provider_config(&self) -> Result<AvatarProviderConfig> {
            self.avatar_provider_config_calls
                .fetch_add(1, Ordering::SeqCst);
            Ok(AvatarProviderConfig {
                enabled: true,
                providers: RawJson::from(serde_json::json!([
                    "https://avatars.example.test/search"
                ])),
                selected: "https://avatars.example.test/search".into(),
            })
        }

        fn mutual_friend_count<'a>(
            &'a self,
            _endpoint: &'a str,
            _user_id: &'a str,
        ) -> UserDialogTabCountsFuture<'a, usize> {
            Box::pin(async { Ok(7) })
        }

        fn group_count<'a>(
            &'a self,
            _endpoint: &'a str,
            _user_id: &'a str,
        ) -> UserDialogTabCountsFuture<'a, usize> {
            Box::pin(async { Ok(2) })
        }

        fn worlds_page<'a>(
            &'a self,
            endpoint: &'a str,
            user_id: &'a str,
            n: i32,
            offset: i32,
            release_status: AvatarReleaseStatus,
        ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage> {
            Box::pin(async move {
                self.world_calls.lock().unwrap().push(WorldPageCall {
                    endpoint: endpoint.to_string(),
                    user_id: user_id.to_string(),
                    n,
                    offset,
                    release_status,
                });
                Ok(if offset == 0 {
                    UserDialogCountPage {
                        row_count: WORLD_PAGE_SIZE,
                        selected_count: WORLD_PAGE_SIZE,
                    }
                } else {
                    UserDialogCountPage {
                        row_count: 1,
                        selected_count: 1,
                    }
                })
            })
        }

        fn favorite_worlds_page<'a>(
            &'a self,
            endpoint: &'a str,
            user_id: &'a str,
            group_name: &'a str,
            n: i32,
            offset: i32,
        ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage> {
            Box::pin(async move {
                self.favorite_world_calls
                    .lock()
                    .unwrap()
                    .push(FavoriteWorldPageCall {
                        endpoint: endpoint.to_string(),
                        user_id: user_id.to_string(),
                        group_name: group_name.to_string(),
                        n,
                        offset,
                    });
                let selected_count = if group_name == "worlds-a" { 3 } else { 4 };
                Ok(UserDialogCountPage {
                    row_count: selected_count,
                    selected_count,
                })
            })
        }

        fn favorite_groups_page<'a>(
            &'a self,
            _endpoint: &'a str,
            _user_id: &'a str,
            _n: i32,
            _offset: i32,
        ) -> UserDialogTabCountsFuture<'a, UserDialogFavoriteGroupPage> {
            Box::pin(async {
                Ok(UserDialogFavoriteGroupPage {
                    row_count: 2,
                    world_group_names: vec!["worlds-a".into(), "worlds-b".into()],
                })
            })
        }

        fn my_avatars_page<'a>(
            &'a self,
            endpoint: &'a str,
            n: i32,
            offset: i32,
            release_status: AvatarReleaseStatus,
        ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage> {
            Box::pin(async move {
                self.my_avatar_calls.lock().unwrap().push(MyAvatarPageCall {
                    endpoint: endpoint.to_string(),
                    n,
                    offset,
                    release_status,
                });
                Ok(UserDialogCountPage {
                    row_count: 1,
                    selected_count: 1,
                })
            })
        }

        fn external_avatar_count<'a>(
            &'a self,
            provider: &'a str,
            target_user_id: &'a str,
        ) -> UserDialogTabCountsFuture<'a, usize> {
            Box::pin(async move {
                self.avatar_calls
                    .lock()
                    .unwrap()
                    .push((provider.to_string(), target_user_id.to_string()));
                Ok(6)
            })
        }
    }

    #[tokio::test]
    async fn other_user_tab_counts_aggregate_every_source_with_public_world_paging() {
        let source = Arc::new(RecordingUserDialogTabCountsSource::default());
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_self", "https://api.example.test/api/1/");

        let counts = get_user_dialog_tab_counts(
            &UserDialogTabCountsRuntime::new(),
            UserDialogTabCountsDeps::new(source.clone(), auth_scope),
            UserDialogTabCountsInput {
                user_id: " usr_target ".into(),
                avatar_release_status: AvatarReleaseStatus::Private,
                include_mutual_friends: true,
                force: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            counts,
            UserDialogTabCountsOutput {
                mutual_friends: Some(7),
                groups: Some(2),
                worlds: Some(101),
                favorite_worlds: Some(7),
                avatars: Some(6),
            }
        );
        assert_eq!(
            source.world_calls.lock().unwrap().as_slice(),
            [
                WorldPageCall {
                    endpoint: "https://api.example.test/api/1".into(),
                    user_id: "usr_target".into(),
                    n: WORLD_PAGE_SIZE as i32,
                    offset: 0,
                    release_status: AvatarReleaseStatus::Public,
                },
                WorldPageCall {
                    endpoint: "https://api.example.test/api/1".into(),
                    user_id: "usr_target".into(),
                    n: WORLD_PAGE_SIZE as i32,
                    offset: WORLD_PAGE_SIZE as i32,
                    release_status: AvatarReleaseStatus::Public,
                },
            ]
        );
        let favorite_world_calls = source.favorite_world_calls.lock().unwrap();
        assert_eq!(favorite_world_calls.len(), 2);
        assert!(favorite_world_calls
            .iter()
            .any(|call| call.group_name == "worlds-a"));
        assert!(favorite_world_calls
            .iter()
            .any(|call| call.group_name == "worlds-b"));
        assert_eq!(
            source.avatar_calls.lock().unwrap().as_slice(),
            [(
                "https://avatars.example.test/search".into(),
                "usr_target".into()
            )]
        );
    }

    #[tokio::test]
    async fn current_user_avatar_count_skips_external_provider_and_keeps_release_filter() {
        let source = Arc::new(RecordingUserDialogTabCountsSource::default());
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_current", "https://api.example.test/api/1/");

        let counts = get_user_dialog_tab_counts(
            &UserDialogTabCountsRuntime::new(),
            UserDialogTabCountsDeps::new(source.clone(), auth_scope),
            UserDialogTabCountsInput {
                user_id: "usr_current".into(),
                avatar_release_status: AvatarReleaseStatus::Private,
                include_mutual_friends: false,
                force: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            counts,
            UserDialogTabCountsOutput {
                mutual_friends: None,
                groups: Some(2),
                worlds: Some(101),
                favorite_worlds: Some(7),
                avatars: Some(1),
            }
        );
        assert_eq!(
            source.avatar_provider_config_calls.load(Ordering::SeqCst),
            0
        );
        assert!(source.avatar_calls.lock().unwrap().is_empty());
        assert_eq!(
            source.my_avatar_calls.lock().unwrap().as_slice(),
            [MyAvatarPageCall {
                endpoint: "https://api.example.test/api/1".into(),
                n: MY_AVATAR_PAGE_SIZE as i32,
                offset: 0,
                release_status: AvatarReleaseStatus::Private,
            }]
        );
        assert!(source
            .world_calls
            .lock()
            .unwrap()
            .iter()
            .all(|call| call.release_status == AvatarReleaseStatus::All));
    }

    #[test]
    fn keeps_successful_counts_when_one_source_fails() {
        let counts = counts_from_results(
            Some(Ok(7)),
            Ok(12),
            Err(Error::Custom("worlds failed".into())),
            Ok(34),
            Ok(56),
        );

        assert_eq!(
            counts,
            UserDialogTabCountsOutput {
                mutual_friends: Some(7),
                groups: Some(12),
                worlds: None,
                favorite_worlds: Some(34),
                avatars: Some(56),
            }
        );
    }

    #[test]
    fn tab_counts_input_uses_the_release_status_enum() {
        let default_input = serde_json::from_value::<UserDialogTabCountsInput>(
            serde_json::json!({ "userId": "usr_target" }),
        )
        .unwrap();
        assert_eq!(
            default_input.avatar_release_status,
            AvatarReleaseStatus::All
        );

        let public_input = serde_json::from_value::<UserDialogTabCountsInput>(serde_json::json!({
            "userId": "usr_target",
            "avatarReleaseStatus": "public"
        }))
        .unwrap();
        assert_eq!(
            public_input.avatar_release_status,
            AvatarReleaseStatus::Public
        );

        assert!(
            serde_json::from_value::<UserDialogTabCountsInput>(serde_json::json!({
                "userId": "usr_target",
                "avatarReleaseStatus": "invalid"
            }))
            .is_err()
        );
    }

    #[tokio::test]
    async fn page_counter_stops_on_a_short_page_and_uses_monotonic_offsets() {
        let payloads = Arc::new(Mutex::new(VecDeque::from([
            Ok(UserDialogCountPage {
                row_count: 2,
                selected_count: 2,
            }),
            Ok(UserDialogCountPage {
                row_count: 1,
                selected_count: 1,
            }),
        ])));
        let offsets = Arc::new(Mutex::new(Vec::new()));

        let count = count_pages_bounded(2, 100, {
            let payloads = Arc::clone(&payloads);
            let offsets = Arc::clone(&offsets);
            move |offset| {
                offsets.lock().unwrap().push(offset);
                let payload = payloads.lock().unwrap().pop_front().unwrap();
                std::future::ready(payload)
            }
        })
        .await
        .unwrap();

        assert_eq!(count, 3);
        assert_eq!(*offsets.lock().unwrap(), vec![0, 2]);
    }

    #[tokio::test]
    async fn bounded_page_counter_includes_the_page_at_the_maximum_offset() {
        let offsets = Arc::new(Mutex::new(Vec::new()));

        let count = count_pages_bounded(2, 4, {
            let offsets = Arc::clone(&offsets);
            move |offset| {
                offsets.lock().unwrap().push(offset);
                std::future::ready(Ok(UserDialogCountPage {
                    row_count: 2,
                    selected_count: 2,
                }))
            }
        })
        .await
        .unwrap();

        assert_eq!(count, 6);
        assert_eq!(*offsets.lock().unwrap(), vec![0, 2, 4]);
    }

    #[tokio::test]
    async fn runtime_reuses_complete_counts_until_force_refresh() {
        let runtime = UserDialogTabCountsRuntime::new();
        let key = UserDialogTabCountsCacheKey {
            auth_generation: 7,
            current_user_id: "usr_self".into(),
            endpoint: "https://api.example.test".into(),
            target_user_id: "usr_target".into(),
            avatar_release_status: "public".into(),
            avatar_provider: "provider-a".into(),
            include_mutual_friends: true,
        };
        let calls = Arc::new(AtomicUsize::new(0));
        let expected = UserDialogTabCountsOutput {
            mutual_friends: Some(5),
            groups: Some(1),
            worlds: Some(2),
            favorite_worlds: Some(3),
            avatars: Some(4),
        };

        for force in [false, false, true] {
            let calls = Arc::clone(&calls);
            let loaded_counts = expected.clone();
            assert_eq!(
                runtime
                    .resolve(key.clone(), force, true, move || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        Ok(loaded_counts)
                    })
                    .await
                    .unwrap(),
                expected
            );
        }

        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
