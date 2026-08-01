use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeAuthScopeSnapshot};
use vrcx_0_application_realtime::{
    RealtimeHostRuntime, UserQueryCachePolicy, UserQueryKind, UserQueryOptions,
};
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::friends::friend_display_names;
use vrcx_0_persistence::game_log::{game_log_query, GameLogQueryInput};
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};

pub const FRIEND_LOG_NAME_RESOLUTION_MAX_USERS: usize = 100;
const FRIEND_LOG_REMOTE_LOOKUP_MAX_USERS: usize = 30;
const UNKNOWN_DISPLAY_NAME: &str = "Unknown";

pub struct FriendLogNameResolutionDeps<'a> {
    pub db: &'a DatabaseService,
    pub auth_scope: &'a RuntimeAuthScope,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
}

#[derive(Default)]
pub struct FriendLogNameResolutionCoordinator {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

struct FriendLogNameResolutionGuard<'a> {
    coordinator: &'a FriendLogNameResolutionCoordinator,
    request_id: String,
    cancelled: Arc<AtomicBool>,
}

impl FriendLogNameResolutionCoordinator {
    fn begin(&self, request_id: String) -> Result<FriendLogNameResolutionGuard<'_>> {
        if request_id.trim().is_empty() {
            return Err(Error::Custom(
                "Friend log name resolution requires a request id.".into(),
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut active = self.active.lock().unwrap_or_else(|lock| lock.into_inner());
        if let Some(previous) = active.insert(request_id.clone(), Arc::clone(&cancelled)) {
            previous.store(true, Ordering::Release);
        }
        Ok(FriendLogNameResolutionGuard {
            coordinator: self,
            request_id,
            cancelled,
        })
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let active = self.active.lock().unwrap_or_else(|lock| lock.into_inner());
        let Some(cancelled) = active.get(request_id) else {
            return false;
        };
        cancelled.store(true, Ordering::Release);
        true
    }
}

impl FriendLogNameResolutionGuard<'_> {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

impl Drop for FriendLogNameResolutionGuard<'_> {
    fn drop(&mut self) {
        let mut active = self
            .coordinator
            .active
            .lock()
            .unwrap_or_else(|lock| lock.into_inner());
        if active
            .get(&self.request_id)
            .is_some_and(|cancelled| Arc::ptr_eq(cancelled, &self.cancelled))
        {
            active.remove(&self.request_id);
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogNameResolutionInput {
    pub request_id: String,
    #[serde(default)]
    pub user_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFriendLogName {
    pub user_id: String,
    pub display_name: String,
}

pub async fn resolve_friend_log_names(
    coordinator: &FriendLogNameResolutionCoordinator,
    deps: FriendLogNameResolutionDeps<'_>,
    input: FriendLogNameResolutionInput,
) -> Result<Vec<ResolvedFriendLogName>> {
    let request = coordinator.begin(input.request_id)?;
    let expected_scope = require_active_scope(deps.auth_scope)?;
    let user_ids = normalize_user_ids(input.user_ids);
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut names =
        match friend_display_names(deps.db, expected_scope.current_user_id.clone(), &user_ids) {
            Ok(rows) => rows
                .into_iter()
                .filter_map(|(user_id, display_name)| {
                    normalize_display_name(&display_name, &user_id).map(|name| (user_id, name))
                })
                .collect::<HashMap<_, _>>(),
            Err(error) => {
                tracing::debug!(error = %error, "friend log persisted-name lookup failed");
                HashMap::new()
            }
        };

    let missing = unresolved_ids(&user_ids, &names);
    if !missing.is_empty() {
        if let Err(error) = merge_game_log_names(deps.db, &expected_scope, &missing, &mut names) {
            tracing::debug!(error = %error, "friend log GameLog-name lookup failed");
        }
    }

    for user_id in unresolved_ids(&user_ids, &names)
        .into_iter()
        .take(FRIEND_LOG_REMOTE_LOOKUP_MAX_USERS)
    {
        if request.is_cancelled() {
            break;
        }
        ensure_scope_matches(deps.auth_scope, &expected_scope)?;
        let response = match deps
            .realtime
            .get_user_via_cache_with_options(
                expected_scope.endpoint.clone(),
                user_id.clone(),
                UserQueryOptions {
                    kind: UserQueryKind::LiveNonFriend,
                    cache_policy: UserQueryCachePolicy::UseCache,
                },
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::debug!(user_id, error = %error, "friend log name lookup failed");
                continue;
            }
        };
        if request.is_cancelled() {
            break;
        }
        if !(200..300).contains(&response.status) {
            continue;
        }
        let value = serde_json::from_str::<Value>(&response.data).unwrap_or(Value::Null);
        if let Some(display_name) = normalize_display_name(
            value
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(""),
            &user_id,
        ) {
            names.insert(user_id, display_name);
        }
    }
    ensure_scope_matches(deps.auth_scope, &expected_scope)?;

    Ok(user_ids
        .into_iter()
        .filter_map(|user_id| {
            names
                .remove(&user_id)
                .map(|display_name| ResolvedFriendLogName {
                    user_id,
                    display_name,
                })
        })
        .collect())
}

fn merge_game_log_names(
    db: &DatabaseService,
    scope: &RuntimeAuthScopeSnapshot,
    user_ids: &[String],
    names: &mut HashMap<String, String>,
) -> Result<()> {
    let value = game_log_query(
        db,
        &scope.current_user_id,
        GameLogQueryInput {
            kind: "allUserStats".into(),
            params: RawJson::from(json!({ "userIds": user_ids })),
        },
    )?;
    for row in value.as_array().into_iter().flatten() {
        let user_id = row
            .get("userId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if user_id.is_empty() || names.contains_key(user_id) {
            continue;
        }
        if let Some(display_name) = normalize_display_name(
            row.get("displayName")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            user_id,
        ) {
            names.insert(user_id.to_string(), display_name);
        }
    }
    Ok(())
}

fn require_active_scope(auth_scope: &RuntimeAuthScope) -> Result<RuntimeAuthScopeSnapshot> {
    crate::scope_gate::require_active_scope(auth_scope, "Friend log name resolution")
}

fn ensure_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_scope_matches(auth_scope, expected, "Friend log name resolution")
}

fn normalize_user_ids(user_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    user_ids
        .into_iter()
        .map(|user_id| user_id.trim().to_string())
        .filter(|user_id| !user_id.is_empty() && seen.insert(user_id.clone()))
        .take(FRIEND_LOG_NAME_RESOLUTION_MAX_USERS)
        .collect()
}

fn unresolved_ids(user_ids: &[String], names: &HashMap<String, String>) -> Vec<String> {
    user_ids
        .iter()
        .filter(|user_id| !names.contains_key(*user_id))
        .cloned()
        .collect()
}

fn normalize_display_name(value: &str, user_id: &str) -> Option<String> {
    let display_name = value.trim();
    if display_name.is_empty()
        || display_name == user_id
        || display_name == UNKNOWN_DISPLAY_NAME
        || display_name.starts_with("usr_")
    {
        None
    } else {
        Some(display_name.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_ids_are_trimmed_deduplicated_and_bounded() {
        let mut ids = vec![" usr_1 ".to_string(), "usr_1".to_string()];
        ids.extend((2..=150).map(|index| format!("usr_{index}")));
        let normalized = normalize_user_ids(ids);

        assert_eq!(normalized.len(), FRIEND_LOG_NAME_RESOLUTION_MAX_USERS);
        assert_eq!(normalized[0], "usr_1");
        assert_eq!(normalized[1], "usr_2");
    }

    #[test]
    fn invalid_display_name_candidates_are_ignored() {
        assert_eq!(normalize_display_name("", "usr_1"), None);
        assert_eq!(normalize_display_name("usr_1", "usr_1"), None);
        assert_eq!(normalize_display_name("Unknown", "usr_1"), None);
        assert_eq!(
            normalize_display_name(" Display Name ", "usr_1"),
            Some("Display Name".into())
        );
    }

    #[test]
    fn coordinator_cancels_only_the_active_request() {
        let coordinator = FriendLogNameResolutionCoordinator::default();
        let request = coordinator.begin("request-7".into()).unwrap();

        assert!(coordinator.cancel("request-7"));
        assert!(request.is_cancelled());
        assert!(!coordinator.cancel("request-8"));
        drop(request);
        assert!(!coordinator.cancel("request-7"));
        assert!(coordinator.begin("request-7".into()).is_ok());
    }

    #[test]
    fn coordinator_replaces_a_reused_request_id() {
        let coordinator = FriendLogNameResolutionCoordinator::default();
        let first = coordinator.begin("request-7".into()).unwrap();
        let replacement = coordinator.begin("request-7".into()).unwrap();

        assert!(first.is_cancelled());
        assert!(!replacement.is_cancelled());
        drop(first);
        assert!(coordinator.cancel("request-7"));
        assert!(replacement.is_cancelled());
    }
}
