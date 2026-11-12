use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::vrchat_api::normalize_text;
use vrcx_0_application_core::{Error, FavoriteEntityKind, Result};
use vrcx_0_contracts::vrchat_api::parse_vrchat_json;
use vrcx_0_contracts::VrchatFavoriteType;

use super::favorite_transfer::{
    ensure_vrchat_response_ok, favorite_group_count_key, fetch_favorite_group_capacity,
    fetch_online_favorite_index, kind_equivalent_favorite_types, run_remote_to_remote_move,
    string_field, FavoriteTransferDeps, OnlineFavoriteIndex, FAVORITE_TRANSFER_REMOTE_INTERVAL,
};
use super::{
    FavoriteTransferInput, FavoriteTransferItem, FavoriteTransferItemStatus,
    FavoriteTransferLocation, FavoriteTransferMode, FavoriteTransferSource, FavoriteTransferTarget,
};

pub const FAVORITE_REMOTE_MOVE_MAX_ITEMS: usize = 10;
const FAVORITE_GROUPS_PAGE_SIZE: i32 = 50;
const FAVORITE_GROUPS_MAX_PAGES: usize = 10;
const FAVORITE_GROUP_NAMES_PAGE_SIZE: i32 = 100;
const FAVORITE_GROUP_NAMES_MAX_PAGES: usize = 5;

pub struct FavoriteRemoteMoveInput {
    pub kind: FavoriteEntityKind,
    pub entity_ids: Vec<String>,
    pub target_group: String,
    pub dry_run: bool,
}

pub struct FavoriteRemoteListInput {
    pub kind: FavoriteEntityKind,
    pub group: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRemoteGroup {
    pub name: String,
    pub display_name: String,
    pub favorite_type: VrchatFavoriteType,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteRemoteMoveStatus {
    WouldMove,
    Moved,
    RestoredToSource,
    SavedToLocalFallback,
    AlreadyInTarget,
    NotFavorited,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRemoteMoveItem {
    pub entity_id: String,
    pub name: Option<String>,
    pub source: Option<FavoriteRemoteGroup>,
    pub status: FavoriteRemoteMoveStatus,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRemoteMoveOutput {
    pub kind: FavoriteEntityKind,
    pub target: FavoriteRemoteGroup,
    pub dry_run: bool,
    pub items: Vec<FavoriteRemoteMoveItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRemoteGroupSummary {
    #[serde(flatten)]
    pub group: FavoriteRemoteGroup,
    pub count: i64,
    pub capacity: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRemoteEntry {
    pub entity_id: String,
    pub name: Option<String>,
    pub group: String,
    pub favorite_type: VrchatFavoriteType,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRemoteListing {
    pub kind: FavoriteEntityKind,
    pub groups: Vec<FavoriteRemoteGroupSummary>,
    pub favorites: Vec<FavoriteRemoteEntry>,
}

pub(super) struct FavoriteRemoteMoveOutcome {
    pub output: FavoriteRemoteMoveOutput,
    pub local_changed: bool,
    pub remote_changed: bool,
}

struct RemoteSnapshot {
    index: OnlineFavoriteIndex,
    groups: Vec<FavoriteRemoteGroup>,
}

impl RemoteSnapshot {
    async fn fetch(deps: &FavoriteTransferDeps<'_>, kind: FavoriteEntityKind) -> Result<Self> {
        Ok(Self {
            index: fetch_online_favorite_index(deps, kind.as_str()).await?,
            groups: fetch_remote_groups(deps, kind).await?,
        })
    }

    fn group_of(&self, entity_id: &str) -> Option<FavoriteRemoteGroup> {
        let (favorite_type, name) = self.index.by_object_id.get(entity_id)?.split_once(':')?;
        self.groups
            .iter()
            .find(|group| group.name == name && group.favorite_type.as_str() == favorite_type)
            .cloned()
            .or_else(|| {
                Some(FavoriteRemoteGroup {
                    name: name.to_string(),
                    display_name: String::new(),
                    favorite_type: VrchatFavoriteType::from_remote_type(favorite_type)?,
                })
            })
    }

    fn count(&self, group: &FavoriteRemoteGroup) -> i64 {
        self.index
            .group_counts
            .get(&favorite_group_count_key(
                group.favorite_type.as_str(),
                &group.name,
            ))
            .copied()
            .unwrap_or(0)
    }
}

pub(super) async fn move_remote_favorites(
    deps: &FavoriteTransferDeps<'_>,
    input: FavoriteRemoteMoveInput,
) -> Result<FavoriteRemoteMoveOutcome> {
    let entity_ids = requested_entity_ids(input.kind, input.entity_ids)?;
    let snapshot = RemoteSnapshot::fetch(deps, input.kind).await?;
    let target = resolve_group(&snapshot.groups, &input.target_group)?;
    let mut items = entity_ids
        .into_iter()
        .map(|entity_id| {
            let source = snapshot.group_of(&entity_id);
            let status = match &source {
                None => FavoriteRemoteMoveStatus::NotFavorited,
                Some(source) if *source == target => FavoriteRemoteMoveStatus::AlreadyInTarget,
                Some(_) => FavoriteRemoteMoveStatus::WouldMove,
            };
            FavoriteRemoteMoveItem {
                name: None,
                entity_id,
                source,
                status,
                message: String::new(),
            }
        })
        .collect::<Vec<_>>();
    for item in &mut items {
        item.name = resolve_entity_name(deps, input.kind, &item.entity_id).await;
    }

    let moving = items
        .iter()
        .filter(|item| item.status == FavoriteRemoteMoveStatus::WouldMove)
        .count() as i64;
    if moving > 0 {
        let capacity = fetch_favorite_group_capacity(deps, target.favorite_type.as_str()).await?;
        let free = capacity - snapshot.count(&target);
        if moving > free {
            return Err(Error::Custom(format!(
                "The favorite group {} has {} free slots, but {moving} favorites would move into it.",
                describe_group(&target),
                free.max(0)
            )));
        }
    }

    let mut local_changed = false;
    let mut remote_changed = false;
    if !input.dry_run {
        for item in &mut items {
            let (FavoriteRemoteMoveStatus::WouldMove, Some(source)) = (item.status, &item.source)
            else {
                continue;
            };
            let transfer = FavoriteTransferInput {
                kind: input.kind,
                mode: FavoriteTransferMode::Move,
                source: FavoriteTransferSource {
                    location: FavoriteTransferLocation::Remote,
                    group: source.name.clone(),
                },
                target: FavoriteTransferTarget {
                    location: FavoriteTransferLocation::Remote,
                    group: target.name.clone(),
                    favorite_type: Some(target.favorite_type),
                },
                items: Vec::new(),
            };
            let outcome = run_remote_to_remote_move(
                deps,
                &transfer,
                &FavoriteTransferItem {
                    key: item.entity_id.clone(),
                    entity_id: item.entity_id.clone(),
                    entity: None,
                },
            )
            .await;
            local_changed |= outcome.local_changed;
            remote_changed |= outcome.remote_changed;
            item.status = match outcome.result.status {
                FavoriteTransferItemStatus::Moved => FavoriteRemoteMoveStatus::Moved,
                FavoriteTransferItemStatus::RestoredToSource => {
                    FavoriteRemoteMoveStatus::RestoredToSource
                }
                FavoriteTransferItemStatus::SavedToLocalFallback => {
                    FavoriteRemoteMoveStatus::SavedToLocalFallback
                }
                _ => FavoriteRemoteMoveStatus::Failed,
            };
            item.message = outcome.result.message;
        }
    }

    Ok(FavoriteRemoteMoveOutcome {
        output: FavoriteRemoteMoveOutput {
            kind: input.kind,
            target,
            dry_run: input.dry_run,
            items,
        },
        local_changed,
        remote_changed,
    })
}

pub(super) async fn list_remote_favorites(
    deps: &FavoriteTransferDeps<'_>,
    input: FavoriteRemoteListInput,
) -> Result<FavoriteRemoteListing> {
    let snapshot = RemoteSnapshot::fetch(deps, input.kind).await?;
    let only_group = input
        .group
        .as_deref()
        .map(str::trim)
        .filter(|group| !group.is_empty())
        .map(|group| resolve_group(&snapshot.groups, group))
        .transpose()?;

    let mut capacities = HashMap::new();
    for group in &snapshot.groups {
        let favorite_type = group.favorite_type.as_str();
        if !capacities.contains_key(favorite_type) {
            let capacity = fetch_favorite_group_capacity(deps, favorite_type).await?;
            capacities.insert(favorite_type, capacity);
        }
    }
    let mut groups = snapshot
        .groups
        .iter()
        .map(|group| FavoriteRemoteGroupSummary {
            count: snapshot.count(group),
            capacity: capacities
                .get(group.favorite_type.as_str())
                .copied()
                .unwrap_or(0),
            group: group.clone(),
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| {
        (left.group.favorite_type.as_str(), &left.group.name)
            .cmp(&(right.group.favorite_type.as_str(), &right.group.name))
    });

    let listed_groups = groups
        .iter()
        .filter(|summary| summary.count > 0)
        .filter(|summary| {
            only_group
                .as_ref()
                .is_none_or(|only| *only == summary.group)
        })
        .map(|summary| &summary.group)
        .collect::<Vec<_>>();
    let names = fetch_group_names(deps, input.kind, &listed_groups).await;
    let mut favorites = snapshot
        .index
        .by_object_id
        .keys()
        .filter_map(|entity_id| {
            let group = snapshot.group_of(entity_id)?;
            if only_group.as_ref().is_some_and(|only| *only != group) {
                return None;
            }
            Some(FavoriteRemoteEntry {
                name: names
                    .get(entity_id)
                    .cloned()
                    .or_else(|| cached_world_name(deps, input.kind, entity_id)),
                entity_id: entity_id.clone(),
                group: group.name,
                favorite_type: group.favorite_type,
            })
        })
        .collect::<Vec<_>>();
    favorites.sort_by(|left, right| {
        (&left.group, &left.entity_id).cmp(&(&right.group, &right.entity_id))
    });

    Ok(FavoriteRemoteListing {
        kind: input.kind,
        groups,
        favorites,
    })
}

fn requested_entity_ids(kind: FavoriteEntityKind, entity_ids: Vec<String>) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let entity_ids = entity_ids
        .into_iter()
        .map(normalize_text)
        .filter(|entity_id| !entity_id.is_empty() && seen.insert(entity_id.clone()))
        .collect::<Vec<_>>();
    if entity_ids.is_empty() {
        return Err(Error::Custom("Name at least one favorite to move.".into()));
    }
    if entity_ids.len() > FAVORITE_REMOTE_MOVE_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Move at most {FAVORITE_REMOTE_MOVE_MAX_ITEMS} favorites per call; split the rest into further calls."
        )));
    }
    if let Some(invalid) = entity_ids
        .iter()
        .find(|entity_id| !entity_id.starts_with(kind.entity_id_prefix()))
    {
        return Err(Error::Custom(format!(
            "{invalid} is not a {} id; {} favorite ids start with {}.",
            kind.as_str(),
            kind.as_str(),
            kind.entity_id_prefix()
        )));
    }
    Ok(entity_ids)
}

fn cached_world_name(
    deps: &FavoriteTransferDeps<'_>,
    kind: FavoriteEntityKind,
    entity_id: &str,
) -> Option<String> {
    if kind != FavoriteEntityKind::World {
        return None;
    }
    deps.world_cache
        .get_name(entity_id)
        .filter(|name| !name.trim().is_empty())
}

async fn resolve_entity_name(
    deps: &FavoriteTransferDeps<'_>,
    kind: FavoriteEntityKind,
    entity_id: &str,
) -> Option<String> {
    if let Some(name) = cached_world_name(deps, kind, entity_id) {
        return Some(name);
    }
    if kind == FavoriteEntityKind::Friend {
        return None;
    }
    deps.mutation
        .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
        .await
        .ok()?;
    let endpoint = deps.mutation.scope().endpoint.clone();
    let name = if kind == FavoriteEntityKind::World {
        deps.world_cache.resolve_name(&endpoint, entity_id).await
    } else {
        let response = deps
            .remote
            .avatar(endpoint, entity_id.to_string())
            .await
            .ok()?;
        (response.status < 400)
            .then(|| string_field(&parse_vrchat_json(&response.data), &["name"]))
            .flatten()
    };
    name.filter(|name| !name.trim().is_empty())
}

async fn fetch_group_names(
    deps: &FavoriteTransferDeps<'_>,
    kind: FavoriteEntityKind,
    groups: &[&FavoriteRemoteGroup],
) -> HashMap<String, String> {
    let mut names = HashMap::new();
    if kind == FavoriteEntityKind::Friend {
        return names;
    }
    for group in groups {
        let mut offset = 0_i32;
        for _ in 0..FAVORITE_GROUP_NAMES_MAX_PAGES {
            if deps
                .mutation
                .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
                .await
                .is_err()
            {
                return names;
            }
            let endpoint = deps.mutation.scope().endpoint.clone();
            let response = if kind == FavoriteEntityKind::World {
                deps.remote
                    .favorite_worlds(
                        endpoint,
                        FAVORITE_GROUP_NAMES_PAGE_SIZE,
                        offset,
                        String::new(),
                        String::new(),
                        group.name.clone(),
                    )
                    .await
            } else {
                deps.remote
                    .favorite_avatars(
                        endpoint,
                        FAVORITE_GROUP_NAMES_PAGE_SIZE,
                        offset,
                        group.name.clone(),
                    )
                    .await
            };
            let rows = match response {
                Ok(response) if response.status < 400 => parse_vrchat_json(&response.data)
                    .as_array()
                    .cloned()
                    .unwrap_or_default(),
                Ok(response) => {
                    tracing::warn!(
                        status = response.status,
                        group = %group.name,
                        "favorite names: VRChat refused the group listing"
                    );
                    break;
                }
                Err(error) => {
                    tracing::warn!(group = %group.name, %error, "favorite names: group listing failed");
                    break;
                }
            };
            for row in &rows {
                if let (Some(id), Some(name)) =
                    (string_field(row, &["id"]), string_field(row, &["name"]))
                {
                    names.insert(id, name);
                }
            }
            if rows.len() < FAVORITE_GROUP_NAMES_PAGE_SIZE as usize {
                break;
            }
            offset += FAVORITE_GROUP_NAMES_PAGE_SIZE;
        }
    }
    names
}

async fn fetch_remote_groups(
    deps: &FavoriteTransferDeps<'_>,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRemoteGroup>> {
    let equivalent_types = kind_equivalent_favorite_types(kind.as_str());
    let mut groups = Vec::new();
    let mut offset = 0_i32;
    for _ in 0..FAVORITE_GROUPS_MAX_PAGES {
        deps.mutation
            .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
            .await?;
        let response = deps
            .remote
            .groups(
                deps.mutation.scope().endpoint.clone(),
                FAVORITE_GROUPS_PAGE_SIZE,
                offset,
                deps.mutation.scope().current_user_id.clone(),
                Some(super::FavoriteRemoteCommand {
                    name: "app__favorites_remote.groups",
                    detail: "Loading remote favorite groups.".into(),
                }),
            )
            .await?;
        deps.mutation.ensure_current()?;
        ensure_vrchat_response_ok(response.status, &response.data, "list favorite groups")?;
        let page = parse_vrchat_json(&response.data);
        let rows = page.as_array().cloned().unwrap_or_default();
        let page_len = rows.len();
        groups.extend(rows.iter().filter_map(|row| {
            let favorite_type = string_field(row, &["type"])?;
            if !equivalent_types.contains(&favorite_type.as_str()) {
                return None;
            }
            Some(FavoriteRemoteGroup {
                name: string_field(row, &["name"])?,
                display_name: row
                    .get("displayName")
                    .and_then(Value::as_str)
                    .map(normalize_text)
                    .unwrap_or_default(),
                favorite_type: VrchatFavoriteType::from_remote_type(&favorite_type)?,
            })
        }));
        if page_len < FAVORITE_GROUPS_PAGE_SIZE as usize {
            break;
        }
        offset += FAVORITE_GROUPS_PAGE_SIZE;
    }
    Ok(groups)
}

fn resolve_group(groups: &[FavoriteRemoteGroup], requested: &str) -> Result<FavoriteRemoteGroup> {
    let requested = normalize_text(requested);
    if let Some(group) = groups
        .iter()
        .find(|group| group.name.eq_ignore_ascii_case(&requested))
    {
        return Ok(group.clone());
    }
    let wanted = requested.to_lowercase();
    let matches = groups
        .iter()
        .filter(|group| {
            !group.display_name.is_empty() && group.display_name.to_lowercase() == wanted
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [group] => Ok((*group).clone()),
        [] => Err(Error::Custom(format!(
            "No VRChat favorite group matches \"{requested}\". Available groups: {}.",
            list_groups(groups.iter())
        ))),
        _ => Err(Error::Custom(format!(
            "Several VRChat favorite groups are named \"{requested}\"; pass one of these tags instead: {}.",
            list_groups(matches.into_iter())
        ))),
    }
}

fn describe_group(group: &FavoriteRemoteGroup) -> String {
    if group.display_name.is_empty() {
        group.name.clone()
    } else {
        format!("{} (\"{}\")", group.name, group.display_name)
    }
}

fn list_groups<'a>(groups: impl Iterator<Item = &'a FavoriteRemoteGroup>) -> String {
    let listed = groups.map(describe_group).collect::<Vec<_>>();
    if listed.is_empty() {
        "none".into()
    } else {
        listed.join(", ")
    }
}
