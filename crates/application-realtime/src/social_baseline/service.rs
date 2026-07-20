use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{json, Map, Number, Value};
use std::sync::Arc;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiScope, HttpApiRequestInput,
};
use vrcx_0_vrchat_client::{favorites as remote_favorites, friends as remote_friends};

use crate::realtime::{FriendBaselineSyncOutcome, RealtimeHostRuntime};
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_application_core::{HostSessionRuntime, WebClient};

use crate::social_baseline::types::{
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};

const FAVORITES_PAGE_SIZE: i64 = 300;
const FAVORITE_GROUPS_PAGE_SIZE: i64 = 50;
const FRIEND_PAGE_SIZE: i64 = 50;

#[derive(Clone)]
pub struct SocialBaselineDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_endpoint(endpoint: &str) -> String {
    normalize_vrchat_api_endpoint(Some(endpoint))
}

fn value_as_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn value_as_i64(value: Option<&Value>) -> i64 {
    value
        .and_then(Value::as_i64)
        .or_else(|| {
            value
                .map(value_as_string)
                .and_then(|value| value.parse::<i64>().ok())
        })
        .unwrap_or(0)
}

fn object_field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|object| object.get(key))
}

fn object_field_string(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = object_field(value, key) {
            return value_as_string(value);
        }
    }
    String::new()
}

fn object_field_normalized(value: &Value, keys: &[&str]) -> String {
    object_field_string(value, keys).trim().to_string()
}

fn string_array_field(value: &Value, key: &str) -> Vec<String> {
    object_field(value, key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(value_as_string)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn unique_push(values: &mut Vec<String>, seen: &mut HashSet<String>, value: String) {
    if value.is_empty() || seen.contains(&value) {
        return;
    }
    seen.insert(value.clone());
    values.push(value);
}

fn extend_unique(values: &mut Vec<String>, seen: &mut HashSet<String>, next_values: Vec<String>) {
    for value in next_values {
        unique_push(values, seen, value);
    }
}

fn unique_values(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    extend_unique(&mut output, &mut seen, values);
    output
}

fn get_config_array(deps: &SocialBaselineDeps, key: &str) -> Result<Vec<String>> {
    vrcx_0_application_core::read_config_string_array(deps.db.as_ref(), key)
}

fn auth_scope_matches(deps: &SocialBaselineDeps, user_id: &str, endpoint: &str) -> bool {
    let auth_scope = deps.auth_scope.snapshot();
    if auth_scope.active {
        return deps.auth_scope.matches(user_id, endpoint);
    }

    let snapshot = deps.session.snapshot();
    let Some(context) = snapshot.realtime_context else {
        return true;
    };
    context.current_user_id == user_id
        && context.endpoint.trim().trim_end_matches('/') == endpoint.trim().trim_end_matches('/')
}

fn stale_favorites_output(user_id: String) -> SocialFavoritesBaselineOutput {
    SocialFavoritesBaselineOutput {
        user_id,
        stale: true,
        count: 0,
        snapshot: None,
    }
}

fn stale_friend_output(user_id: String, detail: String) -> SocialFriendRosterBaselineOutput {
    SocialFriendRosterBaselineOutput {
        user_id,
        stale: true,
        count: 0,
        detail,
        snapshot: None,
        friend_log_changed: false,
    }
}

mod favorites;
mod friends;
mod remote;

pub use favorites::build_favorites_baseline;
use favorites::CurrentUserSnapshotView;
pub use friends::{
    apply_friend_roster_baseline_sync_outcome, build_friend_roster_baseline,
    build_friend_roster_baseline_deferred,
};
use friends::{build_friend_state_map, build_snapshot_friend_ids};
pub(crate) use friends::{reconcile_friend_roster_records, FriendRosterReconcileOutcome};
use remote::fetch_paged_array;
pub(crate) use remote::{execute_vrchat_json_request, refetch_users_concurrent};

pub struct SyncedFriendRosterBaseline {
    pub output: SocialFriendRosterBaselineOutput,
    pub friends_by_id: Option<HashMap<String, FriendRecord>>,
}

pub async fn build_synced_friend_roster_baseline(
    deps: SocialBaselineDeps,
    runtime: &Arc<RealtimeHostRuntime>,
    input: SocialFriendRosterBaselineInput,
) -> Result<SyncedFriendRosterBaseline> {
    let endpoint = input.endpoint.clone();
    let websocket = input.websocket.clone();
    let watermark = runtime.capture_friend_baseline_watermark()?;
    let mut output = build_friend_roster_baseline_deferred(deps, input).await?;
    if output.stale {
        return Ok(SyncedFriendRosterBaseline {
            output,
            friends_by_id: None,
        });
    }

    let friends_value = output
        .snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.as_value().get("friendsById"))
        .cloned()
        .ok_or_else(|| Error::Custom("Friend roster baseline has no friendsById map.".into()))?;
    let friends_by_id = serde_json::from_value(friends_value)?;

    let outcome = runtime.sync_friend_snapshot_with_watermark(
        output.user_id.clone(),
        endpoint,
        websocket,
        watermark,
        friends_by_id,
    )?;
    let canonical_friends = outcome
        .snapshot
        .as_ref()
        .filter(|_| outcome.result.accepted)
        .map(|snapshot| snapshot.friends_by_id.clone());
    if !apply_friend_roster_baseline_sync_outcome(&mut output, outcome)? {
        return Ok(SyncedFriendRosterBaseline {
            output,
            friends_by_id: None,
        });
    }
    let friends_by_id = canonical_friends.ok_or_else(|| {
        Error::Custom("Accepted friend roster baseline has no canonical snapshot.".into())
    })?;
    Ok(SyncedFriendRosterBaseline {
        output,
        friends_by_id: Some(friends_by_id),
    })
}
