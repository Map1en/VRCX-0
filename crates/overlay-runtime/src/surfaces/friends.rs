use std::collections::{HashMap, HashSet};
pub(crate) use vrcx_0_core::text::first_non_empty;

use super::friend_record::extra_str;
pub(crate) use super::friend_record::friend_record_avatar_url;
use vrcx_0_application::{
    evaluate_instance_action_gates, InstanceActionGateTarget, InstanceActionGates,
    InstanceActionGatesBatchInput,
};
use vrcx_0_application_realtime::RealtimeFriendSnapshot;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::location::{parse_location, world_id_from_location};
use vrcx_0_persistence::favorites::favorite_list;
use vrcx_0_persistence::memos::{memo_list_user_notes, memo_list_users};
use vrcx_0_vr_overlay::{
    AvatarBitmap, FavoriteFriendsPanelModel, FriendPanelCategory, FriendPanelRow,
    FriendPanelRowActions, FriendPanelRowPrimaryAction, FriendPanelStatusTone,
};

use crate::VrOverlayRuntimeServices;

use super::super::localization::{OverlayLocale, OverlayLocalizer, OverlayPanelLocalizer};

pub(crate) const FRIENDS_PANEL_CATEGORY_ALL: &str = "all";
pub(crate) const FRIENDS_PANEL_CATEGORY_SAME_INSTANCE: &str = "sameInstance";
const FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE: &str = "favOnline";
const FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES: &str = "favLocal";
const FRIENDS_PANEL_CATEGORY_GROUP_PREFIX: &str = "group:";
const LOCAL_FAVORITE_GROUP_PREFIX: &str = "local:";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct FavoriteFriendGroupSnapshot {
    key: String,
    label: String,
    user_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct FavoriteFriendGroupsSnapshot {
    pub(crate) groups: Vec<FavoriteFriendGroupSnapshot>,
}

impl FavoriteFriendGroupsSnapshot {
    fn all_user_ids(&self) -> Vec<String> {
        self.user_ids_for_groups(|_| true)
    }

    fn group_user_ids(&self, key: &str) -> Option<Vec<String>> {
        self.groups
            .iter()
            .find(|group| group.key == key)
            .map(|group| group.user_ids.clone())
    }

    fn local_user_ids(&self) -> Vec<String> {
        self.user_ids_for_groups(|group| group.key.starts_with(LOCAL_FAVORITE_GROUP_PREFIX))
    }

    fn user_ids_for_groups(
        &self,
        include_group: impl Fn(&FavoriteFriendGroupSnapshot) -> bool,
    ) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut user_ids = Vec::new();
        for group in self.groups.iter().filter(|group| include_group(group)) {
            for user_id in &group.user_ids {
                if seen.insert(user_id.clone()) {
                    user_ids.push(user_id.clone());
                }
            }
        }
        user_ids
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct FriendsPanelModelInput {
    pub(crate) selected_category_key: String,
    pub(crate) friend_snapshot: Option<RealtimeFriendSnapshot>,
    pub(crate) favorite_groups: FavoriteFriendGroupsSnapshot,
    pub(crate) current_location: String,
    pub(crate) current_location_player_ids: Vec<String>,
    pub(crate) notes_by_user_id: HashMap<String, String>,
    pub(crate) memos_by_user_id: HashMap<String, String>,
    pub(crate) world_names_by_id: HashMap<String, String>,
    pub(crate) avatars_by_user_id: HashMap<String, AvatarBitmap>,
    pub(crate) locale: OverlayLocale,
    pub(crate) all_friends_includes_favorites: bool,
    pub(crate) is_game_running: bool,
}

pub(crate) fn favorite_friend_groups_snapshot_from_baseline(
    snapshot: &serde_json::Value,
) -> FavoriteFriendGroupsSnapshot {
    let remote_membership = object_string_vecs(snapshot.get("groupedFavoriteFriendIdsByGroupKey"));
    let local_membership = object_string_vecs(snapshot.get("localFriendFavorites"));
    let remote_labels = group_labels(snapshot.get("favoriteFriendGroups"), "");
    let local_labels = group_labels(
        snapshot.get("localFriendFavoriteGroups"),
        LOCAL_FAVORITE_GROUP_PREFIX,
    );
    let mut groups = Vec::new();

    for (key, user_ids) in remote_membership {
        if user_ids.is_empty() {
            continue;
        }
        let label = remote_labels
            .get(&key)
            .cloned()
            .unwrap_or_else(|| fallback_group_label(&key));
        groups.push(FavoriteFriendGroupSnapshot {
            key,
            label,
            user_ids,
        });
    }
    for (raw_key, user_ids) in local_membership {
        if user_ids.is_empty() {
            continue;
        }
        let key = format!("{LOCAL_FAVORITE_GROUP_PREFIX}{raw_key}");
        let label = local_labels
            .get(&key)
            .cloned()
            .unwrap_or_else(|| fallback_group_label(&raw_key));
        groups.push(FavoriteFriendGroupSnapshot {
            key,
            label,
            user_ids,
        });
    }
    FavoriteFriendGroupsSnapshot { groups }
}

pub(crate) fn local_favorite_friend_groups_from_db(
    db: &vrcx_0_persistence::DatabaseService,
    owner_user_id: &str,
) -> std::result::Result<FavoriteFriendGroupsSnapshot, vrcx_0_persistence::Error> {
    let rows = favorite_list(db, Some(owner_user_id), "friend".to_string())?;
    let mut groups_by_key: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let user_id = row.user_id.unwrap_or_default();
        if user_id.is_empty() {
            continue;
        }
        let group_name = row.group_name;
        let group_name = if group_name.trim().is_empty() {
            "Favorites".to_string()
        } else {
            group_name
        };
        groups_by_key.entry(group_name).or_default().push(user_id);
    }
    let mut groups = groups_by_key
        .into_iter()
        .map(|(group_name, user_ids)| FavoriteFriendGroupSnapshot {
            key: format!("{LOCAL_FAVORITE_GROUP_PREFIX}{group_name}"),
            label: group_name,
            user_ids: dedupe_preserve_order(user_ids),
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| left.label.cmp(&right.label).then(left.key.cmp(&right.key)));
    Ok(FavoriteFriendGroupsSnapshot { groups })
}

pub(crate) fn load_friends_panel_notes(
    services: &dyn VrOverlayRuntimeServices,
    owner_user_id: String,
) -> HashMap<String, String> {
    memo_list_user_notes(services.data().db.as_ref(), owner_user_id)
        .map(|notes| {
            notes
                .into_iter()
                .filter(|note| !note.user_id.trim().is_empty() && !note.note.trim().is_empty())
                .map(|note| (note.user_id, note.note))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn load_friends_panel_memos(
    services: &dyn VrOverlayRuntimeServices,
) -> HashMap<String, String> {
    memo_list_users(services.data().db.as_ref())
        .map(|memos| {
            memos
                .into_iter()
                .filter(|memo| !memo.user_id.trim().is_empty() && !memo.memo.trim().is_empty())
                .map(|memo| (memo.user_id, memo.memo))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn build_friends_panel_model(
    input: FriendsPanelModelInput,
) -> FavoriteFriendsPanelModel {
    let localizer = OverlayLocalizer::new(input.locale);
    let strings = localizer.friends_panel_strings();
    let snapshot = input.friend_snapshot.as_ref();
    let favorites_user_ids = input.favorite_groups.all_user_ids();
    let favorites_user_id_set = favorites_user_ids.iter().cloned().collect::<HashSet<_>>();
    let all_user_ids = all_friend_category_user_ids(
        snapshot,
        &favorites_user_id_set,
        input.all_friends_includes_favorites,
    );
    let same_instance_groups = same_instance_category_groups(
        snapshot,
        &input.current_location,
        &input.current_location_player_ids,
    );
    let same_instance_user_ids = same_instance_user_ids_from_groups(&same_instance_groups);
    let local_favorite_user_ids = input.favorite_groups.local_user_ids();
    let mut categories = vec![
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_ALL.to_string(),
            label: strings.all_label.clone(),
            count: visible_friend_count(snapshot, &all_user_ids),
        },
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_SAME_INSTANCE.to_string(),
            label: localizer.friends_panel_same_instance_label(),
            count: same_instance_user_ids.len(),
        },
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE.to_string(),
            label: localizer.friends_panel_favorites_online_label(),
            count: visible_friend_count(snapshot, &favorites_user_ids),
        },
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES.to_string(),
            label: localizer.friends_panel_local_favorites_label(),
            count: visible_friend_count(snapshot, &local_favorite_user_ids),
        },
    ];
    categories.extend(
        input
            .favorite_groups
            .groups
            .iter()
            .map(|group| FriendPanelCategory {
                key: format!("{FRIENDS_PANEL_CATEGORY_GROUP_PREFIX}{}", group.key),
                label: group.label.clone(),
                count: visible_friend_count(snapshot, &group.user_ids),
            }),
    );

    let selected_category_key = normalize_friends_panel_category_key(&input.selected_category_key);
    let selected_category_key = if categories
        .iter()
        .any(|category| category.key == selected_category_key)
    {
        selected_category_key
    } else {
        FRIENDS_PANEL_CATEGORY_ALL.to_string()
    };
    let selected_user_ids = selected_category_user_ids(
        &selected_category_key,
        snapshot,
        &same_instance_user_ids,
        &input.favorite_groups,
        &favorites_user_id_set,
        input.all_friends_includes_favorites,
    );
    let action_gates_by_user_id = friends_panel_action_gates_by_user_id(
        snapshot,
        &input.current_location,
        input.is_game_running,
    );
    let mut rows = snapshot
        .map(|snapshot| {
            selected_user_ids
                .into_iter()
                .filter_map(|user_id| {
                    let record = snapshot.friends_by_id.get(&user_id)?;
                    if !friend_record_is_online(record) {
                        return None;
                    }
                    Some(friend_row_from_record(
                        &input,
                        &localizer,
                        record,
                        action_gates_by_user_id.get(&user_id),
                    ))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if selected_category_key == FRIENDS_PANEL_CATEGORY_SAME_INSTANCE {
        rows =
            same_instance_sectioned_rows(rows, &same_instance_groups, snapshot, &input, &localizer);
    } else {
        rows.sort_by(|left, right| {
            let left_record =
                snapshot.and_then(|snapshot| snapshot.friends_by_id.get(&left.user_id));
            let right_record =
                snapshot.and_then(|snapshot| snapshot.friends_by_id.get(&right.user_id));
            friend_sort_key(left, left_record).cmp(&friend_sort_key(right, right_record))
        });
    }

    FavoriteFriendsPanelModel {
        categories,
        selected_category_key,
        rows,
        strings,
        ..FavoriteFriendsPanelModel::default()
    }
}

fn friends_panel_action_gates_by_user_id(
    snapshot: Option<&RealtimeFriendSnapshot>,
    current_invite_location: &str,
    is_game_running: bool,
) -> HashMap<String, InstanceActionGates> {
    let Some(snapshot) = snapshot else {
        return HashMap::new();
    };
    let targets = snapshot
        .friends_by_id
        .values()
        .filter_map(friend_action_gate_target)
        .collect::<Vec<_>>();
    evaluate_instance_action_gates(InstanceActionGatesBatchInput {
        current_user_id: snapshot.current_user_id.clone(),
        current_invite_location: current_invite_location.trim().to_string(),
        is_game_running,
        friend_user_ids: snapshot.friends_by_id.keys().cloned().collect(),
        closed_locations: Vec::new(),
        targets,
    })
    .targets
    .into_iter()
    .filter_map(|gates| {
        let key = gates.key.trim().to_string();
        (!key.is_empty()).then_some((key, gates))
    })
    .collect()
}

fn friend_action_gate_target(record: &FriendRecord) -> Option<InstanceActionGateTarget> {
    let user_id = record.id.trim().to_string();
    (!user_id.is_empty()).then(|| InstanceActionGateTarget {
        key: user_id.clone(),
        user_id,
        location: friend_action_location(record),
        state_bucket: friend_request_gate_state_bucket(record),
        is_current_user: false,
    })
}

fn friend_request_gate_state_bucket(record: &FriendRecord) -> String {
    let state = first_non_empty([record.state_bucket.as_str(), record.state.as_str()]);
    if state.trim().eq_ignore_ascii_case("active") {
        "online".to_string()
    } else {
        state.to_string()
    }
}

pub(crate) fn friend_action_location(record: &FriendRecord) -> String {
    let traveling_location = traveling_location(record);
    if !traveling_location.trim().is_empty()
        || record.location.trim().eq_ignore_ascii_case("traveling")
    {
        return traveling_location;
    }
    friend_location_candidates(record)
        .into_iter()
        .find(|location| {
            let parsed = parse_location(location);
            parsed.is_real_instance
                && !parsed.world_id.trim().is_empty()
                && !parsed.instance_id.trim().is_empty()
        })
        .unwrap_or_else(|| record.location.trim().to_string())
}

fn friend_row_actions(gates: Option<&InstanceActionGates>) -> FriendPanelRowActions {
    let Some(gates) = gates else {
        return FriendPanelRowActions::default();
    };
    let primary = if gates.can_join {
        Some(FriendPanelRowPrimaryAction::Open)
    } else if gates.can_request_invite {
        Some(FriendPanelRowPrimaryAction::Request)
    } else {
        None
    };
    FriendPanelRowActions {
        primary,
        invite: gates.can_invite,
    }
}

fn all_friend_category_user_ids(
    snapshot: Option<&RealtimeFriendSnapshot>,
    favorite_user_ids: &HashSet<String>,
    include_favorites: bool,
) -> Vec<String> {
    snapshot
        .map(|snapshot| {
            snapshot
                .friends_by_id
                .keys()
                .filter(|user_id| include_favorites || !favorite_user_ids.contains(*user_id))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SameInstanceFriendGroup {
    location_key: String,
    user_ids: Vec<String>,
}

fn same_instance_category_groups(
    snapshot: Option<&RealtimeFriendSnapshot>,
    current_location: &str,
    current_location_player_ids: &[String],
) -> Vec<SameInstanceFriendGroup> {
    let Some(snapshot) = snapshot else {
        return Vec::new();
    };
    let current_location_key = instance_location_key(current_location);
    let current_player_ids = current_location_player_ids
        .iter()
        .map(|user_id| user_id.trim().to_string())
        .filter(|user_id| !user_id.is_empty())
        .collect::<HashSet<_>>();
    let mut groups_by_location: HashMap<String, Vec<String>> = HashMap::new();
    for record in snapshot.friends_by_id.values() {
        let user_id = record.id.trim();
        if user_id.is_empty() || !friend_record_is_online(record) {
            continue;
        }
        let Some(location_key) = same_instance_record_location_key(
            record,
            current_location_key.as_deref(),
            &current_player_ids,
        ) else {
            continue;
        };
        groups_by_location
            .entry(location_key)
            .or_default()
            .push(user_id.to_string());
    }

    let mut groups = groups_by_location
        .into_iter()
        .filter_map(|(location_key, mut user_ids)| {
            user_ids.sort();
            user_ids.dedup();
            (user_ids.len() > 1).then_some(SameInstanceFriendGroup {
                location_key,
                user_ids,
            })
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| {
        right
            .user_ids
            .len()
            .cmp(&left.user_ids.len())
            .then(left.location_key.cmp(&right.location_key))
    });
    groups
}

fn same_instance_user_ids_from_groups(groups: &[SameInstanceFriendGroup]) -> Vec<String> {
    dedupe_preserve_order(
        groups
            .iter()
            .flat_map(|group| group.user_ids.iter().cloned())
            .collect(),
    )
}

fn same_instance_sectioned_rows(
    rows: Vec<FriendPanelRow>,
    groups: &[SameInstanceFriendGroup],
    snapshot: Option<&RealtimeFriendSnapshot>,
    input: &FriendsPanelModelInput,
    localizer: &OverlayLocalizer,
) -> Vec<FriendPanelRow> {
    let mut rows_by_user_id = rows
        .into_iter()
        .map(|row| (row.user_id.clone(), row))
        .collect::<HashMap<_, _>>();
    let mut sectioned_rows = Vec::new();
    for group in groups {
        let mut group_rows = group
            .user_ids
            .iter()
            .filter_map(|user_id| rows_by_user_id.remove(user_id))
            .collect::<Vec<_>>();
        if group_rows.is_empty() {
            continue;
        }
        group_rows.sort_by(|left, right| {
            let left_record =
                snapshot.and_then(|snapshot| snapshot.friends_by_id.get(&left.user_id));
            let right_record =
                snapshot.and_then(|snapshot| snapshot.friends_by_id.get(&right.user_id));
            friend_sort_key(left, left_record).cmp(&friend_sort_key(right, right_record))
        });
        sectioned_rows.push(friend_panel_section_header(same_instance_group_label(
            input,
            localizer,
            &group.location_key,
        )));
        sectioned_rows.extend(group_rows);
    }
    sectioned_rows
}

fn friend_panel_section_header(label: String) -> FriendPanelRow {
    FriendPanelRow {
        section_label: Some(label),
        user_id: String::new(),
        display_name: String::new(),
        status: FriendPanelStatusTone::Offline,
        location_text: String::new(),
        is_traveling: false,
        traveling_text: None,
        note: None,
        memo: None,
        avatar: None,
        actions: FriendPanelRowActions::default(),
    }
}

fn same_instance_group_label(
    input: &FriendsPanelModelInput,
    localizer: &OverlayLocalizer,
    location_key: &str,
) -> String {
    display_friend_location(
        localizer,
        &input.world_names_by_id,
        location_key,
        &world_id_from_location(location_key),
    )
}

fn same_instance_record_location_key(
    record: &FriendRecord,
    current_location_key: Option<&str>,
    current_player_ids: &HashSet<String>,
) -> Option<String> {
    let mut saw_real_instance_candidate = false;
    for candidate in friend_location_candidates(record) {
        let parsed = parse_location(&candidate);
        if let Some(location_key) = instance_location_key_from_parsed(&parsed) {
            return Some(location_key);
        }
        if parsed.is_real_instance {
            saw_real_instance_candidate = true;
        }
    }

    if saw_real_instance_candidate {
        return None;
    }
    let user_id = record.id.trim();
    if user_id.is_empty() || !current_player_ids.contains(user_id) {
        return None;
    }
    current_location_key.map(str::to_string)
}

fn friend_location_candidates(record: &FriendRecord) -> Vec<String> {
    [
        record
            .extra
            .get("$location")
            .map(normalized_location_value)
            .unwrap_or_default(),
        extra_string(record, "$locationTag"),
        record.location.trim().to_string(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect()
}

fn normalized_location_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value.trim().to_string(),
        serde_json::Value::Object(object) => {
            for key in ["tag", "location", "$location"] {
                if let Some(value) = object.get(key) {
                    let normalized = normalized_location_value(value);
                    if !normalized.is_empty() {
                        return normalized;
                    }
                }
            }
            let world_id = object
                .get("worldId")
                .or_else(|| object.get("world_id"))
                .map(normalized_location_value)
                .unwrap_or_default();
            let instance_id = object
                .get("instanceId")
                .or_else(|| object.get("instance_id"))
                .or_else(|| object.get("id"))
                .map(normalized_location_value)
                .unwrap_or_default();
            if !world_id.is_empty() && !instance_id.is_empty() {
                return format!("{world_id}:{instance_id}");
            }
            for (key, sentinel) in [
                ("isOffline", "offline"),
                ("isPrivate", "private"),
                ("isTraveling", "traveling"),
            ] {
                if object
                    .get(key)
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
                {
                    return sentinel.to_string();
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn instance_location_key(location: &str) -> Option<String> {
    instance_location_key_from_parsed(&parse_location(location))
}

fn instance_location_key_from_parsed(
    parsed: &vrcx_0_core::location::ParsedLocation,
) -> Option<String> {
    if parsed.world_id.starts_with("wrld_") && !parsed.instance_id.trim().is_empty() {
        Some(format!("{}:{}", parsed.world_id, parsed.instance_id))
    } else {
        None
    }
}

fn selected_category_user_ids(
    selected_category_key: &str,
    snapshot: Option<&RealtimeFriendSnapshot>,
    same_instance_user_ids: &[String],
    favorite_groups: &FavoriteFriendGroupsSnapshot,
    favorite_user_ids: &HashSet<String>,
    include_favorites: bool,
) -> Vec<String> {
    match selected_category_key {
        FRIENDS_PANEL_CATEGORY_ALL => {
            all_friend_category_user_ids(snapshot, favorite_user_ids, include_favorites)
        }
        FRIENDS_PANEL_CATEGORY_SAME_INSTANCE => same_instance_user_ids.to_vec(),
        FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE => favorite_groups.all_user_ids(),
        FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES => favorite_groups.local_user_ids(),
        _ => selected_category_key
            .strip_prefix(FRIENDS_PANEL_CATEGORY_GROUP_PREFIX)
            .and_then(|key| favorite_groups.group_user_ids(key))
            .unwrap_or_default(),
    }
}

pub(crate) fn normalize_friends_panel_category_key(key: &str) -> String {
    let key = key.trim();
    if key.is_empty() || key == FRIENDS_PANEL_CATEGORY_ALL {
        return FRIENDS_PANEL_CATEGORY_ALL.to_string();
    }
    if key == FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE
        || key == FRIENDS_PANEL_CATEGORY_SAME_INSTANCE
        || key == FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES
        || key.starts_with(FRIENDS_PANEL_CATEGORY_GROUP_PREFIX)
    {
        return key.to_string();
    }
    format!("{FRIENDS_PANEL_CATEGORY_GROUP_PREFIX}{key}")
}

pub(crate) fn friend_record_world_ids(record: &FriendRecord) -> Vec<String> {
    let ids = [
        record.world_id.trim().to_string(),
        world_id_from_location(&record.location),
        world_id_from_location(&record.traveling_to_location),
        world_id_from_location(&extra_string(record, "travelingToLocation")),
        world_id_from_location(&extra_string(record, "$travelingToLocation")),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>();
    dedupe_preserve_order(ids)
}

fn object_string_vecs(value: Option<&serde_json::Value>) -> Vec<(String, Vec<String>)> {
    let Some(object) = value.and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    let mut groups = object
        .iter()
        .filter_map(|(key, value)| {
            let user_ids = value
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if user_ids.is_empty() {
                None
            } else {
                Some((key.clone(), dedupe_preserve_order(user_ids)))
            }
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| left.0.cmp(&right.0));
    groups
}

fn group_labels(value: Option<&serde_json::Value>, key_prefix: &str) -> HashMap<String, String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|group| {
            let raw_key = json_string_field(group, "key")
                .or_else(|| json_string_field(group, "name"))
                .or_else(|| json_string_field(group, "displayName"))?;
            let key = format!("{key_prefix}{raw_key}");
            let label = json_string_field(group, "displayName")
                .or_else(|| json_string_field(group, "name"))
                .unwrap_or_else(|| fallback_group_label(&raw_key));
            Some((key, label))
        })
        .collect()
}

fn json_string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value.trim().to_string()),
            serde_json::Value::Number(value) => Some(value.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn fallback_group_label(key: &str) -> String {
    key.rsplit(':').next().unwrap_or(key).to_string()
}

pub(crate) fn dedupe_preserve_order(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn visible_friend_count(snapshot: Option<&RealtimeFriendSnapshot>, user_ids: &[String]) -> usize {
    let Some(snapshot) = snapshot else {
        return 0;
    };
    user_ids
        .iter()
        .filter_map(|user_id| snapshot.friends_by_id.get(user_id))
        .filter(|record| friend_record_is_online(record))
        .count()
}

fn friend_record_is_online(record: &FriendRecord) -> bool {
    let state = first_non_empty([record.state_bucket.as_str(), record.state.as_str()]);
    state.trim().eq_ignore_ascii_case("online")
}

fn friend_row_from_record(
    input: &FriendsPanelModelInput,
    localizer: &OverlayLocalizer,
    record: &FriendRecord,
    action_gates: Option<&InstanceActionGates>,
) -> FriendPanelRow {
    let user_id = record.id.trim().to_string();
    let traveling_location = traveling_location(record);
    let is_traveling =
        !traveling_location.is_empty() || record.location.trim().eq_ignore_ascii_case("traveling");
    let (location_text, traveling_text) = if is_traveling {
        (
            localizer.friends_panel_traveling_label(),
            Some(display_friend_location(
                localizer,
                &input.world_names_by_id,
                &traveling_location,
                "",
            )),
        )
    } else {
        (
            display_friend_location(
                localizer,
                &input.world_names_by_id,
                &record.location,
                &record.world_id,
            ),
            None,
        )
    };
    FriendPanelRow {
        section_label: None,
        user_id: user_id.clone(),
        display_name: record.display_name_or_id(),
        status: friend_status_tone(record),
        location_text,
        is_traveling,
        traveling_text: traveling_text.filter(|value| !value.trim().is_empty()),
        note: friend_record_note(record).or_else(|| input.notes_by_user_id.get(&user_id).cloned()),
        memo: input.memos_by_user_id.get(&user_id).cloned(),
        avatar: input.avatars_by_user_id.get(&user_id).cloned(),
        actions: friend_row_actions(action_gates),
    }
}

fn friend_record_note(record: &FriendRecord) -> Option<String> {
    record
        .extra
        .get("note")
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value.trim().to_string()),
            serde_json::Value::Number(value) => Some(value.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn display_friend_location(
    localizer: &OverlayLocalizer,
    world_names_by_id: &HashMap<String, String>,
    location: &str,
    record_world_id: &str,
) -> String {
    let location = location.trim();
    if location.is_empty() || location.eq_ignore_ascii_case("private") {
        return localizer.friends_panel_private_label();
    }
    if location.eq_ignore_ascii_case("offline") {
        return localizer.friends_panel_offline_label();
    }
    let parsed_world_id = world_id_from_location(location);
    let world_id = if record_world_id.trim().is_empty() {
        parsed_world_id.as_str()
    } else {
        record_world_id.trim()
    };
    let world_name = world_names_by_id
        .get(world_id)
        .map(String::as_str)
        .unwrap_or(world_id);
    let display = localizer.panel_display_location(location, world_name, "");
    if display.trim().is_empty() {
        localizer.friends_panel_private_label()
    } else {
        display
    }
}

fn traveling_location(record: &FriendRecord) -> String {
    let traveling_to_location = extra_string(record, "travelingToLocation");
    let legacy_traveling_to_location = extra_string(record, "$travelingToLocation");
    first_non_empty([
        record.traveling_to_location.as_str(),
        traveling_to_location.as_str(),
        legacy_traveling_to_location.as_str(),
    ])
    .to_string()
}

fn extra_string(record: &FriendRecord, key: &str) -> String {
    extra_str(record, key).trim().to_string()
}

fn friend_status_tone(record: &FriendRecord) -> FriendPanelStatusTone {
    if !friend_record_is_online(record) {
        return FriendPanelStatusTone::Offline;
    }
    match record.status.trim().to_ascii_lowercase().as_str() {
        "busy" => FriendPanelStatusTone::Busy,
        "ask me" | "askme" => FriendPanelStatusTone::AskMe,
        _ if record.state_bucket.trim().eq_ignore_ascii_case("active") => {
            FriendPanelStatusTone::Active
        }
        _ => FriendPanelStatusTone::Online,
    }
}

fn friend_sort_key(
    row: &FriendPanelRow,
    record: Option<&FriendRecord>,
) -> (u8, i64, String, String) {
    let state_order = match row.status {
        FriendPanelStatusTone::Online
        | FriendPanelStatusTone::Busy
        | FriendPanelStatusTone::AskMe => 0,
        FriendPanelStatusTone::Active => 1,
        FriendPanelStatusTone::Offline => 2,
    };
    let friend_number = record.and_then(friend_number).unwrap_or(i64::MAX);
    (
        state_order,
        friend_number,
        row.display_name.to_ascii_lowercase(),
        row.user_id.clone(),
    )
}

fn friend_number(record: &FriendRecord) -> Option<i64> {
    for key in ["friendNumber", "friend_number"] {
        let Some(value) = record.extra.get(key) else {
            continue;
        };
        if let Some(number) = value.as_i64() {
            return Some(number);
        }
        if let Some(number) = value.as_str().and_then(|value| value.trim().parse().ok()) {
            return Some(number);
        }
    }
    None
}

#[cfg(test)]
mod tests;
