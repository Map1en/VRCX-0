#![allow(non_snake_case)]

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use chrono::{SecondsFormat, Utc};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::Url;
use serde_json::{json, Map, Number, Value};
use tauri::State;
use vrcx_0_store::common::ParamsBuilder;

use crate::api::app::local_data::types::{
    ConfigWriteEntry, FriendLogCurrentEntryInput, FriendLogHistoryEntryInput,
    FriendLogReplaceOptionsInput,
};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendFavoritesBaselineInput, BackendFavoritesBaselineOutput,
    BackendFriendRosterBaselineInput, BackendFriendRosterBaselineOutput, FavoriteGroupOutput,
    RemoteFavoriteSnapshot, TrustLevelInfo,
};

const DEFAULT_VRCHAT_API_ENDPOINT: &str = "https://api.vrchat.cloud/api/1";
const FAVORITES_PAGE_SIZE: i64 = 300;
const FAVORITE_GROUPS_PAGE_SIZE: i64 = 50;
const FRIEND_PAGE_SIZE: i64 = 50;
const FRIEND_MAX_OFFSET: i64 = 7500;
const FRIEND_REMOVAL_STATUS_CONFIRMATION_LIMIT: usize = 50;
const FRIEND_ADDITION_RECONCILIATION_LIMIT: usize = 50;

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_endpoint(endpoint: &str) -> String {
    let endpoint = endpoint.trim().trim_end_matches('/');
    if endpoint.is_empty() {
        DEFAULT_VRCHAT_API_ENDPOINT.to_string()
    } else {
        endpoint.to_string()
    }
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

fn normalize_config_key(key: &str) -> String {
    let key = key.trim();
    if key.starts_with("config:") {
        return key.to_string();
    }
    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_ascii_lowercase())
}

fn ensure_config_table(state: &State<'_, AppState>) -> Result<(), AppError> {
    state.db.execute_non_query(
        "CREATE TABLE IF NOT EXISTS configs (`key` TEXT PRIMARY KEY, `value` TEXT)",
        &Default::default(),
    )?;
    Ok(())
}

fn get_config_string(state: &State<'_, AppState>, key: &str) -> Result<Option<String>, AppError> {
    ensure_config_table(state)?;
    Ok(state
        .db
        .execute(
            "SELECT value FROM configs WHERE key = @key LIMIT 1",
            &ParamsBuilder::new()
                .set("key", normalize_config_key(key))
                .build(),
        )?
        .first()
        .map(|row| value_as_string(row.first().unwrap_or(&Value::Null))))
}

fn get_config_bool(
    state: &State<'_, AppState>,
    key: &str,
    default_value: bool,
) -> Result<bool, AppError> {
    Ok(get_config_string(state, key)?
        .map(|value| value == "true")
        .unwrap_or(default_value))
}

fn get_config_array(state: &State<'_, AppState>, key: &str) -> Result<Vec<String>, AppError> {
    let Some(value) = get_config_string(state, key)? else {
        return Ok(Vec::new());
    };
    let parsed: Value = serde_json::from_str(&value).unwrap_or(Value::Null);
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

fn auth_scope_matches(state: &State<'_, AppState>, user_id: &str, endpoint: &str) -> bool {
    let auth_scope = state.backend_context.auth_scope.snapshot();
    if auth_scope.active {
        return state.backend_context.auth_scope.matches(user_id, endpoint);
    }

    let snapshot = state.backend_context.session.snapshot();
    let Some(context) = snapshot.realtime_context else {
        return true;
    };
    context.current_user_id == user_id
        && context.endpoint.trim().trim_end_matches('/') == endpoint.trim().trim_end_matches('/')
}

fn stale_favorites_output(user_id: String) -> BackendFavoritesBaselineOutput {
    BackendFavoritesBaselineOutput {
        user_id,
        stale: true,
        count: 0,
        snapshot: None,
    }
}

fn stale_friend_output(user_id: String, detail: String) -> BackendFriendRosterBaselineOutput {
    BackendFriendRosterBaselineOutput {
        user_id,
        stale: true,
        count: 0,
        detail,
        snapshot: None,
    }
}

fn build_vrchat_api_url(endpoint: &str, path: &str) -> Result<Url, AppError> {
    let base = format!("{}/", normalize_endpoint(endpoint));
    Url::parse(&base)
        .map_err(|error| AppError::Custom(format!("bad API endpoint: {error}")))?
        .join(path.trim_start_matches('/'))
        .map_err(|error| AppError::Custom(format!("bad API path: {error}")))
}

fn append_query_params(url: &mut Url, query: &[(&str, String)]) {
    for (key, value) in query {
        url.query_pairs_mut().append_pair(key, value);
    }
}

async fn execute_vrchat_json_request(
    state: &State<'_, AppState>,
    endpoint: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<Value, AppError> {
    let mut url = build_vrchat_api_url(endpoint, path)?;
    append_query_params(&mut url, query);

    let mut options = HashMap::new();
    options.insert("url".to_string(), Value::String(url.to_string()));
    options.insert("method".to_string(), Value::String("GET".to_string()));

    let (status, data) = state.web.execute(options).await?;
    state.web.save_cookies(&state.db);
    if status == -1 {
        return Err(AppError::Custom(data));
    }

    let json = parse_response_json(&data);
    if status >= 400 || response_has_error(&json) {
        return Err(AppError::Custom(unwrap_error_message(
            &json,
            status,
            "VRChat social baseline request failed",
        )));
    }

    Ok(json)
}

fn parse_response_json(data: &str) -> Value {
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

fn response_has_error(json: &Value) -> bool {
    json.as_object()
        .is_some_and(|object| object.contains_key("error"))
}

fn value_message(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.trim_matches('"').to_string())
}

fn unwrap_error_message(json: &Value, status: i32, fallback: &str) -> String {
    if let Some(message) = value_message(Some(json)) {
        return message;
    }

    let object = json.as_object();
    if let Some(message) = value_message(
        object
            .and_then(|record| record.get("error"))
            .and_then(Value::as_object)
            .and_then(|error| error.get("message")),
    ) {
        return message;
    }
    if let Some(message) = value_message(object.and_then(|record| record.get("message"))) {
        return message;
    }

    format!("{fallback} ({status})")
}

async fn fetch_paged_array(
    state: &State<'_, AppState>,
    endpoint: &str,
    path: &str,
    page_size: i64,
    max_offset: Option<i64>,
    base_query: Vec<(&str, String)>,
) -> Result<Vec<Value>, AppError> {
    let mut rows = Vec::new();
    let mut offset = 0;
    loop {
        if max_offset.is_some_and(|max_offset| offset > max_offset) {
            break;
        }
        let mut query = base_query.clone();
        query.push(("n", page_size.to_string()));
        query.push(("offset", offset.to_string()));
        let json = execute_vrchat_json_request(state, endpoint, path, &query).await?;
        let page = json.as_array().cloned().unwrap_or_default();
        let page_len = page.len();
        rows.extend(page);
        if page_len < page_size as usize {
            break;
        }
        offset += page_size;
    }
    Ok(rows)
}

fn create_default_favorite_group_ref(source: &Value) -> Value {
    let mut object = Map::new();
    object.insert("id".into(), Value::String(String::new()));
    object.insert("ownerId".into(), Value::String(String::new()));
    object.insert("ownerDisplayName".into(), Value::String(String::new()));
    object.insert("name".into(), Value::String(String::new()));
    object.insert("displayName".into(), Value::String(String::new()));
    object.insert("type".into(), Value::String(String::new()));
    object.insert("visibility".into(), Value::String(String::new()));
    object.insert("tags".into(), Value::Array(Vec::new()));
    if let Some(source) = source.as_object() {
        for (key, value) in source {
            object.insert(key.clone(), value.clone());
        }
    }
    Value::Object(object)
}

fn create_default_favorite_cached_ref(source: &Value) -> Value {
    let mut object = Map::new();
    object.insert("id".into(), Value::String(String::new()));
    object.insert("type".into(), Value::String(String::new()));
    object.insert("favoriteId".into(), Value::String(String::new()));
    object.insert("tags".into(), Value::Array(Vec::new()));
    object.insert("$groupKey".into(), Value::String(String::new()));
    if let Some(source) = source.as_object() {
        for (key, value) in source {
            object.insert(key.clone(), value.clone());
        }
    }

    let type_name = object.get("type").map(value_as_string).unwrap_or_default();
    let first_tag = object
        .get("tags")
        .and_then(Value::as_array)
        .and_then(|tags| tags.first())
        .map(js_string)
        .unwrap_or_else(|| "undefined".to_string());
    object.insert(
        "$groupKey".into(),
        Value::String(format!("{type_name}:{first_tag}")),
    );
    Value::Object(object)
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

fn default_favorite_limits() -> Value {
    json!({
        "maxFavoriteGroups": {
            "avatar": 6,
            "friend": 3,
            "vrcPlusWorld": 4,
            "world": 4
        },
        "maxFavoritesPerGroup": {
            "avatar": 50,
            "friend": 150,
            "vrcPlusWorld": 100,
            "world": 100
        }
    })
}

fn merge_favorite_limits(limits: &Value) -> Value {
    let mut merged = default_favorite_limits();
    for section in ["maxFavoriteGroups", "maxFavoritesPerGroup"] {
        let Some(source) = object_field(limits, section).and_then(Value::as_object) else {
            continue;
        };
        let target = merged
            .as_object_mut()
            .and_then(|object| object.get_mut(section))
            .and_then(Value::as_object_mut);
        if let Some(target) = target {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    merged
}

fn favorite_limit(limits: &Value, section: &str, key: &str) -> i64 {
    value_as_i64(object_field(limits, section).and_then(|value| object_field(value, key)))
}

fn build_favorite_groups_from_limits(
    favorite_limits: &Value,
) -> (
    Vec<FavoriteGroupOutput>,
    Vec<FavoriteGroupOutput>,
    Vec<FavoriteGroupOutput>,
) {
    let mut friend_groups = Vec::new();
    let mut world_groups = Vec::new();
    let mut avatar_groups = Vec::new();

    for index in 0..favorite_limit(favorite_limits, "maxFavoriteGroups", "friend") {
        friend_groups.push(FavoriteGroupOutput {
            assign: false,
            key: format!("friend:group_{index}"),
            type_name: "friend".into(),
            name: format!("group_{index}"),
            display_name: format!("Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, "maxFavoritesPerGroup", "friend"),
            count: 0,
            visibility: "private".into(),
        });
    }

    for index in 0..favorite_limit(favorite_limits, "maxFavoriteGroups", "world") {
        world_groups.push(FavoriteGroupOutput {
            assign: false,
            key: format!("world:worlds{}", index + 1),
            type_name: "world".into(),
            name: format!("worlds{}", index + 1),
            display_name: format!("Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, "maxFavoritesPerGroup", "world"),
            count: 0,
            visibility: "private".into(),
        });
    }

    for index in 0..favorite_limit(favorite_limits, "maxFavoriteGroups", "vrcPlusWorld") {
        world_groups.push(FavoriteGroupOutput {
            assign: false,
            key: format!("vrcPlusWorld:vrcPlusWorlds{}", index + 1),
            type_name: "vrcPlusWorld".into(),
            name: format!("vrcPlusWorlds{}", index + 1),
            display_name: format!("VRC+ Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, "maxFavoritesPerGroup", "vrcPlusWorld"),
            count: 0,
            visibility: "private".into(),
        });
    }

    for index in 0..favorite_limit(favorite_limits, "maxFavoriteGroups", "avatar") {
        avatar_groups.push(FavoriteGroupOutput {
            assign: false,
            key: format!("avatar:avatars{}", index + 1),
            type_name: "avatar".into(),
            name: format!("avatars{}", index + 1),
            display_name: format!("Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, "maxFavoritesPerGroup", "avatar"),
            count: 0,
            visibility: "private".into(),
        });
    }

    (friend_groups, world_groups, avatar_groups)
}

fn favorite_groups_for_type_mut<'a>(
    type_name: &str,
    friend_groups: &'a mut Vec<FavoriteGroupOutput>,
    world_groups: &'a mut Vec<FavoriteGroupOutput>,
    avatar_groups: &'a mut Vec<FavoriteGroupOutput>,
) -> Option<&'a mut Vec<FavoriteGroupOutput>> {
    match type_name {
        "friend" => Some(friend_groups),
        "world" | "vrcPlusWorld" => Some(world_groups),
        "avatar" => Some(avatar_groups),
        _ => None,
    }
}

fn assign_favorite_group_metadata(
    refs: &[Value],
    friend_groups: &mut Vec<FavoriteGroupOutput>,
    world_groups: &mut Vec<FavoriteGroupOutput>,
    avatar_groups: &mut Vec<FavoriteGroupOutput>,
) {
    let mut assignments = HashSet::new();

    for ref_value in refs {
        let ref_id = object_field_normalized(ref_value, &["id"]);
        let type_name = object_field_normalized(ref_value, &["type"]);
        let ref_name = object_field_normalized(ref_value, &["name"]);
        let display_name = object_field_string(ref_value, &["displayName"]);
        let visibility = object_field_string(ref_value, &["visibility"]);
        let Some(groups) =
            favorite_groups_for_type_mut(&type_name, friend_groups, world_groups, avatar_groups)
        else {
            continue;
        };
        for group in groups {
            if !group.assign && group.name == ref_name {
                group.assign = true;
                if !display_name.is_empty() {
                    group.display_name = display_name.clone();
                }
                if !visibility.is_empty() {
                    group.visibility = visibility.clone();
                }
                assignments.insert(ref_id.clone());
                break;
            }
        }
    }

    for ref_value in refs {
        let ref_id = object_field_normalized(ref_value, &["id"]);
        if assignments.contains(&ref_id) {
            continue;
        }
        let type_name = object_field_normalized(ref_value, &["type"]);
        let ref_name = object_field_normalized(ref_value, &["name"]);
        let display_name = object_field_string(ref_value, &["displayName"]);
        let visibility = object_field_string(ref_value, &["visibility"]);
        let Some(groups) =
            favorite_groups_for_type_mut(&type_name, friend_groups, world_groups, avatar_groups)
        else {
            continue;
        };
        for group in groups {
            if !group.assign {
                group.assign = true;
                group.key = format!("{}:{ref_name}", group.type_name);
                group.name = ref_name.clone();
                if !display_name.is_empty() {
                    group.display_name = display_name.clone();
                }
                if !visibility.is_empty() {
                    group.visibility = visibility.clone();
                }
                assignments.insert(ref_id.clone());
                break;
            }
        }
    }
}

fn count_favorite_groups(
    favorites: &Map<String, Value>,
    friend_groups: &mut [FavoriteGroupOutput],
    world_groups: &mut [FavoriteGroupOutput],
    avatar_groups: &mut [FavoriteGroupOutput],
) {
    for group in friend_groups
        .iter_mut()
        .chain(world_groups.iter_mut())
        .chain(avatar_groups.iter_mut())
    {
        group.count = 0;
    }

    for favorite in favorites.values() {
        let group_key = object_field_string(favorite, &["$groupKey"]);
        for group in friend_groups
            .iter_mut()
            .chain(world_groups.iter_mut())
            .chain(avatar_groups.iter_mut())
        {
            if group.key == group_key {
                group.count += 1;
                break;
            }
        }
    }
}

fn friend_roster_object_id(friend_roster_by_id: &Value, favorite_id: &str) -> String {
    friend_roster_by_id
        .as_object()
        .and_then(|roster| roster.get(favorite_id))
        .map(|friend| object_field_normalized(friend, &["id"]))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| favorite_id.to_string())
}

fn build_remote_favorite_snapshot(
    remote_favorites: Vec<Value>,
    friend_roster_by_id: &Value,
) -> RemoteFavoriteSnapshot {
    let mut remote_favorites_by_id = Map::new();
    let mut remote_favorites_by_object_id = Map::new();
    let mut favorites_sort_order = Vec::new();
    let mut favorite_friend_ids = Vec::new();
    let mut favorite_world_ids = Vec::new();
    let mut favorite_avatar_ids = Vec::new();
    let mut grouped_friend_ids: Map<String, Value> = Map::new();

    for json in remote_favorites {
        let favorite = create_default_favorite_cached_ref(&json);
        let id = object_field_normalized(&favorite, &["id"]);
        let favorite_id = object_field_normalized(&favorite, &["favoriteId"]);
        if id.is_empty() || favorite_id.is_empty() {
            continue;
        }

        let type_name = object_field_normalized(&favorite, &["type"]);
        let group_key = object_field_string(&favorite, &["$groupKey"]);
        remote_favorites_by_id.insert(id, favorite.clone());
        remote_favorites_by_object_id.insert(favorite_id.clone(), favorite);
        favorites_sort_order.push(favorite_id.clone());

        match type_name.as_str() {
            "friend" => {
                favorite_friend_ids.push(favorite_id.clone());
                let roster_id = friend_roster_object_id(friend_roster_by_id, &favorite_id);
                let entry = grouped_friend_ids
                    .entry(group_key)
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Value::Array(values) = entry {
                    values.push(Value::String(roster_id));
                }
            }
            "avatar" => favorite_avatar_ids.push(favorite_id),
            "world" | "vrcPlusWorld" => favorite_world_ids.push(favorite_id),
            _ => {}
        }
    }

    RemoteFavoriteSnapshot {
        remote_favorites_by_id,
        remote_favorites_by_object_id,
        favorites_sort_order,
        favorite_friend_ids,
        favorite_world_ids,
        favorite_avatar_ids,
        grouped_favorite_friend_ids_by_group_key: grouped_friend_ids,
    }
}

fn build_details_by_id(rows: Vec<Value>) -> Map<String, Value> {
    let mut details_by_id = Map::new();
    for row in rows {
        let object_id = object_field_normalized(&row, &["id"]);
        if !object_id.is_empty() {
            details_by_id.insert(object_id, row);
        }
    }
    details_by_id
}

fn ensure_local_detail_fallbacks(details_by_id: &mut Map<String, Value>, object_ids: &[String]) {
    for object_id in object_ids {
        if object_id.is_empty() || details_by_id.contains_key(object_id) {
            continue;
        }
        details_by_id.insert(object_id.clone(), json!({ "id": object_id }));
    }
}

fn build_local_grouped_ids(
    rows: Vec<Value>,
    id_field: &str,
    explicit_groups: Vec<String>,
    fallback_group: &str,
) -> (Map<String, Value>, Vec<String>, Vec<String>) {
    let mut groups = Map::new();
    let mut list = Vec::new();

    for group_name in explicit_groups {
        let group_name = normalize_text(group_name);
        if !group_name.is_empty() && !groups.contains_key(&group_name) {
            groups.insert(group_name, Value::Array(Vec::new()));
        }
    }

    for row in rows {
        let group_name = object_field_normalized(&row, &["groupName"]);
        let group_name = if group_name.is_empty() {
            fallback_group.to_string()
        } else {
            group_name
        };
        let object_id = object_field_normalized(&row, &[id_field]);
        if object_id.is_empty() {
            continue;
        }

        let entry = groups
            .entry(group_name)
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Value::Array(values) = entry {
            values.insert(0, Value::String(object_id.clone()));
        }
        list.push(object_id);
    }

    if groups.is_empty() {
        groups.insert(fallback_group.to_string(), Value::Array(Vec::new()));
    }

    let mut groups_list = groups.keys().cloned().collect::<Vec<_>>();
    groups_list.sort();
    (groups, groups_list, unique_values(list))
}

fn build_pending_favorites_detail(
    display_name: &str,
    remote_count: usize,
    local_world_count: usize,
    local_avatar_count: usize,
    local_friend_count: usize,
) -> String {
    format!(
        "Favorites baseline loaded for {display_name} ({remote_count} remote records). {local_world_count} local world favorites, {local_avatar_count} local avatar favorites, {local_friend_count} local friend favorites."
    )
}

async fn build_favorites_baseline(
    state: State<'_, AppState>,
    input: BackendFavoritesBaselineInput,
) -> Result<BackendFavoritesBaselineOutput, AppError> {
    let user_id = normalize_text(if input.user_id.is_empty() {
        object_field_string(&input.current_user_snapshot, &["id"])
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(AppError::Custom(
            "BackendFavoritesBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&state, &user_id, &input.endpoint) {
        return Ok(stale_favorites_output(user_id));
    }

    let favorite_limits_response =
        execute_vrchat_json_request(&state, &input.endpoint, "auth/user/favoritelimits", &[])
            .await?;
    let remote_favorites = fetch_paged_array(
        &state,
        &input.endpoint,
        "favorites",
        FAVORITES_PAGE_SIZE,
        None,
        Vec::new(),
    )
    .await?;
    let remote_favorite_groups = fetch_paged_array(
        &state,
        &input.endpoint,
        "favorite/groups",
        FAVORITE_GROUPS_PAGE_SIZE,
        None,
        Vec::new(),
    )
    .await?;

    let local_world_favorite_rows =
        super::super::local_data::app__favorite_list(state.clone(), "world".into())?;
    let local_avatar_favorite_rows =
        super::super::local_data::app__favorite_list(state.clone(), "avatar".into())?;
    let local_friend_favorite_rows =
        super::super::local_data::app__favorite_list(state.clone(), "friend".into())?;
    let local_world_cache_rows = serde_json::to_value(
        super::super::local_data::app__world_cache_list(state.clone())?,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();
    let local_avatar_cache_rows = serde_json::to_value(
        super::super::local_data::app__avatar_cache_list(state.clone())?,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();
    let explicit_local_world_groups = get_config_array(&state, "localFavoriteWorldGroups")?;
    let explicit_local_avatar_groups = get_config_array(&state, "localFavoriteAvatarGroups")?;
    let explicit_local_friend_groups = get_config_array(&state, "localFavoriteFriendGroups")?;

    let favorite_limits = merge_favorite_limits(&favorite_limits_response);
    let mut cached_favorite_groups_by_id = Map::new();
    let mut favorite_group_refs = Vec::new();
    for json in &remote_favorite_groups {
        let ref_value = create_default_favorite_group_ref(json);
        let id = object_field_normalized(&ref_value, &["id"]);
        if id.is_empty() {
            continue;
        }
        cached_favorite_groups_by_id.insert(id, ref_value.clone());
        favorite_group_refs.push(ref_value);
    }

    let (mut favorite_friend_groups, mut favorite_world_groups, mut favorite_avatar_groups) =
        build_favorite_groups_from_limits(&favorite_limits);
    assign_favorite_group_metadata(
        &favorite_group_refs,
        &mut favorite_friend_groups,
        &mut favorite_world_groups,
        &mut favorite_avatar_groups,
    );

    let remote_snapshot =
        build_remote_favorite_snapshot(remote_favorites, &input.friend_roster_by_id);
    count_favorite_groups(
        &remote_snapshot.remote_favorites_by_id,
        &mut favorite_friend_groups,
        &mut favorite_world_groups,
        &mut favorite_avatar_groups,
    );

    let local_world_ids = local_world_favorite_rows
        .iter()
        .map(|row| object_field_normalized(row, &["worldId"]))
        .collect::<Vec<_>>();
    let local_avatar_ids = local_avatar_favorite_rows
        .iter()
        .map(|row| object_field_normalized(row, &["avatarId"]))
        .collect::<Vec<_>>();
    let mut local_world_details_by_id = build_details_by_id(local_world_cache_rows);
    let mut local_avatar_details_by_id = build_details_by_id(local_avatar_cache_rows);
    ensure_local_detail_fallbacks(&mut local_world_details_by_id, &local_world_ids);
    ensure_local_detail_fallbacks(&mut local_avatar_details_by_id, &local_avatar_ids);

    let (local_world_favorites, local_world_favorite_groups, local_world_favorites_list) =
        build_local_grouped_ids(
            local_world_favorite_rows,
            "worldId",
            explicit_local_world_groups,
            "Favorites",
        );
    let (local_avatar_favorites, local_avatar_favorite_groups, local_avatar_favorites_list) =
        build_local_grouped_ids(
            local_avatar_favorite_rows,
            "avatarId",
            explicit_local_avatar_groups,
            "Favorites",
        );
    let (local_friend_favorites, local_friend_favorite_groups, local_friend_favorites_list) =
        build_local_grouped_ids(
            local_friend_favorite_rows,
            "userId",
            explicit_local_friend_groups,
            "Favorites",
        );

    let display_name = object_field_string(
        &input.current_user_snapshot,
        &["displayName", "username", "id"],
    );
    let display_name = if display_name.is_empty() {
        user_id.clone()
    } else {
        display_name
    };
    let detail = build_pending_favorites_detail(
        &display_name,
        remote_snapshot.remote_favorites_by_id.len(),
        local_world_favorites_list.len(),
        local_avatar_favorites_list.len(),
        local_friend_favorites_list.len(),
    );

    let snapshot = json!({
        "currentUserId": user_id.clone(),
        "favoriteLimits": favorite_limits,
        "favoritesSortOrder": remote_snapshot.favorites_sort_order,
        "remoteFavoritesById": remote_snapshot.remote_favorites_by_id,
        "remoteFavoritesByObjectId": remote_snapshot.remote_favorites_by_object_id,
        "favoriteFriendIds": remote_snapshot.favorite_friend_ids,
        "groupedFavoriteFriendIdsByGroupKey": remote_snapshot.grouped_favorite_friend_ids_by_group_key,
        "favoriteWorldIds": remote_snapshot.favorite_world_ids,
        "favoriteAvatarIds": remote_snapshot.favorite_avatar_ids,
        "cachedFavoriteGroupsById": cached_favorite_groups_by_id,
        "favoriteFriendGroups": favorite_friend_groups,
        "favoriteWorldGroups": favorite_world_groups,
        "favoriteAvatarGroups": favorite_avatar_groups,
        "localWorldFavorites": local_world_favorites,
        "localAvatarFavorites": local_avatar_favorites,
        "localFriendFavorites": local_friend_favorites,
        "localWorldFavoriteGroups": local_world_favorite_groups,
        "localAvatarFavoriteGroups": local_avatar_favorite_groups,
        "localFriendFavoriteGroups": local_friend_favorite_groups,
        "localWorldFavoritesList": local_world_favorites_list,
        "localAvatarFavoritesList": local_avatar_favorites_list,
        "localFriendFavoritesList": local_friend_favorites_list,
        "localWorldDetailsById": local_world_details_by_id,
        "localAvatarDetailsById": local_avatar_details_by_id,
        "detail": detail
    });
    let count = snapshot
        .get("remoteFavoritesById")
        .and_then(Value::as_object)
        .map_or(0, Map::len);

    if !auth_scope_matches(&state, &user_id, &input.endpoint) {
        return Ok(stale_favorites_output(user_id));
    }

    Ok(BackendFavoritesBaselineOutput {
        user_id,
        stale: false,
        count,
        snapshot: Some(snapshot),
    })
}

fn get_friend_log_init_key(user_id: &str) -> String {
    format!("friendLogInit_{user_id}")
}

fn add_state_bucket_ids(
    snapshot: &Value,
    key: &str,
    state: &str,
    state_by_id: &mut HashMap<String, String>,
    ordered_ids: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    for user_id in string_array_field(snapshot, key) {
        if user_id.is_empty() {
            continue;
        }
        unique_push(ordered_ids, seen, user_id.clone());
        state_by_id.insert(user_id, state.to_string());
    }
}

fn build_friend_state_map(snapshot: &Value) -> (HashMap<String, String>, Vec<String>) {
    let mut state_by_id = HashMap::new();
    let mut ordered_ids = Vec::new();
    let mut seen = HashSet::new();
    add_state_bucket_ids(
        snapshot,
        "friends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "offlineFriends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "activeFriends",
        "active",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "onlineFriends",
        "online",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    (state_by_id, ordered_ids)
}

fn build_snapshot_friend_ids(snapshot: &Value) -> (Vec<String>, HashSet<String>, bool) {
    let has_friend_list = object_field(snapshot, "friends").is_some_and(Value::is_array);
    let friend_ids = string_array_field(snapshot, "friends");
    let friend_set = friend_ids.iter().cloned().collect();
    (friend_ids, friend_set, has_friend_list)
}

fn encode_path_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn is_valid_friend_user(value: &Value) -> bool {
    !object_field_normalized(value, &["id"]).is_empty()
}

async fn fetch_all_friends(
    state: &State<'_, AppState>,
    endpoint: &str,
    offline: bool,
) -> Result<Vec<Value>, AppError> {
    let rows = fetch_paged_array(
        state,
        endpoint,
        "auth/user/friends",
        FRIEND_PAGE_SIZE,
        Some(FRIEND_MAX_OFFSET),
        vec![("offline", offline.to_string())],
    )
    .await?;
    Ok(rows.into_iter().filter(is_valid_friend_user).collect())
}

async fn fetch_user_profile(
    state: &State<'_, AppState>,
    endpoint: &str,
    user_id: &str,
) -> Result<Value, AppError> {
    execute_vrchat_json_request(
        state,
        endpoint,
        &format!("users/{}", encode_path_segment(user_id)),
        &[],
    )
    .await
}

async fn fetch_friend_status(
    state: &State<'_, AppState>,
    endpoint: &str,
    user_id: &str,
) -> Result<Value, AppError> {
    execute_vrchat_json_request(
        state,
        endpoint,
        &format!("user/{}/friendStatus", encode_path_segment(user_id)),
        &[],
    )
    .await
}

async fn fetch_missing_friends(
    state: &State<'_, AppState>,
    endpoint: &str,
    user_ids: Vec<String>,
) -> Vec<Value> {
    let mut recovered = Vec::new();
    for user_id in user_ids {
        match fetch_user_profile(state, endpoint, &user_id).await {
            Ok(profile) if !object_field_normalized(&profile, &["id"]).is_empty() => {
                recovered.push(profile);
            }
            _ => {}
        }
    }
    recovered
}

fn build_unfriend_history_entry(
    row: &Value,
    created_at: &str,
) -> Option<FriendLogHistoryEntryInput> {
    let user_id = object_field_normalized(row, &["userId", "user_id"]);
    if user_id.is_empty() {
        return None;
    }
    let display_name = object_field_string(row, &["displayName", "display_name"]);
    Some(FriendLogHistoryEntryInput {
        row_id: Value::Null,
        created_at: created_at.to_string(),
        r#type: "Unfriend".into(),
        user_id: user_id.clone(),
        display_name: if display_name.is_empty() {
            user_id.clone()
        } else {
            display_name
        },
        previous_display_name: String::new(),
        trust_level: String::new(),
        previous_trust_level: String::new(),
        friend_number: object_field(row, "friendNumber")
            .or_else(|| object_field(row, "$friendNumber"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

fn build_friend_history_entry(row: &Value, created_at: &str) -> Option<FriendLogHistoryEntryInput> {
    let user_id = object_field_normalized(row, &["userId", "id"]);
    if user_id.is_empty() {
        return None;
    }
    let display_name = object_field_string(row, &["displayName", "username"]);
    Some(FriendLogHistoryEntryInput {
        row_id: Value::Null,
        created_at: created_at.to_string(),
        r#type: "Friend".into(),
        user_id: user_id.clone(),
        display_name: if display_name.is_empty() {
            user_id
        } else {
            display_name
        },
        previous_display_name: String::new(),
        trust_level: object_field_string(row, &["trustLevel", "$trustLevel"]),
        previous_trust_level: String::new(),
        friend_number: object_field(row, "friendNumber")
            .or_else(|| object_field(row, "$friendNumber"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

fn build_friend_log_removal_candidates(
    current_user_id: &str,
    existing_rows: &[Value],
    fetched_friend_ids: &HashSet<String>,
    snapshot_friend_ids: &HashSet<String>,
    has_friend_list: bool,
) -> Vec<Value> {
    existing_rows
        .iter()
        .filter_map(|row| {
            let user_id = object_field_normalized(row, &["userId", "user_id"]);
            if user_id.is_empty()
                || user_id == current_user_id
                || (fetched_friend_ids.contains(&user_id)
                    && (!has_friend_list || snapshot_friend_ids.contains(&user_id)))
            {
                None
            } else {
                Some(row.clone())
            }
        })
        .collect()
}

async fn confirm_friend_log_removal_history_entries(
    state: &State<'_, AppState>,
    endpoint: &str,
    candidates: Vec<Value>,
    created_at: &str,
) -> (Vec<Value>, Vec<FriendLogHistoryEntryInput>) {
    if candidates.is_empty() || candidates.len() > FRIEND_REMOVAL_STATUS_CONFIRMATION_LIMIT {
        return (Vec::new(), Vec::new());
    }

    let mut removed_rows = Vec::new();
    let mut history_entries = Vec::new();
    for row in candidates {
        let target_user_id = object_field_normalized(&row, &["userId", "user_id"]);
        if target_user_id.is_empty() {
            continue;
        }
        let Ok(status) = fetch_friend_status(state, endpoint, &target_user_id).await else {
            continue;
        };
        if object_field(&status, "isFriend").and_then(Value::as_bool) != Some(false) {
            continue;
        }
        if let Some(entry) = build_unfriend_history_entry(&row, created_at) {
            removed_rows.push(row);
            history_entries.push(entry);
        }
    }
    (removed_rows, history_entries)
}

fn compute_trust_level(tags: &[String], developer_type: &str) -> TrustLevelInfo {
    let mut is_moderator = !developer_type.is_empty() && developer_type != "none";
    let mut is_troll = false;
    let mut is_probable_troll = false;
    let mut trust_level = "Visitor".to_string();
    let mut trust_class = "x-tag-untrusted".to_string();
    let mut trust_color_key = "untrusted".to_string();
    let mut trust_sort_num = 1.0;

    if tags.iter().any(|tag| tag == "admin_moderator") {
        is_moderator = true;
    }
    if tags.iter().any(|tag| tag == "system_troll") {
        is_troll = true;
    }
    if tags.iter().any(|tag| tag == "system_probable_troll") && !is_troll {
        is_probable_troll = true;
    }

    if tags.iter().any(|tag| tag == "system_trust_veteran") {
        trust_level = "Trusted User".into();
        trust_class = "x-tag-veteran".into();
        trust_color_key = "veteran".into();
        trust_sort_num = 5.0;
    } else if tags.iter().any(|tag| tag == "system_trust_trusted") {
        trust_level = "Known User".into();
        trust_class = "x-tag-trusted".into();
        trust_color_key = "trusted".into();
        trust_sort_num = 4.0;
    } else if tags.iter().any(|tag| tag == "system_trust_known") {
        trust_level = "User".into();
        trust_class = "x-tag-known".into();
        trust_color_key = "known".into();
        trust_sort_num = 3.0;
    } else if tags.iter().any(|tag| tag == "system_trust_basic") {
        trust_level = "New User".into();
        trust_class = "x-tag-basic".into();
        trust_color_key = "basic".into();
        trust_sort_num = 2.0;
    }

    if is_troll || is_probable_troll {
        trust_color_key = "troll".into();
        trust_sort_num += 0.1;
    }
    if is_moderator {
        trust_color_key = "vip".into();
        trust_sort_num += 0.3;
    }

    let _ = trust_color_key;
    TrustLevelInfo {
        trust_level,
        trust_class,
        trust_sort_num,
        is_moderator,
        is_troll,
        is_probable_troll,
    }
}

fn compute_user_platform(platform: &str, last_platform: &str) -> String {
    if !platform.is_empty() && platform != "offline" && platform != "web" {
        return platform.to_string();
    }
    last_platform.to_string()
}

fn number_value(value: i64) -> Value {
    Value::Number(Number::from(value))
}

fn float_value(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn fallback_friend_user(user_id: &str, existing_row: &Value) -> Value {
    let display_name = object_field_string(existing_row, &["displayName", "display_name"]);
    let display_name = if display_name.is_empty() {
        user_id.to_string()
    } else {
        display_name
    };
    json!({
        "id": user_id,
        "displayName": display_name,
        "username": "",
        "tags": [],
        "developerType": "",
        "platform": "offline",
        "last_platform": "",
        "location": "offline",
        "state": "offline"
    })
}

fn get_display_name(user: &Value) -> String {
    for key in ["displayName", "username", "id"] {
        let value = object_field_string(user, &[key]);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn get_meaningful_display_name(user: &Value, user_id: &str) -> String {
    let normalized_user_id = normalize_text(if user_id.is_empty() {
        object_field_string(user, &["id"])
    } else {
        user_id.to_string()
    });
    for key in ["displayName", "username"] {
        let display_name = object_field_normalized(user, &[key]);
        if !display_name.is_empty() && display_name != normalized_user_id {
            return display_name;
        }
    }
    String::new()
}

fn normalize_state_bucket(value: &str) -> String {
    match normalize_text(value).to_ascii_lowercase().as_str() {
        "online" => "online".into(),
        "active" => "active".into(),
        "offline" => "offline".into(),
        _ => String::new(),
    }
}

fn normalize_friend_entry(
    friend: Option<&Value>,
    state_bucket: &str,
    existing_row: &Value,
) -> Value {
    let user_id = object_field_normalized(existing_row, &["userId", "user_id"]);
    let source = friend
        .cloned()
        .unwrap_or_else(|| fallback_friend_user(&user_id, existing_row));
    let mut object = source.as_object().cloned().unwrap_or_default();
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|tags| tags.iter().map(value_as_string).collect::<Vec<_>>())
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .map(value_as_string)
        .unwrap_or_default();
    let trust = compute_trust_level(&tags, &developer_type);
    let explicit_trust_level = object
        .get("$trustLevel")
        .or_else(|| object.get("trustLevel"))
        .map(value_as_string)
        .unwrap_or_default();
    let has_trust_metadata = friend.is_some()
        && (!tags.is_empty() || !developer_type.is_empty() || !explicit_trust_level.is_empty());
    let existing_trust_level = object_field_string(existing_row, &["trustLevel", "$trustLevel"]);
    let trust_level = if !explicit_trust_level.is_empty() {
        explicit_trust_level
    } else if has_trust_metadata {
        trust.trust_level.clone()
    } else if !existing_trust_level.is_empty() {
        existing_trust_level
    } else {
        trust.trust_level.clone()
    };
    let friend_number = value_as_i64(
        object
            .get("friendNumber")
            .or_else(|| object.get("$friendNumber"))
            .or_else(|| object_field(existing_row, "friendNumber"))
            .or_else(|| object_field(existing_row, "$friendNumber")),
    );
    let source_user_id = object
        .get("id")
        .map(value_as_string)
        .unwrap_or_else(|| user_id.clone());
    let display_name = {
        let meaningful =
            get_meaningful_display_name(&Value::Object(object.clone()), &source_user_id);
        if !meaningful.is_empty() {
            meaningful
        } else {
            let existing_display_name =
                object_field_string(existing_row, &["displayName", "display_name"]);
            if !existing_display_name.is_empty() {
                existing_display_name
            } else {
                let source_display_name = get_display_name(&Value::Object(object.clone()));
                if source_display_name.is_empty() {
                    source_user_id.clone()
                } else {
                    source_display_name
                }
            }
        }
    };

    let platform = object
        .get("platform")
        .map(value_as_string)
        .unwrap_or_default();
    let last_platform = object
        .get("last_platform")
        .or_else(|| object.get("lastPlatform"))
        .map(value_as_string)
        .unwrap_or_default();

    object.insert("displayName".into(), Value::String(display_name));
    object.insert("state".into(), Value::String(state_bucket.to_string()));
    object.insert(
        "stateBucket".into(),
        Value::String(state_bucket.to_string()),
    );
    object.insert("friendNumber".into(), number_value(friend_number));
    object.insert("trustLevel".into(), Value::String(trust_level.clone()));
    object.insert("$friendNumber".into(), number_value(friend_number));
    object.insert("$trustLevel".into(), Value::String(trust_level));
    object.insert("$trustClass".into(), Value::String(trust.trust_class));
    object.insert("$trustSortNum".into(), float_value(trust.trust_sort_num));
    object.insert("$isModerator".into(), Value::Bool(trust.is_moderator));
    object.insert("$isTroll".into(), Value::Bool(trust.is_troll));
    object.insert(
        "$isProbableTroll".into(),
        Value::Bool(trust.is_probable_troll),
    );
    object.insert(
        "$platform".into(),
        Value::String(compute_user_platform(&platform, &last_platform)),
    );
    Value::Object(object)
}

fn compare_friend_entries(left: &Value, right: &Value) -> Ordering {
    let left_number = value_as_i64(
        object_field(left, "friendNumber").or_else(|| object_field(left, "$friendNumber")),
    );
    let right_number = value_as_i64(
        object_field(right, "friendNumber").or_else(|| object_field(right, "$friendNumber")),
    );
    let left_has_number = left_number > 0;
    let right_has_number = right_number > 0;

    if left_has_number != right_has_number {
        return if left_has_number {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if left_has_number && right_has_number && left_number != right_number {
        return left_number.cmp(&right_number);
    }

    let left_name = object_field_string(left, &["displayName", "id"]);
    let right_name = object_field_string(right, &["displayName", "id"]);
    let name_comparison = compare_display_text(&left_name, &right_name);
    if name_comparison != Ordering::Equal {
        return name_comparison;
    }
    compare_display_text(
        &object_field_string(left, &["id"]),
        &object_field_string(right, &["id"]),
    )
}

fn compare_display_text(left: &str, right: &str) -> Ordering {
    let left_primary = display_text_primary_key(left);
    let right_primary = display_text_primary_key(right);
    let primary = left_primary.cmp(&right_primary);
    if primary != Ordering::Equal {
        return primary;
    }

    let left_lower = left.to_lowercase();
    let right_lower = right.to_lowercase();
    let secondary = left_lower.cmp(&right_lower);
    if secondary != Ordering::Equal {
        return secondary;
    }

    left.cmp(right)
}

fn display_text_primary_key(value: &str) -> String {
    let mut output = String::new();
    for character in value.to_lowercase().chars() {
        output.push_str(match character {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'ǎ' | 'ǟ' => "a",
            'æ' => "ae",
            'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => "c",
            'ð' | 'ď' | 'đ' => "d",
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
            'ƒ' => "f",
            'ĝ' | 'ğ' | 'ġ' | 'ģ' => "g",
            'ĥ' | 'ħ' => "h",
            'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
            'ĵ' => "j",
            'ķ' | 'ĸ' => "k",
            'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => "l",
            'ñ' | 'ń' | 'ņ' | 'ň' | 'ŉ' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
            'œ' => "oe",
            'ŕ' | 'ŗ' | 'ř' => "r",
            'ś' | 'ŝ' | 'ş' | 'š' | 'ſ' => "s",
            'ß' => "ss",
            'ţ' | 'ť' | 'ŧ' => "t",
            'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
            'ŵ' => "w",
            'ý' | 'ÿ' | 'ŷ' => "y",
            'ź' | 'ż' | 'ž' => "z",
            _ => {
                output.push(character);
                continue;
            }
        });
    }
    output
}

fn build_bucket_ids(
    included_ids: &[String],
    friends_by_id: &Map<String, Value>,
    state_bucket: &str,
) -> Vec<String> {
    let mut ids = included_ids
        .iter()
        .filter(|user_id| {
            friends_by_id
                .get(*user_id)
                .map(|friend| object_field_string(friend, &["stateBucket"]) == state_bucket)
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    ids.sort_by(|left_id, right_id| {
        let left = friends_by_id.get(left_id).unwrap_or(&Value::Null);
        let right = friends_by_id.get(right_id).unwrap_or(&Value::Null);
        compare_friend_entries(left, right)
    });
    ids
}

fn current_entry_value(
    user_id: &str,
    display_name: &str,
    trust_level: &str,
    friend_number: i64,
) -> Value {
    json!({
        "userId": user_id,
        "displayName": display_name,
        "trustLevel": trust_level,
        "friendNumber": friend_number
    })
}

async fn build_friend_roster_baseline(
    state: State<'_, AppState>,
    input: BackendFriendRosterBaselineInput,
) -> Result<BackendFriendRosterBaselineOutput, AppError> {
    let user_id = normalize_text(if input.user_id.is_empty() {
        object_field_string(&input.current_user_snapshot, &["id"])
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(AppError::Custom(
            "BackendFriendRosterBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&state, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    let (state_by_id, state_order_ids) = build_friend_state_map(&input.current_user_snapshot);
    let (snapshot_friend_ids, snapshot_friend_id_set, has_friend_list) =
        build_snapshot_friend_ids(&input.current_user_snapshot);
    let mut expected_ids = Vec::new();
    let mut expected_seen = HashSet::new();
    extend_unique(&mut expected_ids, &mut expected_seen, state_order_ids);
    extend_unique(
        &mut expected_ids,
        &mut expected_seen,
        snapshot_friend_ids.clone(),
    );

    let friend_log_initialized =
        get_config_bool(&state, &get_friend_log_init_key(&user_id), false)?;
    let online_friends = fetch_all_friends(&state, &input.endpoint, false).await?;
    let offline_friends = fetch_all_friends(&state, &input.endpoint, true).await?;
    let mut fetched_friends_by_id: HashMap<String, Value> = HashMap::new();
    let mut fetched_friend_ids_ordered = Vec::new();
    let mut fetched_friend_ids_seen = HashSet::new();
    for friend in online_friends.into_iter().chain(offline_friends) {
        let friend_id = object_field_normalized(&friend, &["id"]);
        if friend_id.is_empty() {
            continue;
        }
        unique_push(
            &mut fetched_friend_ids_ordered,
            &mut fetched_friend_ids_seen,
            friend_id.clone(),
        );
        fetched_friends_by_id.insert(friend_id, friend);
    }

    let missing_ids = expected_ids
        .iter()
        .filter(|friend_id| {
            !friend_log_initialized && !fetched_friends_by_id.contains_key(*friend_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    for friend in fetch_missing_friends(&state, &input.endpoint, missing_ids).await {
        let friend_id = object_field_normalized(&friend, &["id"]);
        if friend_id.is_empty() {
            continue;
        }
        unique_push(
            &mut fetched_friend_ids_ordered,
            &mut fetched_friend_ids_seen,
            friend_id.clone(),
        );
        fetched_friends_by_id.insert(friend_id, friend);
    }

    let existing_rows = serde_json::to_value(
        super::super::local_data::app__friend_log_current_list(state.clone(), user_id.clone())?,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();
    let mut existing_rows_by_id = HashMap::new();
    let mut existing_ids = Vec::new();
    let mut existing_seen = HashSet::new();
    for row in &existing_rows {
        let existing_user_id = object_field_normalized(row, &["userId", "user_id"]);
        if existing_user_id.is_empty() {
            continue;
        }
        unique_push(
            &mut existing_ids,
            &mut existing_seen,
            existing_user_id.clone(),
        );
        existing_rows_by_id.insert(existing_user_id, row.clone());
    }

    let fetched_friend_ids = fetched_friends_by_id
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    let reconciliation_created_at = now_iso();
    let (removed_rows, history_entries) = if friend_log_initialized {
        confirm_friend_log_removal_history_entries(
            &state,
            &input.endpoint,
            build_friend_log_removal_candidates(
                &user_id,
                &existing_rows,
                &fetched_friend_ids,
                &snapshot_friend_id_set,
                has_friend_list,
            ),
            &reconciliation_created_at,
        )
        .await
    } else {
        (Vec::new(), Vec::new())
    };
    let removed_friend_ids = removed_rows
        .iter()
        .map(|row| object_field_normalized(row, &["userId", "user_id"]))
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();

    let mut included_ids = Vec::new();
    let mut included_seen = HashSet::new();
    if friend_log_initialized {
        extend_unique(&mut included_ids, &mut included_seen, existing_ids);
        if has_friend_list {
            extend_unique(
                &mut included_ids,
                &mut included_seen,
                snapshot_friend_ids.clone(),
            );
        }
        extend_unique(
            &mut included_ids,
            &mut included_seen,
            fetched_friend_ids_ordered,
        );
        included_ids.retain(|friend_id| !removed_friend_ids.contains(friend_id));
    } else {
        extend_unique(&mut included_ids, &mut included_seen, existing_ids);
        extend_unique(&mut included_ids, &mut included_seen, expected_ids);
        extend_unique(
            &mut included_ids,
            &mut included_seen,
            fetched_friend_ids_ordered,
        );
    }

    let friend_order_source_ids = if !snapshot_friend_ids.is_empty() {
        snapshot_friend_ids
    } else {
        included_ids.clone()
    };
    let friend_order_numbers = friend_order_source_ids
        .iter()
        .enumerate()
        .map(|(index, friend_id)| (friend_id.clone(), (index + 1) as i64))
        .collect::<HashMap<_, _>>();
    let explicit_add_intent_user_ids = input
        .explicit_add_intent_user_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();

    let mut friends_by_id = Map::new();
    let mut friend_log_rows = Vec::new();
    let mut added_history_entries = Vec::new();

    for friend_id in &included_ids {
        let friend = fetched_friends_by_id.get(friend_id);
        let mut existing_row = existing_rows_by_id
            .get(friend_id)
            .cloned()
            .unwrap_or_else(|| {
                json!({
                    "userId": friend_id,
                    "displayName": friend.map(get_display_name).filter(|name| !name.is_empty()).unwrap_or_else(|| friend_id.clone()),
                    "trustLevel": "Visitor",
                    "friendNumber": 0
                })
            });
        if value_as_i64(
            object_field(&existing_row, "friendNumber")
                .or_else(|| object_field(&existing_row, "$friendNumber")),
        ) <= 0
        {
            if let Some(number) = friend_order_numbers.get(friend_id) {
                if let Some(object) = existing_row.as_object_mut() {
                    object.insert("friendNumber".into(), number_value(*number));
                }
            }
        }

        let state_bucket = state_by_id
            .get(friend_id)
            .cloned()
            .or_else(|| {
                friend.map(|friend| {
                    normalize_state_bucket(&object_field_string(friend, &["stateBucket"]))
                })
            })
            .filter(|value| !value.is_empty())
            .or_else(|| {
                friend
                    .map(|friend| normalize_state_bucket(&object_field_string(friend, &["state"])))
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "offline".into());
        let normalized_friend = normalize_friend_entry(friend, &state_bucket, &existing_row);
        friends_by_id.insert(friend_id.clone(), normalized_friend.clone());

        let display_name = object_field_string(&normalized_friend, &["displayName"]);
        let trust_level = object_field_string(&normalized_friend, &["$trustLevel"]);
        let friend_number = value_as_i64(
            object_field(&normalized_friend, "$friendNumber")
                .or_else(|| object_field(&normalized_friend, "friendNumber")),
        );
        let friend_log_row =
            current_entry_value(friend_id, &display_name, &trust_level, friend_number);
        friend_log_rows.push(FriendLogCurrentEntryInput {
            user_id: friend_id.clone(),
            display_name,
            trust_level: Some(trust_level),
            friend_number: number_value(friend_number),
        });

        if friend_log_initialized
            && friend_id != &user_id
            && !existing_rows_by_id.contains_key(friend_id)
            && !explicit_add_intent_user_ids.contains(friend_id)
        {
            if let Some(entry) =
                build_friend_history_entry(&friend_log_row, &reconciliation_created_at)
            {
                added_history_entries.push(entry);
            }
        }
    }

    if added_history_entries.len() > FRIEND_ADDITION_RECONCILIATION_LIMIT {
        added_history_entries.clear();
    }

    let online_ids = build_bucket_ids(&included_ids, &friends_by_id, "online");
    let active_ids = build_bucket_ids(&included_ids, &friends_by_id, "active");
    let offline_ids = build_bucket_ids(&included_ids, &friends_by_id, "offline");
    let mut ordered_friend_ids = Vec::new();
    ordered_friend_ids.extend(online_ids.clone());
    ordered_friend_ids.extend(active_ids.clone());
    ordered_friend_ids.extend(offline_ids.clone());

    if !auth_scope_matches(&state, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    super::super::local_data::app__friend_log_replace_current(
        state.clone(),
        user_id.clone(),
        friend_log_rows,
        FriendLogReplaceOptionsInput {
            history_entries,
            added_history_entries,
        },
    )?;
    super::super::local_data::app__config_set_values(
        state,
        vec![ConfigWriteEntry {
            key: get_friend_log_init_key(&user_id),
            value: "true".into(),
        }],
    )?;

    let detail = String::new();
    let snapshot = json!({
        "currentUserId": user_id.clone(),
        "friendsById": friends_by_id,
        "orderedFriendIds": ordered_friend_ids,
        "onlineIds": online_ids,
        "activeIds": active_ids,
        "offlineIds": offline_ids,
        "detail": detail.clone()
    });
    let count = snapshot
        .get("orderedFriendIds")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    Ok(BackendFriendRosterBaselineOutput {
        user_id,
        stale: false,
        count,
        detail,
        snapshot: Some(snapshot),
    })
}

#[tauri::command]
pub async fn app__backend_favorites_baseline_get(
    state: State<'_, AppState>,
    input: BackendFavoritesBaselineInput,
) -> Result<BackendFavoritesBaselineOutput, AppError> {
    let command = "app__backend_favorites_baseline_get";
    let diagnostics = state.backend_context.diagnostics.clone();
    let sync = state.backend_context.sync.clone();
    diagnostics.record_command(command, "running", "Favorites baseline started.");

    let result = build_favorites_baseline(state, input).await;
    match &result {
        Ok(output) => {
            let status = if output.stale { "stale" } else { "ok" };
            let sync_status = if output.stale { "stale" } else { "ready" };
            diagnostics.record_command(
                command,
                status,
                format!(
                    "user={} stale={} count={}",
                    output.user_id, output.stale, output.count
                ),
            );
            sync.record(
                "favorites",
                sync_status,
                if output.stale {
                    format!(
                        "Favorites baseline skipped stale request for {}.",
                        output.user_id
                    )
                } else {
                    format!("Favorites baseline loaded for {}.", output.user_id)
                },
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("favorites", error.to_string());
        }
    }

    result
}

#[tauri::command]
pub async fn app__backend_friend_roster_baseline_get(
    state: State<'_, AppState>,
    input: BackendFriendRosterBaselineInput,
) -> Result<BackendFriendRosterBaselineOutput, AppError> {
    let command = "app__backend_friend_roster_baseline_get";
    let diagnostics = state.backend_context.diagnostics.clone();
    let sync = state.backend_context.sync.clone();
    diagnostics.record_command(command, "running", "Friend roster baseline started.");

    let result = build_friend_roster_baseline(state, input).await;
    match &result {
        Ok(output) => {
            let status = if output.stale { "stale" } else { "ok" };
            let sync_status = if output.stale { "stale" } else { "ready" };
            diagnostics.record_command(
                command,
                status,
                format!(
                    "user={} stale={} count={}",
                    output.user_id, output.stale, output.count
                ),
            );
            sync.record(
                "friends",
                sync_status,
                if output.stale {
                    format!(
                        "Friend roster baseline skipped stale request for {}.",
                        output.user_id
                    )
                } else {
                    format!("Friend roster baseline loaded for {}.", output.user_id)
                },
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("friends", error.to_string());
        }
    }

    result
}
