use std::collections::{HashMap, HashSet};

use serde_json::Value;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::{FavoriteRow, LocalFavoriteGroup};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::FavoriteEntityKind;

use super::{
    auth_scope_matches, execute_vrchat_json_request, fetch_paged_array, json, normalize_endpoint,
    normalize_text, object_field, object_field_normalized, object_field_string,
    stale_favorites_output, unique_values, value_as_i64, value_as_string, BTreeMap, Map, RawJson,
    SocialBaselineDeps, SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput,
    SocialFavoritesBaselineRequest, FAVORITES_PAGE_SIZE, FAVORITE_GROUPS_PAGE_SIZE,
};
use crate::social_baseline::types::{FavoriteBaselineSnapshot, FavoriteGroupOutput};
use vrcx_0_core::OwnerId;

const MAX_FAVORITE_GROUPS_KEY: &str = "maxFavoriteGroups";
const MAX_FAVORITES_PER_GROUP_KEY: &str = "maxFavoritesPerGroup";

#[derive(Default)]
struct FavoriteGroupSets {
    friends: Vec<FavoriteGroupOutput>,
    worlds: Vec<FavoriteGroupOutput>,
    avatars: Vec<FavoriteGroupOutput>,
}

impl FavoriteGroupSets {
    fn for_type_mut(&mut self, type_name: &str) -> Option<&mut Vec<FavoriteGroupOutput>> {
        match type_name {
            "friend" => Some(&mut self.friends),
            "world" | "vrcPlusWorld" => Some(&mut self.worlds),
            "avatar" => Some(&mut self.avatars),
            _ => None,
        }
    }

    fn iter_mut(&mut self) -> impl Iterator<Item = &mut FavoriteGroupOutput> {
        self.friends
            .iter_mut()
            .chain(self.worlds.iter_mut())
            .chain(self.avatars.iter_mut())
    }
}

struct RemoteFavoriteRef {
    group_key: String,
    raw: Value,
}

struct RemoteFavoriteSnapshot {
    remote_favorites_by_id: BTreeMap<String, RemoteFavoriteRef>,
    favorites_sort_order: Vec<String>,
    favorite_friend_ids: Vec<String>,
    favorite_world_ids: Vec<String>,
    favorite_avatar_ids: Vec<String>,
    grouped_favorite_friend_ids_by_group_key: BTreeMap<String, Vec<String>>,
    grouped_favorite_world_ids_by_group_key: BTreeMap<String, Vec<String>>,
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
    for section in [MAX_FAVORITE_GROUPS_KEY, MAX_FAVORITES_PER_GROUP_KEY] {
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

fn build_favorite_groups_from_limits(favorite_limits: &Value) -> FavoriteGroupSets {
    let mut groups = FavoriteGroupSets::default();

    for index in 0..favorite_limit(favorite_limits, MAX_FAVORITE_GROUPS_KEY, "friend") {
        groups.friends.push(FavoriteGroupOutput {
            assign: false,
            key: format!("friend:group_{index}"),
            type_name: "friend".into(),
            name: format!("group_{index}"),
            display_name: format!("Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, MAX_FAVORITES_PER_GROUP_KEY, "friend"),
            count: 0,
            visibility: "private".into(),
        });
    }

    for index in 0..favorite_limit(favorite_limits, MAX_FAVORITE_GROUPS_KEY, "world") {
        groups.worlds.push(FavoriteGroupOutput {
            assign: false,
            key: format!("world:worlds{}", index + 1),
            type_name: "world".into(),
            name: format!("worlds{}", index + 1),
            display_name: format!("Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, MAX_FAVORITES_PER_GROUP_KEY, "world"),
            count: 0,
            visibility: "private".into(),
        });
    }

    for index in 0..favorite_limit(favorite_limits, MAX_FAVORITE_GROUPS_KEY, "vrcPlusWorld") {
        groups.worlds.push(FavoriteGroupOutput {
            assign: false,
            key: format!("vrcPlusWorld:vrcPlusWorlds{}", index + 1),
            type_name: "vrcPlusWorld".into(),
            name: format!("vrcPlusWorlds{}", index + 1),
            display_name: format!("VRC+ Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, MAX_FAVORITES_PER_GROUP_KEY, "vrcPlusWorld"),
            count: 0,
            visibility: "private".into(),
        });
    }

    for index in 0..favorite_limit(favorite_limits, MAX_FAVORITE_GROUPS_KEY, "avatar") {
        groups.avatars.push(FavoriteGroupOutput {
            assign: false,
            key: format!("avatar:avatars{}", index + 1),
            type_name: "avatar".into(),
            name: format!("avatars{}", index + 1),
            display_name: format!("Group {}", index + 1),
            capacity: favorite_limit(favorite_limits, MAX_FAVORITES_PER_GROUP_KEY, "avatar"),
            count: 0,
            visibility: "private".into(),
        });
    }

    groups
}

fn assign_favorite_group_metadata(refs: &[Value], groups: &mut FavoriteGroupSets) {
    let mut assignments = HashSet::new();

    for ref_value in refs {
        let ref_id = object_field_normalized(ref_value, &["id"]);
        let type_name = object_field_normalized(ref_value, &["type"]);
        let ref_name = object_field_normalized(ref_value, &["name"]);
        let display_name = object_field_string(ref_value, &["displayName"]);
        let visibility = object_field_string(ref_value, &["visibility"]);
        let Some(groups) = groups.for_type_mut(&type_name) else {
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
        let Some(groups) = groups.for_type_mut(&type_name) else {
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
    favorites: &BTreeMap<String, RemoteFavoriteRef>,
    groups: &mut FavoriteGroupSets,
) {
    for group in groups.iter_mut() {
        group.count = 0;
    }

    for favorite in favorites.values() {
        for group in groups.iter_mut() {
            if group.key == favorite.group_key {
                group.count += 1;
                break;
            }
        }
    }
}

enum FriendRosterView<'a> {
    Raw(&'a Value),
    Typed(&'a HashMap<String, FriendRecord>),
    Ids(&'a HashMap<String, String>),
}

impl<'a> FriendRosterView<'a> {
    fn object_id(&self, favorite_id: &str) -> String {
        let object_id = match self {
            Self::Raw(raw) => raw
                .as_object()
                .and_then(|roster| roster.get(favorite_id))
                .map(|friend| object_field_normalized(friend, &["id"]))
                .unwrap_or_default(),
            Self::Typed(friends_by_id) => friends_by_id
                .get(favorite_id)
                .map(|friend| friend.id.trim().to_string())
                .unwrap_or_default(),
            Self::Ids(friend_ids_by_roster_id) => friend_ids_by_roster_id
                .get(favorite_id)
                .map(|friend_id| friend_id.trim().to_string())
                .unwrap_or_default(),
        };
        if object_id.is_empty() {
            favorite_id.to_string()
        } else {
            object_id
        }
    }
}

fn build_remote_favorite_snapshot(
    remote_favorites: Vec<Value>,
    friend_roster: &FriendRosterView<'_>,
) -> RemoteFavoriteSnapshot {
    let mut remote_favorites_by_id = BTreeMap::new();
    let mut favorites_sort_order = Vec::new();
    let mut favorite_friend_ids = Vec::new();
    let mut favorite_world_ids = Vec::new();
    let mut favorite_avatar_ids = Vec::new();
    let mut grouped_friend_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut grouped_world_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for json in remote_favorites {
        let favorite = create_default_favorite_cached_ref(&json);
        let id = object_field_normalized(&favorite, &["id"]);
        let favorite_id = object_field_normalized(&favorite, &["favoriteId"]);
        if id.is_empty() || favorite_id.is_empty() {
            continue;
        }

        let type_name = object_field_normalized(&favorite, &["type"]);
        let group_key = object_field_string(&favorite, &["$groupKey"]);
        let remote_ref = RemoteFavoriteRef {
            group_key: group_key.clone(),
            raw: favorite,
        };
        remote_favorites_by_id.insert(id, remote_ref);
        favorites_sort_order.push(favorite_id.clone());

        match type_name.as_str() {
            "friend" => {
                favorite_friend_ids.push(favorite_id.clone());
                let roster_id = friend_roster.object_id(&favorite_id);
                grouped_friend_ids
                    .entry(group_key)
                    .or_default()
                    .push(roster_id);
            }
            "avatar" => favorite_avatar_ids.push(favorite_id),
            "world" | "vrcPlusWorld" => {
                favorite_world_ids.push(favorite_id.clone());
                grouped_world_ids
                    .entry(group_key)
                    .or_default()
                    .push(favorite_id);
            }
            _ => {}
        }
    }

    RemoteFavoriteSnapshot {
        remote_favorites_by_id,
        favorites_sort_order,
        favorite_friend_ids,
        favorite_world_ids,
        favorite_avatar_ids,
        grouped_favorite_friend_ids_by_group_key: grouped_friend_ids,
        grouped_favorite_world_ids_by_group_key: grouped_world_ids,
    }
}

fn build_local_grouped_ids(
    rows: Vec<FavoriteRow>,
    groups: &[LocalFavoriteGroup],
) -> (BTreeMap<String, Vec<String>>, Vec<String>) {
    let mut grouped: BTreeMap<String, Vec<String>> = groups
        .iter()
        .map(|group| (group.id.to_string(), Vec::new()))
        .collect();
    let mut list = Vec::new();
    for row in rows {
        let object_id = normalize_text(row.entity_id());
        if object_id.is_empty() {
            continue;
        }
        if let Some(ids) = grouped.get_mut(&row.group_id.to_string()) {
            ids.insert(0, object_id.clone());
            list.push(object_id);
        }
    }
    (grouped, unique_values(list))
}

fn remote_favorite_refs_into_json(
    favorites: BTreeMap<String, RemoteFavoriteRef>,
) -> BTreeMap<String, RawJson> {
    favorites
        .into_iter()
        .map(|(key, favorite)| (key, RawJson::from(favorite.raw)))
        .collect()
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

pub async fn build_favorites_baseline(
    deps: SocialBaselineDeps,
    input: SocialFavoritesBaselineInput,
) -> Result<SocialFavoritesBaselineOutput> {
    let SocialFavoritesBaselineInput {
        user_id,
        endpoint,
        current_user_snapshot,
        friend_roster_by_id,
    } = input;
    build_favorites_baseline_inner(
        deps,
        SocialFavoritesBaselineRequest {
            user_id,
            endpoint,
            current_user_snapshot,
        },
        FriendRosterView::Raw(friend_roster_by_id.as_value()),
    )
    .await
}

pub async fn build_favorites_baseline_from_friend_records(
    deps: SocialBaselineDeps,
    request: SocialFavoritesBaselineRequest,
    friends_by_id: &HashMap<String, FriendRecord>,
) -> Result<SocialFavoritesBaselineOutput> {
    build_favorites_baseline_inner(deps, request, FriendRosterView::Typed(friends_by_id)).await
}

pub async fn build_favorites_baseline_from_friend_ids(
    deps: SocialBaselineDeps,
    request: SocialFavoritesBaselineRequest,
    friend_ids_by_roster_id: &HashMap<String, String>,
) -> Result<SocialFavoritesBaselineOutput> {
    build_favorites_baseline_inner(
        deps,
        request,
        FriendRosterView::Ids(friend_ids_by_roster_id),
    )
    .await
}

async fn build_favorites_baseline_inner(
    deps: SocialBaselineDeps,
    request: SocialFavoritesBaselineRequest,
    friend_roster: FriendRosterView<'_>,
) -> Result<SocialFavoritesBaselineOutput> {
    let user_id = normalize_text(if request.user_id.is_empty() {
        object_field_string(request.current_user_snapshot.as_value(), &["id"])
    } else {
        request.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(Error::Custom(
            "SocialFavoritesBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&deps, &user_id, &request.endpoint) {
        return Ok(stale_favorites_output(user_id));
    }

    let favorite_limits_response = execute_vrchat_json_request(
        &deps,
        deps.remote_requests
            .favorite_limits(normalize_endpoint(&request.endpoint))?,
    )
    .await?;
    let remote_favorites = fetch_paged_array(&deps, FAVORITES_PAGE_SIZE, None, |n, offset| {
        deps.remote_requests
            .favorites(normalize_endpoint(&request.endpoint), n, offset)
    })
    .await?;
    let remote_favorite_groups =
        fetch_paged_array(&deps, FAVORITE_GROUPS_PAGE_SIZE, None, |n, offset| {
            deps.remote_requests
                .favorite_groups(normalize_endpoint(&request.endpoint), n, offset)
        })
        .await?;

    let owner = OwnerId::new(user_id.clone());
    let local_rows = |kind| deps.favorites.favorite_list(Some(&owner), kind);
    let local_groups = |kind| deps.favorites.favorite_group_list(Some(&owner), kind);
    let local_world_favorite_rows = local_rows(FavoriteEntityKind::World)?;
    let local_avatar_favorite_rows = local_rows(FavoriteEntityKind::Avatar)?;
    let local_friend_favorite_rows = local_rows(FavoriteEntityKind::Friend)?;
    let local_world_favorite_groups = local_groups(FavoriteEntityKind::World)?;
    let local_avatar_favorite_groups = local_groups(FavoriteEntityKind::Avatar)?;
    let local_friend_favorite_groups = local_groups(FavoriteEntityKind::Friend)?;

    let favorite_limits = merge_favorite_limits(&favorite_limits_response);
    let mut cached_favorite_groups_by_id = BTreeMap::new();
    let mut favorite_group_refs = Vec::new();
    for json in &remote_favorite_groups {
        let ref_value = create_default_favorite_group_ref(json);
        let id = object_field_normalized(&ref_value, &["id"]);
        if id.is_empty() {
            continue;
        }
        cached_favorite_groups_by_id.insert(id, RawJson::from(ref_value.clone()));
        favorite_group_refs.push(ref_value);
    }

    let mut favorite_groups = build_favorite_groups_from_limits(&favorite_limits);
    assign_favorite_group_metadata(&favorite_group_refs, &mut favorite_groups);

    let remote_snapshot = build_remote_favorite_snapshot(remote_favorites, &friend_roster);
    count_favorite_groups(
        &remote_snapshot.remote_favorites_by_id,
        &mut favorite_groups,
    );

    let (local_world_favorites, local_world_favorites_list) =
        build_local_grouped_ids(local_world_favorite_rows, &local_world_favorite_groups);
    let (local_avatar_favorites, local_avatar_favorites_list) =
        build_local_grouped_ids(local_avatar_favorite_rows, &local_avatar_favorite_groups);
    let (local_friend_favorites, local_friend_favorites_list) =
        build_local_grouped_ids(local_friend_favorite_rows, &local_friend_favorite_groups);

    let display_name = object_field_string(
        request.current_user_snapshot.as_value(),
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
    let FavoriteGroupSets {
        friends: favorite_friend_groups,
        worlds: favorite_world_groups,
        avatars: favorite_avatar_groups,
    } = favorite_groups;

    let count = remote_snapshot.remote_favorites_by_id.len();
    let snapshot = FavoriteBaselineSnapshot {
        current_user_id: user_id.clone(),
        favorite_limits: RawJson::from(favorite_limits),
        favorites_sort_order: remote_snapshot.favorites_sort_order,
        remote_favorites_by_id: remote_favorite_refs_into_json(
            remote_snapshot.remote_favorites_by_id,
        ),
        favorite_friend_ids: remote_snapshot.favorite_friend_ids,
        grouped_favorite_friend_ids_by_group_key: remote_snapshot
            .grouped_favorite_friend_ids_by_group_key,
        favorite_world_ids: remote_snapshot.favorite_world_ids,
        grouped_favorite_world_ids_by_group_key: remote_snapshot
            .grouped_favorite_world_ids_by_group_key,
        favorite_avatar_ids: remote_snapshot.favorite_avatar_ids,
        cached_favorite_groups_by_id,
        favorite_friend_groups,
        favorite_world_groups,
        favorite_avatar_groups,
        local_world_favorites,
        local_avatar_favorites,
        local_friend_favorites,
        local_avatar_favorite_groups,
        local_friend_favorite_groups,
        local_avatar_favorites_list,
        local_friend_favorites_list,
        detail,
    };

    if !auth_scope_matches(&deps, &user_id, &request.endpoint) {
        return Ok(stale_favorites_output(user_id));
    }

    Ok(SocialFavoritesBaselineOutput {
        user_id,
        stale: false,
        count: u32::try_from(count).unwrap_or(u32::MAX),
        snapshot: Some(snapshot),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avatar_row(avatar_id: &str, group_id: i64) -> FavoriteRow {
        FavoriteRow::new(
            FavoriteEntityKind::Avatar,
            String::new(),
            avatar_id.into(),
            group_id,
            String::new(),
        )
    }

    fn avatar_group(id: i64) -> LocalFavoriteGroup {
        LocalFavoriteGroup {
            id,
            kind: FavoriteEntityKind::Avatar,
            name: format!("group {id}"),
            shared: false,
        }
    }

    #[test]
    fn local_groups_are_keyed_by_group_id_with_newest_members_first() {
        let (groups, list) = build_local_grouped_ids(
            vec![
                avatar_row("avtr_1", 7),
                avatar_row("avtr_2", 7),
                avatar_row("avtr_3", 99),
            ],
            &[avatar_group(7), avatar_group(8)],
        );

        assert_eq!(groups["7"], vec!["avtr_2", "avtr_1"]);
        assert!(groups["8"].is_empty());
        assert_eq!(list, vec!["avtr_1", "avtr_2"]);
    }
}
