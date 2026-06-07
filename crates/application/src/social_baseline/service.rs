use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Map, Number, Value};
use std::sync::Arc;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::config::{ConfigRepository, ConfigWriteEntry};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiScope, HttpApiRequestInput,
};
use vrcx_0_vrchat_client::{
    favorites as remote_favorites, friends as remote_friends, users as remote_users,
};

use crate::auth_scope::RuntimeAuthScope;
use crate::session::HostSessionRuntime;
use crate::web_client::WebClient;
use crate::{Error, Result};
use vrcx_0_persistence::friends::{
    FriendLogCurrentEntryInput, FriendLogHistoryEntryInput, FriendLogReplaceOptionsInput,
};

use crate::social_baseline::types::{
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};

const FAVORITES_PAGE_SIZE: i64 = 300;
const FAVORITE_GROUPS_PAGE_SIZE: i64 = 50;
const FRIEND_PAGE_SIZE: i64 = 50;
const FRIEND_REMOVAL_STATUS_CONFIRMATION_LIMIT: usize = 50;
const FRIEND_ADDITION_RECONCILIATION_LIMIT: usize = 50;

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

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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

fn get_config_bool(deps: &SocialBaselineDeps, key: &str, default_value: bool) -> Result<bool> {
    ConfigRepository::new(Arc::clone(&deps.db))
        .get_bool(key, default_value)
        .map_err(Error::from)
}

fn get_config_array(deps: &SocialBaselineDeps, key: &str) -> Result<Vec<String>> {
    let parsed = ConfigRepository::new(Arc::clone(&deps.db))
        .get_json(key, Value::Null)
        .map_err(Error::from)?;
    let mut groups = parsed
        .as_array()
        .map(|values| {
            values
                .iter()
                .map(value_as_string)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    groups = unique_values(groups);
    groups.sort();
    Ok(groups)
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
    }
}

#[path = "favorites.rs"]
mod favorites;
#[path = "friends.rs"]
mod friends;
#[path = "remote.rs"]
mod remote;

pub use favorites::build_favorites_baseline;
use favorites::CurrentUserSnapshotView;
pub use friends::build_friend_roster_baseline;
use friends::{build_friend_state_map, build_snapshot_friend_ids};
use remote::{execute_vrchat_json_request, fetch_paged_array};
