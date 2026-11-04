use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use vrcx_0_application_core::RuntimeOperationStatus;

use futures_util::future::BoxFuture;
use futures_util::{stream, StreamExt};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Semaphore;
use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeDiagnostics, RuntimeSyncEngine,
};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::vrchat_json::GroupJson;

use crate::scope_gate::ScopeGate;
use vrcx_0_application_core::{Error, Result};

const SNAPSHOT_GATE: ScopeGate = ScopeGate::new("Group calendar snapshot");
const GATE: ScopeGate = ScopeGate::new("Group calendar");

const CALENDAR_PAGE_SIZE: i32 = 100;
const CALENDAR_MAX_PAGES: usize = 50;
const GROUP_PROFILE_CONCURRENCY: usize = 4;
const GROUP_PROFILE_CACHE_CAPACITY: u64 = 32;
const GROUP_PROFILE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub struct GroupCalendarDeps {
    remote: Arc<dyn GroupCalendarRemote>,
    pub auth_scope: RuntimeAuthScope,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
}

impl GroupCalendarDeps {
    pub fn new(
        remote: Arc<dyn GroupCalendarRemote>,
        auth_scope: RuntimeAuthScope,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
    ) -> Self {
        Self {
            remote,
            auth_scope,
            diagnostics,
            sync,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupCalendarPageKind {
    All,
    Following,
    Featured,
}

#[derive(Clone, Debug)]
pub struct GroupCalendarPage {
    pub rows: Vec<RawJson>,
    pub has_next: Option<bool>,
}

pub type GroupCalendarRemoteFuture<'a, T> = BoxFuture<'a, Result<T>>;
pub type GroupCalendarProfileFuture<'a> = BoxFuture<'a, Option<RawJson>>;

pub trait GroupCalendarRemote: Send + Sync {
    fn page<'a>(
        &'a self,
        endpoint: &'a str,
        kind: GroupCalendarPageKind,
        date: &'a str,
        n: i32,
        offset: i32,
    ) -> GroupCalendarRemoteFuture<'a, GroupCalendarPage>;
    fn group_profile<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> GroupCalendarProfileFuture<'a>;
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupCalendarInput {
    pub date: String,
    #[serde(default)]
    pub include_featured: bool,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupCalendarSnapshot {
    pub events: Vec<RawJson>,
    pub following_event_ids: Vec<String>,
    pub group_names: HashMap<String, String>,
    pub group_profiles: HashMap<String, RawJson>,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct GroupProfileCacheKey {
    auth_scope_generation: u64,
    group_id: String,
}

static GROUP_PROFILE_CACHE: OnceLock<Cache<GroupProfileCacheKey, Value>> = OnceLock::new();
static GROUP_PROFILE_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();

pub async fn load_group_calendar(
    deps: GroupCalendarDeps,
    input: GroupCalendarInput,
) -> Result<GroupCalendarSnapshot> {
    let command = "app__group_calendar_snapshot_get";
    let scope = SNAPSHOT_GATE.require_active(&deps.auth_scope)?;
    let date = input.date.trim().to_string();
    if date.is_empty() {
        return Err(Error::Custom(
            "Group calendar snapshot requires a date.".into(),
        ));
    }
    deps.diagnostics.record_command(
        command,
        RuntimeOperationStatus::Running,
        format!("Loading calendar {date}."),
    );

    let result = load_group_calendar_inner(&deps, &scope, &date, input.include_featured).await;
    match &result {
        Ok(snapshot) => {
            deps.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!(
                    "events={}, following={}, groups={}",
                    snapshot.events.len(),
                    snapshot.following_event_ids.len(),
                    snapshot.group_names.len()
                ),
            );
            deps.sync.record(
                "groupCalendar",
                RuntimeOperationStatus::Ready,
                "Group calendar snapshot loaded.",
                0,
            );
        }
        Err(error) => {
            deps.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            );
            deps.sync.record_failure("groupCalendar", error.to_string());
        }
    }
    result
}

async fn load_group_calendar_inner(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    date: &str,
    include_featured: bool,
) -> Result<GroupCalendarSnapshot> {
    let calendars = collect_calendar_pages(deps, scope, date, GroupCalendarPageKind::All);
    let following = collect_calendar_pages(deps, scope, date, GroupCalendarPageKind::Following);
    let featured = async {
        if include_featured {
            collect_calendar_pages(deps, scope, date, GroupCalendarPageKind::Featured).await
        } else {
            Ok(Vec::new())
        }
    };
    let (mut events, following, featured) = tokio::try_join!(calendars, following, featured)?;
    events.extend(featured);

    let following_event_ids = following.iter().filter_map(event_id).collect::<Vec<_>>();
    let all_rows = events.iter().chain(following.iter()).collect::<Vec<_>>();
    let group_ids = collect_group_ids(&all_rows);
    let embedded_profiles = embedded_group_profiles(&all_rows);
    let fetched_profiles = fetch_group_profiles(deps, scope, &group_ids).await;
    GATE.ensure_matches(&deps.auth_scope, scope)?;

    let mut group_profiles = embedded_profiles;
    group_profiles.extend(fetched_profiles);
    let group_names = group_ids
        .into_iter()
        .map(|group_id| {
            let name = group_profiles
                .get(&group_id)
                .and_then(|group| GroupJson::new(group).name())
                .unwrap_or(&group_id)
                .to_string();
            (group_id, name)
        })
        .collect();

    Ok(GroupCalendarSnapshot {
        events: events.into_iter().map(RawJson::from).collect(),
        following_event_ids,
        group_names,
        group_profiles: group_profiles
            .into_iter()
            .map(|(id, profile)| (id, RawJson::from(profile)))
            .collect(),
    })
}

async fn collect_calendar_pages(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    date: &str,
    kind: GroupCalendarPageKind,
) -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    for page_index in 0..=CALENDAR_MAX_PAGES {
        GATE.ensure_matches(&deps.auth_scope, scope)?;
        let offset = (page_index as i32) * CALENDAR_PAGE_SIZE;
        let page = deps
            .remote
            .page(&scope.endpoint, kind, date, CALENDAR_PAGE_SIZE, offset)
            .await?;
        GATE.ensure_matches(&deps.auth_scope, scope)?;
        let count = page.rows.len();
        if page_index == CALENDAR_MAX_PAGES {
            if count == 0 {
                return Ok(rows);
            }
            return Err(Error::Custom(
                "Group calendar pagination exceeded the safety limit.".into(),
            ));
        }
        rows.extend(page.rows.into_iter().map(RawJson::into_value));
        if page.has_next == Some(false) || count < CALENDAR_PAGE_SIZE as usize {
            return Ok(rows);
        }
    }
    Ok(rows)
}

async fn fetch_group_profiles(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    group_ids: &[String],
) -> HashMap<String, Value> {
    let mut profiles = HashMap::new();
    let mut missing = Vec::new();
    for group_id in group_ids {
        if let Some(profile) = cached_group_profile(scope.generation, group_id).await {
            profiles.insert(group_id.clone(), profile);
        } else {
            missing.push(group_id.clone());
        }
    }
    let fetched = stream::iter(missing)
        .map(|group_id| fetch_group_profile(deps, scope, group_id))
        .buffer_unordered(GROUP_PROFILE_CONCURRENCY)
        .filter_map(|profile| async move { profile })
        .collect::<HashMap<_, _>>()
        .await;
    profiles.extend(fetched);
    profiles
}

async fn fetch_group_profile(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    group_id: String,
) -> Option<(String, Value)> {
    let key = GroupProfileCacheKey {
        auth_scope_generation: scope.generation,
        group_id: group_id.clone(),
    };
    let profile = cached_or_fetch_group_profile(group_profile_cache(), key, {
        let deps = deps.clone();
        let scope = scope.clone();
        let request_group_id = group_id.clone();
        async move {
            if !deps.auth_scope.snapshot().generation_matches(&scope) {
                return None;
            }
            let _permit = GROUP_PROFILE_SEMAPHORE
                .get_or_init(|| Semaphore::new(GROUP_PROFILE_CONCURRENCY))
                .acquire()
                .await
                .ok()?;
            if !deps.auth_scope.snapshot().generation_matches(&scope) {
                return None;
            }
            let response = deps
                .remote
                .group_profile(&scope.endpoint, &request_group_id)
                .await;
            if !deps.auth_scope.snapshot().generation_matches(&scope) {
                return None;
            }
            response.map(RawJson::into_value).filter(Value::is_object)
        }
    })
    .await?;
    Some((group_id, profile))
}

async fn cached_or_fetch_group_profile(
    cache: &Cache<GroupProfileCacheKey, Value>,
    key: GroupProfileCacheKey,
    request: impl Future<Output = Option<Value>>,
) -> Option<Value> {
    cache.optionally_get_with(key, request).await
}

fn group_profile_cache() -> &'static Cache<GroupProfileCacheKey, Value> {
    GROUP_PROFILE_CACHE.get_or_init(|| {
        Cache::builder()
            .max_capacity(GROUP_PROFILE_CACHE_CAPACITY)
            .time_to_live(GROUP_PROFILE_CACHE_TTL)
            .build()
    })
}

async fn cached_group_profile(auth_scope_generation: u64, group_id: &str) -> Option<Value> {
    group_profile_cache()
        .get(&GroupProfileCacheKey {
            auth_scope_generation,
            group_id: group_id.to_string(),
        })
        .await
}

fn collect_group_ids(rows: &[&Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    rows.iter()
        .filter_map(|row| group_id(row))
        .filter(|group_id| seen.insert(group_id.clone()))
        .collect()
}

fn embedded_group_profiles(rows: &[&Value]) -> HashMap<String, Value> {
    rows.iter()
        .filter_map(|row| {
            let group = row.get("group")?;
            let group_id = GroupJson::new(group).id()?;
            Some((group_id.to_string(), group.clone()))
        })
        .collect()
}

fn group_id(row: &Value) -> Option<String> {
    row.get("ownerId")
        .and_then(Value::as_str)
        .or_else(|| row.get("groupId").and_then(Value::as_str))
        .or_else(|| {
            row.get("group")
                .and_then(|group| GroupJson::new(group).id())
        })
        .map(str::trim)
        .filter(|group_id| !group_id.is_empty())
        .map(str::to_string)
}

fn event_id(row: &Value) -> Option<String> {
    row.get("eventId")
        .or_else(|| row.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|event_id| !event_id.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use futures_util::future::BoxFuture;
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn group_profile_cache_coalesces_the_same_in_flight_request() {
        let cache = Cache::builder()
            .max_capacity(GROUP_PROFILE_CACHE_CAPACITY)
            .time_to_live(GROUP_PROFILE_CACHE_TTL)
            .build();
        let key = GroupProfileCacheKey {
            auth_scope_generation: u64::MAX,
            group_id: "grp_in_flight_test".into(),
        };
        let factory_calls = Arc::new(AtomicUsize::new(0));
        let first_calls = Arc::clone(&factory_calls);
        let first = cached_or_fetch_group_profile(&cache, key.clone(), async move {
            first_calls.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
            Some(json!({ "id": "grp_in_flight_test" }))
        });
        let second_calls = Arc::clone(&factory_calls);
        let second = cached_or_fetch_group_profile(&cache, key, async move {
            second_calls.fetch_add(1, Ordering::Relaxed);
            Some(json!({ "id": "unexpected" }))
        });
        let (first, second) = tokio::join!(first, second);

        assert_eq!(factory_calls.load(Ordering::Relaxed), 1);
        assert_eq!(first, second);
    }

    #[test]
    fn group_ids_are_deduplicated_across_event_shapes() {
        let rows = [
            json!({"ownerId": "grp_1"}),
            json!({"group": {"id": "grp_1", "name": "One"}}),
            json!({"group": {"id": "grp_2"}}),
        ];
        let refs = rows.iter().collect::<Vec<_>>();
        assert_eq!(collect_group_ids(&refs), vec!["grp_1", "grp_2"]);
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct PageCall {
        endpoint: String,
        kind: GroupCalendarPageKind,
        date: String,
        n: i32,
        offset: i32,
    }

    #[derive(Default)]
    struct RecordingGroupCalendarRemote {
        page_calls: Mutex<Vec<PageCall>>,
        profile_calls: Mutex<Vec<(String, String)>>,
    }

    impl GroupCalendarRemote for RecordingGroupCalendarRemote {
        fn page<'a>(
            &'a self,
            endpoint: &'a str,
            kind: GroupCalendarPageKind,
            date: &'a str,
            n: i32,
            offset: i32,
        ) -> BoxFuture<'a, Result<GroupCalendarPage>> {
            Box::pin(async move {
                self.page_calls.lock().unwrap().push(PageCall {
                    endpoint: endpoint.to_string(),
                    kind,
                    date: date.to_string(),
                    n,
                    offset,
                });
                let event_id = match kind {
                    GroupCalendarPageKind::All => "evt_all",
                    GroupCalendarPageKind::Following => "evt_following",
                    GroupCalendarPageKind::Featured => "evt_featured",
                };
                Ok(GroupCalendarPage {
                    rows: vec![RawJson::from(json!({
                        "eventId": event_id,
                        "ownerId": "grp_semantic_remote"
                    }))],
                    has_next: Some(false),
                })
            })
        }

        fn group_profile<'a>(
            &'a self,
            endpoint: &'a str,
            group_id: &'a str,
        ) -> BoxFuture<'a, Option<RawJson>> {
            Box::pin(async move {
                self.profile_calls
                    .lock()
                    .unwrap()
                    .push((endpoint.to_string(), group_id.to_string()));
                Some(RawJson::from(json!({
                    "id": group_id,
                    "name": "Semantic Group"
                })))
            })
        }
    }

    #[tokio::test]
    async fn calendar_load_merges_all_following_and_featured_pages_with_group_names() {
        let remote = Arc::new(RecordingGroupCalendarRemote::default());
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_calendar", "https://api.example.test/api/1/");

        let snapshot = load_group_calendar(
            GroupCalendarDeps::new(
                remote.clone(),
                auth_scope,
                RuntimeDiagnostics::new(),
                RuntimeSyncEngine::new(),
            ),
            GroupCalendarInput {
                date: " 2026-08-28 ".into(),
                include_featured: true,
            },
        )
        .await
        .unwrap();

        assert_eq!(snapshot.events.len(), 2);
        assert_eq!(snapshot.events[0]["eventId"], "evt_all");
        assert_eq!(snapshot.events[1]["eventId"], "evt_featured");
        assert_eq!(snapshot.following_event_ids, vec!["evt_following"]);
        assert_eq!(
            snapshot.group_names.get("grp_semantic_remote"),
            Some(&"Semantic Group".to_string())
        );

        let page_calls = remote.page_calls.lock().unwrap();
        assert_eq!(page_calls.len(), 3);
        for kind in [
            GroupCalendarPageKind::All,
            GroupCalendarPageKind::Following,
            GroupCalendarPageKind::Featured,
        ] {
            assert!(page_calls.contains(&PageCall {
                endpoint: "https://api.example.test/api/1".into(),
                kind,
                date: "2026-08-28".into(),
                n: CALENDAR_PAGE_SIZE,
                offset: 0,
            }));
        }
        assert_eq!(
            remote.profile_calls.lock().unwrap().as_slice(),
            [(
                "https://api.example.test/api/1".into(),
                "grp_semantic_remote".into()
            )]
        );
    }

    #[derive(Default)]
    struct PagingGroupCalendarRemote {
        page_calls: Mutex<Vec<(GroupCalendarPageKind, i32)>>,
    }

    impl GroupCalendarRemote for PagingGroupCalendarRemote {
        fn page<'a>(
            &'a self,
            _endpoint: &'a str,
            kind: GroupCalendarPageKind,
            _date: &'a str,
            _n: i32,
            offset: i32,
        ) -> BoxFuture<'a, Result<GroupCalendarPage>> {
            Box::pin(async move {
                self.page_calls.lock().unwrap().push((kind, offset));
                let (rows, has_next) = match (kind, offset) {
                    (GroupCalendarPageKind::All, 0) => (
                        (0..CALENDAR_PAGE_SIZE)
                            .map(|index| RawJson::from(json!({"eventId": format!("evt_{index}")})))
                            .collect(),
                        Some(true),
                    ),
                    (GroupCalendarPageKind::All, CALENDAR_PAGE_SIZE) => (
                        vec![RawJson::from(json!({"eventId": "evt_last"}))],
                        Some(false),
                    ),
                    _ => (Vec::new(), Some(false)),
                };
                Ok(GroupCalendarPage { rows, has_next })
            })
        }

        fn group_profile<'a>(
            &'a self,
            _endpoint: &'a str,
            _group_id: &'a str,
        ) -> BoxFuture<'a, Option<RawJson>> {
            Box::pin(async { None })
        }
    }

    #[tokio::test]
    async fn calendar_service_owns_pagination_and_skips_unrequested_featured_pages() {
        let remote = Arc::new(PagingGroupCalendarRemote::default());
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_paging", "");

        let snapshot = load_group_calendar(
            GroupCalendarDeps::new(
                remote.clone(),
                auth_scope,
                RuntimeDiagnostics::new(),
                RuntimeSyncEngine::new(),
            ),
            GroupCalendarInput {
                date: "2026-08-28".into(),
                include_featured: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(snapshot.events.len(), 101);
        let page_calls = remote.page_calls.lock().unwrap();
        assert!(page_calls.contains(&(GroupCalendarPageKind::All, 0)));
        assert!(page_calls.contains(&(GroupCalendarPageKind::All, CALENDAR_PAGE_SIZE)));
        assert!(page_calls.contains(&(GroupCalendarPageKind::Following, 0)));
        assert!(!page_calls
            .iter()
            .any(|(kind, _)| *kind == GroupCalendarPageKind::Featured));
    }
}
