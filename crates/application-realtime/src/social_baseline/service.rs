use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{json, Map, Number, Value};
use std::sync::Arc;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::{text_of, RawJson};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiJsonResponse, ApiScope, HttpApiRequestInput,
};
use vrcx_0_vrchat_client::{favorites as remote_favorites, friends as remote_friends};

use crate::realtime::{FriendBaselineSyncOutcome, RealtimeHostRuntime, RealtimeSessionContext};
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_application_core::{HostSessionRuntime, WebClient};

use crate::social_baseline::types::{
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
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
    text_of(Some(value))
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
    vrcx_0_application_core::auth_scope_matches(&deps.auth_scope, &deps.session, user_id, endpoint)
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

use favorites::CurrentUserSnapshotView;
pub use favorites::{build_favorites_baseline, build_favorites_baseline_from_friend_records};
#[cfg(test)]
pub(crate) use friends::friend_log_relationship_candidates;
pub use friends::{
    apply_friend_roster_baseline_sync_outcome, build_friend_roster_baseline,
    build_friend_roster_baseline_deferred, FriendStatusVerdicts,
};
use friends::{
    build_friend_roster_baseline_deferred_internal, build_friend_state_map,
    build_snapshot_friend_ids,
};
pub(crate) use friends::{
    reconcile_friend_roster_records, verify_friend_log_relationship_changes,
    FriendRosterReconcileOutcome,
};
pub(crate) use remote::{execute_vrchat_json_request, refetch_users_concurrent};
use remote::{fetch_friend_statuses_concurrent, fetch_paged_array};

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
    let baseline = build_friend_roster_baseline_deferred_internal(deps.clone(), input).await?;
    let mut output = baseline.output;
    let Some(friends_by_id) = baseline.friends_by_id else {
        return Ok(SyncedFriendRosterBaseline {
            output,
            friends_by_id: None,
        });
    };
    let friends_by_id = friends_by_id?;
    let verdicts =
        verify_friend_log_relationship_changes(&deps, &endpoint, &output.user_id, &friends_by_id)
            .await;

    let outcome = runtime.sync_friend_snapshot_with_watermark(
        RealtimeSessionContext::new(output.user_id.clone(), endpoint, websocket),
        watermark,
        friends_by_id,
        verdicts,
    )?;
    let canonical_friends = outcome
        .accepted_snapshot()
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
