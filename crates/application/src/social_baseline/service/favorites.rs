use super::*;

use serde::Serialize;

const MAX_FAVORITE_GROUPS_KEY: &str = "maxFavoriteGroups";
const MAX_FAVORITES_PER_GROUP_KEY: &str = "maxFavoritesPerGroup";

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct FavoriteGroupOutput {
    assign: bool,
    key: String,
    #[serde(rename = "type")]
    type_name: String,
    name: String,
    display_name: String,
    capacity: i64,
    count: i64,
    visibility: String,
}

#[derive(Clone, Debug, Default)]
struct RemoteFavoriteRef {
    id: String,
    favorite_id: String,
    group_key: String,
    raw: Value,
}

#[derive(Clone, Debug, Default)]
struct RemoteFavoriteSnapshot {
    remote_favorites_by_id: BTreeMap<String, RemoteFavoriteRef>,
    remote_favorites_by_object_id: BTreeMap<String, RemoteFavoriteRef>,
    favorites_sort_order: Vec<String>,
    favorite_friend_ids: Vec<String>,
    favorite_world_ids: Vec<String>,
    favorite_avatar_ids: Vec<String>,
    grouped_favorite_friend_ids_by_group_key: BTreeMap<String, Vec<String>>,
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

    for index in 0..favorite_limit(favorite_limits, MAX_FAVORITE_GROUPS_KEY, "friend") {
        friend_groups.push(FavoriteGroupOutput {
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
        world_groups.push(FavoriteGroupOutput {
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
        world_groups.push(FavoriteGroupOutput {
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
        avatar_groups.push(FavoriteGroupOutput {
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
    favorites: &BTreeMap<String, RemoteFavoriteRef>,
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
        for group in friend_groups
            .iter_mut()
            .chain(world_groups.iter_mut())
            .chain(avatar_groups.iter_mut())
        {
            if group.key == favorite.group_key {
                group.count += 1;
                break;
            }
        }
    }
}

struct FriendRosterView<'a> {
    raw: &'a Value,
}

impl<'a> FriendRosterView<'a> {
    fn new(raw: &'a Value) -> Self {
        Self { raw }
    }

    fn object_id(&self, favorite_id: &str) -> String {
        self.raw
            .as_object()
            .and_then(|roster| roster.get(favorite_id))
            .map(|friend| object_field_normalized(friend, &["id"]))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| favorite_id.to_string())
    }
}

pub(super) struct CurrentUserSnapshotView {
    pub(super) user_id: String,
    pub(super) state_by_id: HashMap<String, String>,
    pub(super) state_order_ids: Vec<String>,
    pub(super) friend_ids: Vec<String>,
    pub(super) has_friend_list: bool,
}

impl CurrentUserSnapshotView {
    pub(super) fn from_raw(snapshot: &Value) -> Self {
        let (state_by_id, state_order_ids) = build_friend_state_map(snapshot);
        let (friend_ids, _, has_friend_list) = build_snapshot_friend_ids(snapshot);
        Self {
            user_id: object_field_string(snapshot, &["id"]),
            state_by_id,
            state_order_ids,
            friend_ids,
            has_friend_list,
        }
    }
}

fn build_remote_favorite_snapshot(
    remote_favorites: Vec<Value>,
    friend_roster: &FriendRosterView<'_>,
) -> RemoteFavoriteSnapshot {
    let mut remote_favorites_by_id = BTreeMap::new();
    let mut remote_favorites_by_object_id = BTreeMap::new();
    let mut favorites_sort_order = Vec::new();
    let mut favorite_friend_ids = Vec::new();
    let mut favorite_world_ids = Vec::new();
    let mut favorite_avatar_ids = Vec::new();
    let mut grouped_friend_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();

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
            id: id.clone(),
            favorite_id: favorite_id.clone(),
            group_key: group_key.clone(),
            raw: favorite,
        };
        remote_favorites_by_id.insert(id, remote_ref.clone());
        remote_favorites_by_object_id.insert(favorite_id.clone(), remote_ref);
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
) -> (BTreeMap<String, Vec<String>>, Vec<String>, Vec<String>) {
    let mut groups = BTreeMap::new();
    let mut list = Vec::new();

    for group_name in explicit_groups {
        let group_name = normalize_text(group_name);
        if !group_name.is_empty() && !groups.contains_key(&group_name) {
            groups.insert(group_name, Vec::new());
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

        groups
            .entry(group_name)
            .or_default()
            .insert(0, object_id.clone());
        list.push(object_id);
    }

    if groups.is_empty() {
        groups.insert(fallback_group.to_string(), Vec::new());
    }

    let mut groups_list = groups.keys().cloned().collect::<Vec<_>>();
    groups_list.sort();
    (groups, groups_list, unique_values(list))
}

fn remote_favorite_refs_to_json(
    favorites: &BTreeMap<String, RemoteFavoriteRef>,
) -> Map<String, Value> {
    favorites
        .iter()
        .map(|(key, favorite)| {
            debug_assert_eq!(favorite.id, *key);
            (key.clone(), favorite.raw.clone())
        })
        .collect()
}

fn remote_favorite_refs_by_object_id_to_json(
    favorites: &BTreeMap<String, RemoteFavoriteRef>,
) -> Map<String, Value> {
    favorites
        .iter()
        .map(|(key, favorite)| {
            debug_assert_eq!(favorite.favorite_id, *key);
            (key.clone(), favorite.raw.clone())
        })
        .collect()
}

fn string_groups_to_json(groups: &BTreeMap<String, Vec<String>>) -> Map<String, Value> {
    groups
        .iter()
        .map(|(key, ids)| {
            (
                key.clone(),
                Value::Array(ids.iter().cloned().map(Value::String).collect()),
            )
        })
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
    let current_user = CurrentUserSnapshotView::from_raw(input.current_user_snapshot.as_value());
    let user_id = normalize_text(if input.user_id.is_empty() {
        current_user.user_id
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(Error::Custom(
            "SocialFavoritesBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_favorites_output(user_id));
    }

    let favorite_limits_response = execute_vrchat_json_request(
        &deps,
        remote_favorites::favorite_limits_get_input(normalize_endpoint(&input.endpoint)),
    )
    .await?;
    let remote_favorites = fetch_paged_array(&deps, FAVORITES_PAGE_SIZE, None, |n, offset| {
        remote_favorites::favorites_get_input(normalize_endpoint(&input.endpoint), n, offset)
    })
    .await?;
    let remote_favorite_groups =
        fetch_paged_array(&deps, FAVORITE_GROUPS_PAGE_SIZE, None, |n, offset| {
            remote_favorites::favorite_groups_get_input(
                normalize_endpoint(&input.endpoint),
                n,
                offset,
                String::new(),
            )
        })
        .await?;

    let local_world_favorite_rows =
        vrcx_0_persistence::favorites::favorite_list(deps.db.as_ref(), "world".into())?;
    let local_avatar_favorite_rows =
        vrcx_0_persistence::favorites::favorite_list(deps.db.as_ref(), "avatar".into())?;
    let local_friend_favorite_rows =
        vrcx_0_persistence::favorites::favorite_list(deps.db.as_ref(), "friend".into())?;
    let local_world_cache_rows = serde_json::to_value(
        vrcx_0_persistence::worlds::world_cache_list(deps.db.as_ref())?,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();
    let local_avatar_cache_rows = serde_json::to_value(
        vrcx_0_persistence::avatars::avatar_cache_list(deps.db.as_ref())?,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();
    let explicit_local_world_groups = get_config_array(&deps, "localFavoriteWorldGroups")?;
    let explicit_local_avatar_groups = get_config_array(&deps, "localFavoriteAvatarGroups")?;
    let explicit_local_friend_groups = get_config_array(&deps, "localFavoriteFriendGroups")?;

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

    let friend_roster = FriendRosterView::new(input.friend_roster_by_id.as_value());
    let remote_snapshot = build_remote_favorite_snapshot(remote_favorites, &friend_roster);
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
        input.current_user_snapshot.as_value(),
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
        "remoteFavoritesById": remote_favorite_refs_to_json(&remote_snapshot.remote_favorites_by_id),
        "remoteFavoritesByObjectId": remote_favorite_refs_by_object_id_to_json(&remote_snapshot.remote_favorites_by_object_id),
        "favoriteFriendIds": remote_snapshot.favorite_friend_ids,
        "groupedFavoriteFriendIdsByGroupKey": string_groups_to_json(&remote_snapshot.grouped_favorite_friend_ids_by_group_key),
        "favoriteWorldIds": remote_snapshot.favorite_world_ids,
        "favoriteAvatarIds": remote_snapshot.favorite_avatar_ids,
        "cachedFavoriteGroupsById": cached_favorite_groups_by_id,
        "favoriteFriendGroups": favorite_friend_groups,
        "favoriteWorldGroups": favorite_world_groups,
        "favoriteAvatarGroups": favorite_avatar_groups,
        "localWorldFavorites": string_groups_to_json(&local_world_favorites),
        "localAvatarFavorites": string_groups_to_json(&local_avatar_favorites),
        "localFriendFavorites": string_groups_to_json(&local_friend_favorites),
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

    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_favorites_output(user_id));
    }

    Ok(SocialFavoritesBaselineOutput {
        user_id,
        stale: false,
        count,
        snapshot: Some(RawJson::from(snapshot)),
    })
}
