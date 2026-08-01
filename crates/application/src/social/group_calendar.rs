use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};

use futures_util::{
    future::{BoxFuture, FutureExt, Shared},
    stream, StreamExt,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Semaphore;
use vrcx_0_application_core::vrchat_api::groups::profile_get_input;
use vrcx_0_application_core::vrchat_api::tools::{
    calendars_get_input, featured_calendars_get_input, following_calendars_get_input,
};
use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{ApiJsonResponse, ApiScope, HttpApiRequestInput};

use crate::{Error, Result};

const CALENDAR_PAGE_SIZE: i64 = 100;
const CALENDAR_MAX_PAGES: usize = 50;
const GROUP_PROFILE_CONCURRENCY: usize = 4;
const GROUP_PROFILE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub struct GroupCalendarDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub auth_scope: RuntimeAuthScope,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
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
    pub events: Vec<Value>,
    pub following_event_ids: Vec<String>,
    pub group_names: HashMap<String, String>,
    pub group_profiles: HashMap<String, Value>,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct GroupProfileCacheKey {
    auth_scope_generation: u64,
    group_id: String,
}

#[derive(Clone)]
struct GroupProfileCacheEntry {
    stored_at: Instant,
    profile: Value,
}

type SharedGroupProfile = Shared<BoxFuture<'static, Option<Value>>>;

static GROUP_PROFILE_CACHE: OnceLock<Mutex<HashMap<GroupProfileCacheKey, GroupProfileCacheEntry>>> =
    OnceLock::new();
static GROUP_PROFILE_IN_FLIGHT: OnceLock<
    Mutex<HashMap<GroupProfileCacheKey, (u64, SharedGroupProfile)>>,
> = OnceLock::new();
static GROUP_PROFILE_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();
static NEXT_GROUP_PROFILE_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

pub async fn load_group_calendar(
    deps: GroupCalendarDeps,
    input: GroupCalendarInput,
) -> Result<GroupCalendarSnapshot> {
    let command = "app__group_calendar_snapshot_get";
    let scope = require_active_scope(&deps.auth_scope)?;
    let date = input.date.trim().to_string();
    if date.is_empty() {
        return Err(Error::Custom(
            "Group calendar snapshot requires a date.".into(),
        ));
    }
    deps.diagnostics
        .record_command(command, "running", format!("Loading calendar {date}."));

    let result = load_group_calendar_inner(&deps, &scope, &date, input.include_featured).await;
    match &result {
        Ok(snapshot) => {
            deps.diagnostics.record_command(
                command,
                "ok",
                format!(
                    "events={}, following={}, groups={}",
                    snapshot.events.len(),
                    snapshot.following_event_ids.len(),
                    snapshot.group_names.len()
                ),
            );
            deps.sync.record(
                "groupCalendar",
                "ready",
                "Group calendar snapshot loaded.",
                0,
            );
        }
        Err(error) => {
            deps.diagnostics
                .record_command(command, "error", error.to_string());
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
    let calendars = collect_calendar_pages(deps, scope, date, CalendarKind::All);
    let following = collect_calendar_pages(deps, scope, date, CalendarKind::Following);
    let featured = async {
        if include_featured {
            collect_calendar_pages(deps, scope, date, CalendarKind::Featured).await
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
    ensure_scope_matches(&deps.auth_scope, scope)?;

    let mut group_profiles = embedded_profiles;
    group_profiles.extend(fetched_profiles);
    let group_names = group_ids
        .into_iter()
        .map(|group_id| {
            let name = group_profiles
                .get(&group_id)
                .and_then(|group| group.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(&group_id)
                .to_string();
            (group_id, name)
        })
        .collect();

    Ok(GroupCalendarSnapshot {
        events,
        following_event_ids,
        group_names,
        group_profiles,
    })
}

#[derive(Clone, Copy)]
enum CalendarKind {
    All,
    Following,
    Featured,
}

struct CalendarPage {
    rows: Vec<Value>,
    has_next: Option<bool>,
}

async fn collect_calendar_pages(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    date: &str,
    kind: CalendarKind,
) -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    for page_index in 0..=CALENDAR_MAX_PAGES {
        ensure_scope_matches(&deps.auth_scope, scope)?;
        let offset = (page_index as i64) * CALENDAR_PAGE_SIZE;
        let params = HashMap::from([
            ("n".into(), Value::from(CALENDAR_PAGE_SIZE)),
            ("offset".into(), Value::from(offset)),
            ("date".into(), Value::from(date)),
        ]);
        let request = match kind {
            CalendarKind::All => calendars_get_input(scope.endpoint.clone(), params),
            CalendarKind::Following => {
                following_calendars_get_input(scope.endpoint.clone(), params)
            }
            CalendarKind::Featured => featured_calendars_get_input(scope.endpoint.clone(), params),
        };
        let page = execute_page(deps, scope, request).await?;
        let count = page.rows.len();
        if page_index == CALENDAR_MAX_PAGES {
            if count == 0 {
                return Ok(rows);
            }
            return Err(Error::Custom(
                "Group calendar pagination exceeded the safety limit.".into(),
            ));
        }
        rows.extend(page.rows);
        if page.has_next == Some(false) || count < CALENDAR_PAGE_SIZE as usize {
            return Ok(rows);
        }
    }
    Ok(rows)
}

async fn execute_page(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    request: HttpApiRequestInput,
) -> Result<CalendarPage> {
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db.as_ref())
        .await?;
    ensure_scope_matches(&deps.auth_scope, scope)?;
    let response = ApiJsonResponse {
        status: response.status,
        json: serde_json::from_str::<Value>(&response.data)?,
    };
    if !(200..300).contains(&response.status) || response.has_error_field() {
        return Err(Error::Custom(format!(
            "Group calendar request failed: {}",
            response.error_message_or("VRChat API request failed")
        )));
    }
    Ok(page_from_payload(&response.json))
}

async fn fetch_group_profiles(
    deps: &GroupCalendarDeps,
    scope: &RuntimeAuthScopeSnapshot,
    group_ids: &[String],
) -> HashMap<String, Value> {
    let mut profiles = HashMap::new();
    let missing = group_ids
        .iter()
        .filter_map(|group_id| {
            if let Some(profile) = cached_group_profile(scope.generation, group_id) {
                profiles.insert(group_id.clone(), profile);
                None
            } else {
                Some(group_id.clone())
            }
        })
        .collect::<Vec<_>>();
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
    if let Some(profile) = cached_group_profile(scope.generation, &group_id) {
        return Some((group_id, profile));
    }
    let key = GroupProfileCacheKey {
        auth_scope_generation: scope.generation,
        group_id: group_id.clone(),
    };
    let (request_id, request) = shared_group_profile_request(key.clone(), {
        let deps = deps.clone();
        let scope = scope.clone();
        let group_id = group_id.clone();
        move || {
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
                let (_, request) =
                    profile_get_input(scope.endpoint.clone(), group_id, false).ok()?;
                let response = deps
                    .web
                    .execute_api(request, ApiScope::Vrchat, deps.db.as_ref())
                    .await
                    .ok()?;
                if !deps.auth_scope.snapshot().generation_matches(&scope) {
                    return None;
                }
                let response = ApiJsonResponse {
                    status: response.status,
                    json: serde_json::from_str::<Value>(&response.data).ok()?,
                };
                if !(200..300).contains(&response.status)
                    || response.has_error_field()
                    || !response.json.is_object()
                {
                    return None;
                }
                Some(response.json)
            }
            .boxed()
            .shared()
        }
    });
    let profile = request.await;
    let result = if let Some(profile) = profile {
        store_group_profile(scope.generation, group_id.clone(), profile.clone());
        Some((group_id, profile))
    } else {
        None
    };
    finish_group_profile_request(&key, request_id);
    result
}

fn shared_group_profile_request(
    key: GroupProfileCacheKey,
    create: impl FnOnce() -> SharedGroupProfile,
) -> (u64, SharedGroupProfile) {
    let mut requests = GROUP_PROFILE_IN_FLIGHT
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((request_id, request)) = requests.get(&key) {
        return (*request_id, request.clone());
    }
    let request_id = NEXT_GROUP_PROFILE_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let request = create();
    requests.insert(key, (request_id, request.clone()));
    (request_id, request)
}

fn finish_group_profile_request(key: &GroupProfileCacheKey, request_id: u64) {
    let Ok(mut requests) = GROUP_PROFILE_IN_FLIGHT
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    else {
        return;
    };
    if requests
        .get(key)
        .is_some_and(|(current_id, _)| *current_id == request_id)
    {
        requests.remove(key);
    }
}

fn cached_group_profile(auth_scope_generation: u64, group_id: &str) -> Option<Value> {
    let now = Instant::now();
    let mut cache = GROUP_PROFILE_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()?;
    cache.retain(|_, entry| now.duration_since(entry.stored_at) < GROUP_PROFILE_CACHE_TTL);
    cache
        .get(&GroupProfileCacheKey {
            auth_scope_generation,
            group_id: group_id.to_string(),
        })
        .map(|entry| entry.profile.clone())
}

fn store_group_profile(auth_scope_generation: u64, group_id: String, profile: Value) {
    if let Ok(mut cache) = GROUP_PROFILE_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        cache.insert(
            GroupProfileCacheKey {
                auth_scope_generation,
                group_id,
            },
            GroupProfileCacheEntry {
                stored_at: Instant::now(),
                profile,
            },
        );
    }
}

#[cfg(test)]
fn rows_from_payload(payload: &Value) -> Vec<Value> {
    page_from_payload(payload).rows
}

fn page_from_payload(payload: &Value) -> CalendarPage {
    if let Some(rows) = payload.as_array() {
        return CalendarPage {
            rows: rows.clone(),
            has_next: None,
        };
    }
    let wrapped = payload.get("json");
    let rows = payload
        .get("results")
        .and_then(Value::as_array)
        .or_else(|| wrapped.and_then(Value::as_array))
        .or_else(|| wrapped?.get("results")?.as_array())
        .cloned()
        .unwrap_or_default();
    let has_next = payload
        .get("hasNext")
        .or_else(|| wrapped.and_then(|value| value.get("hasNext")))
        .and_then(Value::as_bool);
    CalendarPage { rows, has_next }
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
            let group = row.get("group")?.as_object()?;
            let group_id = group
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|group_id| !group_id.is_empty())?;
            Some((group_id.to_string(), Value::Object(group.clone())))
        })
        .collect()
}

fn group_id(row: &Value) -> Option<String> {
    row.get("ownerId")
        .and_then(Value::as_str)
        .or_else(|| row.get("groupId").and_then(Value::as_str))
        .or_else(|| {
            row.get("group")
                .and_then(|group| group.get("id"))
                .and_then(Value::as_str)
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

fn require_active_scope(auth_scope: &RuntimeAuthScope) -> Result<RuntimeAuthScopeSnapshot> {
    crate::scope_gate::require_active_scope(auth_scope, "Group calendar snapshot")
}

fn ensure_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_scope_matches(auth_scope, expected, "Group calendar")
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn group_profile_requests_share_the_same_in_flight_future() {
        let key = GroupProfileCacheKey {
            auth_scope_generation: u64::MAX,
            group_id: "grp_in_flight_test".into(),
        };
        let factory_calls = Arc::new(AtomicUsize::new(0));
        let first_calls = Arc::clone(&factory_calls);
        let (first_id, first) = shared_group_profile_request(key.clone(), move || {
            first_calls.fetch_add(1, Ordering::Relaxed);
            async { Some(json!({ "id": "grp_in_flight_test" })) }
                .boxed()
                .shared()
        });
        let second_calls = Arc::clone(&factory_calls);
        let (second_id, second) = shared_group_profile_request(key.clone(), move || {
            second_calls.fetch_add(1, Ordering::Relaxed);
            async { None }.boxed().shared()
        });

        assert_eq!(first_id, second_id);
        assert_eq!(factory_calls.load(Ordering::Relaxed), 1);
        assert_eq!(first.await, second.await);
        finish_group_profile_request(&key, first_id);
    }

    #[test]
    fn rows_support_array_and_wrapped_page_shapes() {
        assert_eq!(rows_from_payload(&json!([{"id": "evt_1"}])).len(), 1);
        assert_eq!(
            rows_from_payload(&json!({"results": [{"id": "evt_1"}]})).len(),
            1
        );
        let wrapped = page_from_payload(&json!({
            "json": {
                "results": [{"id": "evt_1"}],
                "hasNext": false
            }
        }));
        assert_eq!(wrapped.rows.len(), 1);
        assert_eq!(wrapped.has_next, Some(false));
        assert!(rows_from_payload(&json!({"results": null})).is_empty());
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
}
