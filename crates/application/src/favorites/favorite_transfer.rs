use std::{collections::HashMap, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::FavoriteEntityKind;
use vrcx_0_contracts::vrchat_api::parse_vrchat_json;
use vrcx_0_contracts::VrchatFavoriteType;
use vrcx_0_core::json::RawJson;

use vrcx_0_application_core::{AuthenticatedMutationContext, Error, Result, WorldCache};

use super::cache_policy::cache_world_snapshot;
use vrcx_0_application_core::vrchat_api::normalize_text;
use vrcx_0_core::OwnerId;

const FAVORITE_RECOVERED_GROUP: &str = "Recovered";
const FAVORITE_TRANSFER_PAGE_SIZE: i32 = 300;
const FAVORITE_TRANSFER_MAX_PAGES: usize = 50;
const FAVORITE_TRANSFER_REMOTE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteTransferLocation {
    Remote,
    Local,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteTransferMode {
    Move,
    Copy,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferSource {
    pub location: FavoriteTransferLocation,
    #[serde(default)]
    pub group: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferTarget {
    pub location: FavoriteTransferLocation,
    #[serde(default)]
    pub group: String,
    pub favorite_type: Option<VrchatFavoriteType>,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferItem {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub entity_id: String,
    #[serde(default)]
    pub entity: Option<RawJson>,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferInput {
    pub kind: FavoriteEntityKind,
    pub mode: FavoriteTransferMode,
    pub source: FavoriteTransferSource,
    pub target: FavoriteTransferTarget,
    #[serde(default)]
    pub items: Vec<FavoriteTransferItem>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteTransferStage {
    Validate,
    DeleteRemote,
    AddRemote,
    AddLocal,
    DeleteLocal,
    MoveLocal,
    RestoreRemoteToSource,
    SaveLocalFallback,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteTransferItemStatus {
    Moved,
    Copied,
    SkippedAlreadyPresent,
    RestoredToSource,
    SavedToLocalFallback,
    TargetAddedSourceDeleteFailed,
    Failed,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferItemResult {
    pub key: String,
    pub entity_id: String,
    pub status: FavoriteTransferItemStatus,
    pub stage: FavoriteTransferStage,
    pub message: String,
    pub remote_favorite: Option<RawJson>,
    pub local_affected: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferResult {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub local_changed: bool,
    pub remote_changed: bool,
    pub items: Vec<FavoriteTransferItemResult>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferSelectionInput {
    #[serde(default)]
    pub batches: Vec<FavoriteTransferInput>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTransferSelectionResult {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub local_changed: bool,
    pub remote_changed: bool,
    pub items: Vec<FavoriteTransferItemResult>,
    pub last_error: Option<String>,
}

pub(super) struct FavoriteTransferDeps<'a> {
    pub store: &'a dyn super::FavoriteStore,
    pub remote: &'a dyn super::FavoriteRemote,
    pub world_cache: &'a WorldCache,
    pub mutation: AuthenticatedMutationContext<'a>,
}

struct FavoriteTransferItemOutcome {
    result: FavoriteTransferItemResult,
    local_changed: bool,
    remote_changed: bool,
}

struct OnlineFavoriteIndex {
    by_object_id: HashMap<String, String>,
    group_counts: HashMap<String, i64>,
}

pub fn favorite_transfer_plan_for_item(
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> Result<Vec<FavoriteTransferStage>> {
    let source_group = normalize_text(&input.source.group);
    let target_group = normalize_text(&input.target.group);
    let entity_id = normalize_text(&item.entity_id);

    if target_group.is_empty() {
        return Err(Error::Custom(
            "Favorite transfer requires target group.".into(),
        ));
    }
    if entity_id.is_empty() {
        return Err(Error::Custom(
            "Favorite transfer requires entity id.".into(),
        ));
    }
    if input.source.location == input.target.location && source_group == target_group {
        return Err(Error::Custom(
            "Favorite transfer target is the same favorite group.".into(),
        ));
    }
    use FavoriteTransferLocation::{Local, Remote};
    use FavoriteTransferMode::{Copy, Move};
    match (input.source.location, input.target.location, input.mode) {
        (Remote, Remote, Move) => Ok(vec![
            FavoriteTransferStage::DeleteRemote,
            FavoriteTransferStage::AddRemote,
        ]),
        (Remote, Remote, Copy) => Err(remote_copy_unsupported_error()),
        (Remote, Local, Move) => Ok(vec![
            FavoriteTransferStage::AddLocal,
            FavoriteTransferStage::DeleteRemote,
        ]),
        (Remote, Local, Copy) => Ok(vec![FavoriteTransferStage::AddLocal]),
        (Local, Remote, Move) => Ok(vec![
            FavoriteTransferStage::AddRemote,
            FavoriteTransferStage::DeleteLocal,
        ]),
        (Local, Remote, Copy) => Ok(vec![FavoriteTransferStage::AddRemote]),
        (Local, Local, Move) => Ok(vec![FavoriteTransferStage::MoveLocal]),
        (Local, Local, Copy) => Ok(vec![FavoriteTransferStage::AddLocal]),
    }
}

pub(super) async fn transfer_favorites(
    deps: &FavoriteTransferDeps<'_>,
    input: FavoriteTransferInput,
) -> Result<FavoriteTransferResult> {
    deps.mutation.ensure_current()?;
    let remote_index = precheck_remote_target(deps, &input).await?;

    let mut item_results = Vec::with_capacity(input.items.len());
    let mut succeeded = 0;
    let mut failed = 0;
    let mut local_changed = false;
    let mut remote_changed = false;

    for item in &input.items {
        let outcome = transfer_item(deps, &input, item, remote_index.as_ref()).await;
        if outcome.result.status == FavoriteTransferItemStatus::Failed {
            failed += 1;
        } else {
            succeeded += 1;
        }
        local_changed = local_changed || outcome.local_changed;
        remote_changed = remote_changed || outcome.remote_changed;
        item_results.push(outcome.result);
    }

    Ok(FavoriteTransferResult {
        total: crate::wire_count(item_results.len()),
        succeeded,
        failed,
        local_changed,
        remote_changed,
        items: item_results,
    })
}

pub(super) async fn transfer_favorite_selection(
    deps: &FavoriteTransferDeps<'_>,
    input: FavoriteTransferSelectionInput,
) -> Result<FavoriteTransferSelectionResult> {
    if input.batches.is_empty() {
        return Err(Error::Custom(
            "Favorite transfer requires at least one source group.".into(),
        ));
    }
    let mut output = FavoriteTransferSelectionResult {
        total: 0,
        succeeded: 0,
        failed: 0,
        local_changed: false,
        remote_changed: false,
        items: Vec::new(),
        last_error: None,
    };
    for batch in input.batches {
        let batch_size = batch.items.len();
        match transfer_favorites(deps, batch).await {
            Ok(result) => {
                output.total += result.total;
                output.succeeded += result.succeeded;
                output.failed += result.failed;
                output.local_changed |= result.local_changed;
                output.remote_changed |= result.remote_changed;
                output.items.extend(result.items);
            }
            Err(error) => {
                output.total = output.total.saturating_add(crate::wire_count(batch_size));
                output.failed = output.failed.saturating_add(crate::wire_count(batch_size));
                if output.last_error.is_none() {
                    output.last_error = Some(error.to_string());
                }
            }
        }
    }
    Ok(output)
}

async fn transfer_item(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
    remote_index: Option<&OnlineFavoriteIndex>,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);

    if let Err(error) = deps.mutation.ensure_current() {
        return failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::Validate,
            error,
            false,
            false,
        );
    }

    if let Err(error) = favorite_transfer_plan_for_item(input, item) {
        return failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::Validate,
            error,
            false,
            false,
        );
    }
    if let Some(index) = remote_index {
        if let Err(error) = check_remote_uniqueness(index, input, &entity_id) {
            return failed_outcome(
                key,
                entity_id,
                FavoriteTransferStage::Validate,
                error,
                false,
                false,
            );
        }
    }

    use FavoriteTransferLocation::{Local, Remote};
    use FavoriteTransferMode::{Copy, Move};
    match (input.source.location, input.target.location, input.mode) {
        (Remote, Remote, Move) => run_remote_to_remote_move(deps, input, item).await,
        (Remote, Remote, Copy) => failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::Validate,
            remote_copy_unsupported_error(),
            false,
            false,
        ),
        (Remote, Local, Move) => run_remote_to_local_move(deps, input, item).await,
        (Remote, Local, Copy) => {
            run_local_add_terminal(deps, input, item, FavoriteTransferItemStatus::Copied)
        }
        (Local, Remote, Move) => run_local_to_remote_move(deps, input, item).await,
        (Local, Remote, Copy) => run_local_to_remote_copy(deps, input, item).await,
        (Local, Local, Move) => run_local_to_local_move(deps, input, item),
        (Local, Local, Copy) => {
            run_local_add_terminal(deps, input, item, FavoriteTransferItemStatus::Copied)
        }
    }
}

async fn run_remote_to_remote_move(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);

    if let Err(error) = delete_remote_favorite(deps, item).await {
        return failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::DeleteRemote,
            error,
            false,
            false,
        );
    }

    match add_remote_favorite(deps, input, item).await {
        Ok(favorite) => outcome(
            success_item_result(
                key,
                entity_id,
                FavoriteTransferItemStatus::Moved,
                FavoriteTransferStage::AddRemote,
                Some(favorite),
                0,
            ),
            false,
            true,
        ),
        Err(add_error) => {
            let source_group = normalize_text(&input.source.group);
            match add_remote_favorite_with_group(deps, input, item, &source_group).await {
                Ok(favorite) => {
                    let mut result = success_item_result(
                        key,
                        entity_id,
                        FavoriteTransferItemStatus::RestoredToSource,
                        FavoriteTransferStage::RestoreRemoteToSource,
                        Some(favorite),
                        0,
                    );
                    result.message = format!(
                        "Could not add the favorite to the target group; restored it to the source group. {add_error}"
                    );
                    outcome(result, false, true)
                }
                Err(restore_error) => match add_local_fallback_favorite(deps, input, item) {
                    Ok(affected) => {
                        let mut result = success_item_result(
                            key,
                            entity_id,
                            FavoriteTransferItemStatus::SavedToLocalFallback,
                            FavoriteTransferStage::SaveLocalFallback,
                            None,
                            affected,
                        );
                        result.message = format!(
                            "Could not add or restore the online favorite; saved it to the local '{FAVORITE_RECOVERED_GROUP}' group instead. add error: {add_error}; restore error: {restore_error}"
                        );
                        outcome(result, affected > 0, true)
                    }
                    Err(fallback_error) => failed_outcome(
                        key,
                        entity_id,
                        FavoriteTransferStage::SaveLocalFallback,
                        Error::Custom(format!(
                            "Favorite transfer failed and all compensation attempts failed. add error: {add_error}; restore error: {restore_error}; fallback error: {fallback_error}"
                        )),
                        false,
                        true,
                    ),
                },
            }
        }
    }
}

async fn run_remote_to_local_move(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);

    let local_affected = match add_local_favorite(deps, input, item) {
        Ok(affected) => affected,
        Err(error) => {
            return failed_outcome(
                key,
                entity_id,
                FavoriteTransferStage::AddLocal,
                error,
                false,
                false,
            )
        }
    };

    match delete_remote_favorite(deps, item).await {
        Ok(_) => {
            let status = if local_affected > 0 {
                FavoriteTransferItemStatus::Moved
            } else {
                FavoriteTransferItemStatus::SkippedAlreadyPresent
            };
            outcome(
                success_item_result(
                    key,
                    entity_id,
                    status,
                    FavoriteTransferStage::DeleteRemote,
                    None,
                    local_affected,
                ),
                local_affected > 0,
                true,
            )
        }
        Err(error) => {
            let mut result = success_item_result(
                key,
                entity_id,
                FavoriteTransferItemStatus::TargetAddedSourceDeleteFailed,
                FavoriteTransferStage::DeleteRemote,
                None,
                local_affected,
            );
            result.message = format!(
                "Added to local favorites, but failed to remove the online favorite: {error}"
            );
            outcome(result, local_affected > 0, false)
        }
    }
}

fn run_local_add_terminal(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
    moved_status: FavoriteTransferItemStatus,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);
    match add_local_favorite(deps, input, item) {
        Ok(affected) => {
            let status = if affected > 0 {
                moved_status
            } else {
                FavoriteTransferItemStatus::SkippedAlreadyPresent
            };
            outcome(
                success_item_result(
                    key,
                    entity_id,
                    status,
                    FavoriteTransferStage::AddLocal,
                    None,
                    affected,
                ),
                affected > 0,
                false,
            )
        }
        Err(error) => failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::AddLocal,
            error,
            false,
            false,
        ),
    }
}

async fn run_local_to_remote_move(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);

    let remote_favorite = match add_remote_favorite(deps, input, item).await {
        Ok(favorite) => favorite,
        Err(error) => {
            return failed_outcome(
                key,
                entity_id,
                FavoriteTransferStage::AddRemote,
                error,
                false,
                false,
            )
        }
    };

    match delete_local_favorite(deps, input, item) {
        Ok(local_affected) => outcome(
            success_item_result(
                key,
                entity_id,
                FavoriteTransferItemStatus::Moved,
                FavoriteTransferStage::DeleteLocal,
                Some(remote_favorite),
                local_affected,
            ),
            local_affected > 0,
            true,
        ),
        Err(error) => {
            let mut result = success_item_result(
                key,
                entity_id,
                FavoriteTransferItemStatus::TargetAddedSourceDeleteFailed,
                FavoriteTransferStage::DeleteLocal,
                Some(remote_favorite),
                0,
            );
            result.message = format!(
                "Added to online favorites, but failed to remove the local favorite: {error}"
            );
            outcome(result, false, true)
        }
    }
}

async fn run_local_to_remote_copy(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);
    match add_remote_favorite(deps, input, item).await {
        Ok(favorite) => outcome(
            success_item_result(
                key,
                entity_id,
                FavoriteTransferItemStatus::Copied,
                FavoriteTransferStage::AddRemote,
                Some(favorite),
                0,
            ),
            false,
            true,
        ),
        Err(error) => failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::AddRemote,
            error,
            false,
            false,
        ),
    }
}

fn run_local_to_local_move(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> FavoriteTransferItemOutcome {
    let key = item.key.clone();
    let entity_id = normalize_text(&item.entity_id);
    match move_local_favorite(deps, input, item) {
        Ok(affected) => outcome(
            success_item_result(
                key,
                entity_id,
                FavoriteTransferItemStatus::Moved,
                FavoriteTransferStage::MoveLocal,
                None,
                affected,
            ),
            affected > 0,
            false,
        ),
        Err(error) => failed_outcome(
            key,
            entity_id,
            FavoriteTransferStage::MoveLocal,
            error,
            false,
            false,
        ),
    }
}

async fn delete_remote_favorite(
    deps: &FavoriteTransferDeps<'_>,
    item: &FavoriteTransferItem,
) -> Result<i64> {
    let object_id = normalize_text(&item.entity_id);
    deps.mutation
        .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
        .await?;
    let (_, response) = deps
        .remote
        .delete(
            deps.mutation.scope().endpoint.clone(),
            object_id,
            Some(super::FavoriteRemoteCommand {
                name: "app__favorites_transfer.delete_remote",
                detail: "Deleting a remote favorite.".into(),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    ensure_vrchat_response_ok(response.status, &response.data, "delete remote favorite")?;
    Ok(0)
}

async fn add_remote_favorite(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> Result<RawJson> {
    add_remote_favorite_with_group(deps, input, item, &input.target.group).await
}

async fn add_remote_favorite_with_group(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
    group: &str,
) -> Result<RawJson> {
    let favorite_type = remote_favorite_type(input);
    deps.mutation
        .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
        .await?;
    let (_, _, response) = deps
        .remote
        .add(
            deps.mutation.scope().endpoint.clone(),
            super::FavoriteRemoteAddInput {
                kind: favorite_type,
                entity_id: normalize_text(&item.entity_id),
                tags: normalize_text(group),
            },
            Some(super::FavoriteRemoteCommand {
                name: "app__favorites_transfer.add_remote",
                detail: "Adding a remote favorite.".into(),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    ensure_vrchat_response_ok(response.status, &response.data, "add remote favorite")?;
    Ok(RawJson::from(parse_vrchat_json(&response.data)))
}

fn add_local_favorite(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = deps.store.add(
        Some(&OwnerId::new(deps.mutation.scope().current_user_id.clone())),
        input.kind,
        normalize_text(&item.entity_id),
        normalize_text(&input.target.group),
    )?;
    cache_world_snapshot_if_safe(deps.world_cache, input, item);
    Ok(affected)
}

fn add_local_fallback_favorite(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    super::local_favorites::create_local_favorite_group(
        deps.store,
        &OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        input.kind,
        FAVORITE_RECOVERED_GROUP.to_string(),
    )?;
    let affected = deps.store.add(
        Some(&OwnerId::new(deps.mutation.scope().current_user_id.clone())),
        input.kind,
        normalize_text(&item.entity_id),
        FAVORITE_RECOVERED_GROUP.to_string(),
    )?;
    cache_world_snapshot_if_safe(deps.world_cache, input, item);
    Ok(affected)
}

fn delete_local_favorite(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    deps.store.remove(
        Some(&OwnerId::new(deps.mutation.scope().current_user_id.clone())),
        input.kind,
        normalize_text(&item.entity_id),
        normalize_text(&input.source.group),
    )
}

fn move_local_favorite(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let result = deps.store.move_between_groups(
        Some(&OwnerId::new(deps.mutation.scope().current_user_id.clone())),
        input.kind,
        normalize_text(&item.entity_id),
        normalize_text(&input.source.group),
        normalize_text(&input.target.group),
    )?;
    Ok(result.removed + result.added)
}

fn kind_equivalent_favorite_types(kind: &str) -> &'static [&'static str] {
    match kind {
        "world" => &["world", "vrcPlusWorld"],
        "avatar" => &["avatar"],
        "friend" => &["friend"],
        _ => &[],
    }
}

fn favorite_group_count_key(favorite_type: &str, group: &str) -> String {
    format!("{favorite_type}:{group}")
}

async fn fetch_online_favorite_index(
    deps: &FavoriteTransferDeps<'_>,
    kind: &str,
) -> Result<OnlineFavoriteIndex> {
    let equivalent_types = kind_equivalent_favorite_types(kind);
    let mut by_object_id = HashMap::new();
    let mut group_counts: HashMap<String, i64> = HashMap::new();
    let mut offset = 0_i32;

    for _ in 0..FAVORITE_TRANSFER_MAX_PAGES {
        deps.mutation
            .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
            .await?;
        let response = deps
            .remote
            .list(
                deps.mutation.scope().endpoint.clone(),
                FAVORITE_TRANSFER_PAGE_SIZE,
                offset,
                Some(super::FavoriteRemoteCommand {
                    name: "app__favorites_transfer.precheck_list",
                    detail: "Loading remote favorites for transfer validation.".into(),
                }),
            )
            .await?;
        deps.mutation.ensure_current()?;
        ensure_vrchat_response_ok(response.status, &response.data, "list online favorites")?;
        let page = parse_vrchat_json(&response.data);
        let rows = page.as_array().cloned().unwrap_or_default();
        let page_len = rows.len();

        for row in &rows {
            let favorite_type = string_field(row, &["type"]).unwrap_or_default();
            if !equivalent_types.contains(&favorite_type.as_str()) {
                continue;
            }
            let Some(object_id) = string_field(row, &["favoriteId"]) else {
                continue;
            };
            let group = row
                .get("tags")
                .and_then(Value::as_array)
                .and_then(|tags| tags.first())
                .and_then(Value::as_str)
                .map(normalize_text)
                .unwrap_or_default();
            let group_key = favorite_group_count_key(&favorite_type, &group);
            by_object_id.insert(object_id, group_key.clone());
            *group_counts.entry(group_key).or_insert(0) += 1;
        }

        if page_len < FAVORITE_TRANSFER_PAGE_SIZE as usize {
            break;
        }
        offset += FAVORITE_TRANSFER_PAGE_SIZE;
    }

    Ok(OnlineFavoriteIndex {
        by_object_id,
        group_counts,
    })
}

async fn fetch_favorite_group_capacity(
    deps: &FavoriteTransferDeps<'_>,
    favorite_type: &str,
) -> Result<i64> {
    deps.mutation
        .wait_for_remote(FAVORITE_TRANSFER_REMOTE_INTERVAL)
        .await?;
    let response = deps
        .remote
        .limits(
            deps.mutation.scope().endpoint.clone(),
            Some(super::FavoriteRemoteCommand {
                name: "app__favorites_transfer.precheck_limits",
                detail: "Loading remote favorite limits for transfer validation.".into(),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    ensure_vrchat_response_ok(response.status, &response.data, "get favorite limits")?;
    let limits = parse_vrchat_json(&response.data);
    Ok(limits
        .get("maxFavoritesPerGroup")
        .and_then(|value| value.get(favorite_type))
        .and_then(Value::as_i64)
        .filter(|capacity| *capacity > 0)
        .unwrap_or_else(|| default_group_capacity(favorite_type)))
}

fn default_group_capacity(favorite_type: &str) -> i64 {
    match favorite_type {
        "friend" => 150,
        "avatar" => 50,
        _ => 100,
    }
}

async fn precheck_remote_target(
    deps: &FavoriteTransferDeps<'_>,
    input: &FavoriteTransferInput,
) -> Result<Option<OnlineFavoriteIndex>> {
    if input.items.is_empty() {
        return Ok(None);
    }
    if input.target.location != FavoriteTransferLocation::Remote {
        return Ok(None);
    }
    if input.source.location == FavoriteTransferLocation::Remote
        && input.mode == FavoriteTransferMode::Copy
    {
        return Ok(None);
    }

    let kind = input.kind.as_str();
    let favorite_type = remote_favorite_type(input);
    let favorite_type_name = favorite_type.as_str();
    let target_group = normalize_text(&input.target.group);

    let index = fetch_online_favorite_index(deps, kind).await?;
    let capacity = fetch_favorite_group_capacity(deps, favorite_type_name).await?;
    let current_count = index
        .group_counts
        .get(&favorite_group_count_key(favorite_type_name, &target_group))
        .copied()
        .unwrap_or(0);
    let free = capacity - current_count;
    let requested = input.items.len() as i64;
    if free < requested {
        return Err(Error::Custom(format!(
            "Favorite transfer target group does not have enough free space (free={free}, requested={requested})."
        )));
    }

    Ok(Some(index))
}

fn check_remote_uniqueness(
    index: &OnlineFavoriteIndex,
    input: &FavoriteTransferInput,
    entity_id: &str,
) -> Result<()> {
    if input.source.location == FavoriteTransferLocation::Remote
        && input.target.location == FavoriteTransferLocation::Remote
    {
        return Ok(());
    }
    if index.by_object_id.contains_key(entity_id) {
        return Err(Error::Custom(format!(
            "{entity_id} is already an online favorite; VRChat allows only one favorite record per object online."
        )));
    }
    Ok(())
}

fn success_item_result(
    key: String,
    entity_id: String,
    status: FavoriteTransferItemStatus,
    stage: FavoriteTransferStage,
    remote_favorite: Option<RawJson>,
    local_affected: i64,
) -> FavoriteTransferItemResult {
    FavoriteTransferItemResult {
        key,
        entity_id,
        status,
        stage,
        message: String::new(),
        remote_favorite,
        local_affected,
    }
}

fn failed_item_result(
    key: String,
    entity_id: String,
    stage: FavoriteTransferStage,
    error: Error,
) -> FavoriteTransferItemResult {
    FavoriteTransferItemResult {
        key,
        entity_id,
        status: FavoriteTransferItemStatus::Failed,
        stage,
        message: error.to_string(),
        remote_favorite: None,
        local_affected: 0,
    }
}

fn outcome(
    result: FavoriteTransferItemResult,
    local_changed: bool,
    remote_changed: bool,
) -> FavoriteTransferItemOutcome {
    FavoriteTransferItemOutcome {
        result,
        local_changed,
        remote_changed,
    }
}

fn failed_outcome(
    key: String,
    entity_id: String,
    stage: FavoriteTransferStage,
    error: Error,
    local_changed: bool,
    remote_changed: bool,
) -> FavoriteTransferItemOutcome {
    outcome(
        failed_item_result(key, entity_id, stage, error),
        local_changed,
        remote_changed,
    )
}

fn remote_copy_unsupported_error() -> Error {
    Error::Custom(
        "Favorite transfer cannot copy within the online favorite list; VRChat allows only one favorite record per object.".into(),
    )
}

fn remote_favorite_type(input: &FavoriteTransferInput) -> VrchatFavoriteType {
    input
        .target
        .favorite_type
        .unwrap_or_else(|| input.kind.into())
}

fn ensure_vrchat_response_ok(status: i32, data: &str, action: &str) -> Result<()> {
    if status < 400 {
        return Ok(());
    }

    let parsed = parse_vrchat_json(data);
    let message = parsed
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| parsed.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("VRChat favorite transfer failed during {action}."));
    Err(Error::Custom(message))
}

fn cache_world_snapshot_if_safe(
    world_cache: &WorldCache,
    input: &FavoriteTransferInput,
    item: &FavoriteTransferItem,
) {
    if input.kind != FavoriteEntityKind::World {
        return;
    }
    if let Some(entity) = item.entity.as_ref().map(RawJson::as_value) {
        if let Err(error) = cache_world_snapshot(world_cache, entity, &item.entity_id) {
            tracing::warn!("failed to cache transferred favorite world snapshot: {error}");
        }
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let text = match value.get(*key) {
            Some(Value::String(text)) => normalize_text(text),
            Some(other) if !other.is_null() => normalize_text(other.to_string()),
            _ => String::new(),
        };
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input(
        source_location: FavoriteTransferLocation,
        target_location: FavoriteTransferLocation,
        mode: FavoriteTransferMode,
    ) -> FavoriteTransferInput {
        FavoriteTransferInput {
            kind: FavoriteEntityKind::World,
            mode,
            source: FavoriteTransferSource {
                location: source_location,
                group: "SourceGroup".to_string(),
            },
            target: FavoriteTransferTarget {
                location: target_location,
                group: "TargetGroup".to_string(),
                favorite_type: None,
            },
            items: Vec::new(),
        }
    }

    fn index_with(entries: &[(&str, &str)]) -> OnlineFavoriteIndex {
        let mut by_object_id = HashMap::new();
        for (object_id, group_key) in entries {
            by_object_id.insert(object_id.to_string(), group_key.to_string());
        }
        OnlineFavoriteIndex {
            by_object_id,
            group_counts: HashMap::new(),
        }
    }

    #[test]
    fn check_remote_uniqueness_rejects_object_already_online() {
        let index = index_with(&[("wrld_1", "world:TargetGroup")]);
        let input = sample_input(
            FavoriteTransferLocation::Local,
            FavoriteTransferLocation::Remote,
            FavoriteTransferMode::Move,
        );

        assert!(check_remote_uniqueness(&index, &input, "wrld_1").is_err());
    }

    #[test]
    fn check_remote_uniqueness_exempts_remote_to_remote_transfers() {
        let index = index_with(&[("wrld_1", "world:TargetGroup")]);
        let input = sample_input(
            FavoriteTransferLocation::Remote,
            FavoriteTransferLocation::Remote,
            FavoriteTransferMode::Move,
        );

        assert!(check_remote_uniqueness(&index, &input, "wrld_1").is_ok());
    }

    #[test]
    fn check_remote_uniqueness_allows_object_absent_from_index() {
        let index = index_with(&[]);
        let input = sample_input(
            FavoriteTransferLocation::Local,
            FavoriteTransferLocation::Remote,
            FavoriteTransferMode::Move,
        );

        assert!(check_remote_uniqueness(&index, &input, "wrld_absent").is_ok());
    }

    #[test]
    fn default_group_capacity_covers_friend_avatar_and_fallback_branches() {
        assert_eq!(default_group_capacity("friend"), 150);
        assert_eq!(default_group_capacity("avatar"), 50);
        assert_eq!(default_group_capacity("world"), 100);
    }

    #[test]
    fn ensure_vrchat_response_ok_passes_through_success_status() {
        assert!(ensure_vrchat_response_ok(200, "{}", "test action").is_ok());
    }

    #[test]
    fn ensure_vrchat_response_ok_prefers_nested_error_message() {
        let data = r#"{"error":{"message":"nested failure"},"message":"top level"}"#;
        let error = ensure_vrchat_response_ok(400, data, "test action").unwrap_err();
        assert_eq!(error.to_string(), "nested failure");
    }

    #[test]
    fn ensure_vrchat_response_ok_falls_back_to_top_level_message() {
        let data = r#"{"message":"top level failure"}"#;
        let error = ensure_vrchat_response_ok(400, data, "test action").unwrap_err();
        assert_eq!(error.to_string(), "top level failure");
    }

    #[test]
    fn ensure_vrchat_response_ok_falls_back_to_action_text_without_message() {
        let error = ensure_vrchat_response_ok(500, "{}", "delete remote favorite").unwrap_err();
        assert_eq!(
            error.to_string(),
            "VRChat favorite transfer failed during delete remote favorite."
        );
    }

    #[test]
    fn kind_equivalent_favorite_types_maps_world_to_world_and_vrc_plus_world() {
        assert_eq!(
            kind_equivalent_favorite_types("world"),
            &["world", "vrcPlusWorld"]
        );
        assert_eq!(kind_equivalent_favorite_types("avatar"), &["avatar"]);
        assert_eq!(kind_equivalent_favorite_types("friend"), &["friend"]);
        assert!(kind_equivalent_favorite_types("unknown").is_empty());
    }
}
