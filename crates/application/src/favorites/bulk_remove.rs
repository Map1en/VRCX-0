use futures_util::future::BoxFuture;

use std::{collections::HashSet, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::{AuthenticatedMutationContext, Error, FavoriteEntityKind, Result};
use vrcx_0_core::OwnerId;

use crate::scope_gate::RemoteMutationOutcome;

pub const FAVORITE_BULK_REMOVE_MAX_ITEMS: usize = 250;
const FAVORITE_BULK_REMOVE_REMOTE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteBulkRemoveSource {
    Local,
    Remote,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveItem {
    pub key: String,
    pub source: FavoriteBulkRemoveSource,
    pub entity_id: String,
    #[serde(default)]
    pub group_name: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveInput {
    pub kind: FavoriteEntityKind,
    #[serde(default)]
    pub items: Vec<FavoriteBulkRemoveItem>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteBulkRemoveItemState {
    Removed,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveItemResult {
    pub key: String,
    pub source: FavoriteBulkRemoveSource,
    pub entity_id: String,
    pub state: FavoriteBulkRemoveItemState,
    pub local_affected: i64,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveResult {
    pub owner_user_id: OwnerId,
    pub kind: FavoriteEntityKind,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub local_changed: bool,
    pub remote_changed: bool,
    pub items: Vec<FavoriteBulkRemoveItemResult>,
    pub last_error: Option<String>,
}

pub(super) struct FavoriteBulkRemoveDeps<'a> {
    pub store: &'a dyn super::FavoriteStore,
    pub remote: &'a dyn super::FavoriteRemote,
    pub mutation: AuthenticatedMutationContext<'a>,
}

struct FavoriteBulkRemoveWorkItem {
    item: FavoriteBulkRemoveItem,
    rejection: Option<String>,
}

trait FavoriteBulkRemoveActions: Send + Sync {
    fn remove_local(&self, kind: FavoriteEntityKind, item: &FavoriteBulkRemoveItem) -> Result<i64>;
    fn remove_remote<'a>(
        &'a self,
        item: &'a FavoriteBulkRemoveItem,
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>>;
    fn scope_matches(&self) -> bool;
    fn wait_for_remote_slot<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
}

struct VrchatFavoriteBulkRemoveActions<'a> {
    deps: &'a FavoriteBulkRemoveDeps<'a>,
}

impl VrchatFavoriteBulkRemoveActions<'_> {
    async fn execute_remote(&self, object_id: String) -> Result<RemoteMutationOutcome> {
        self.deps.mutation.ensure_current()?;
        let (_, response) = self
            .deps
            .remote
            .delete(self.deps.mutation.scope().endpoint.clone(), object_id, None)
            .await?;
        let fallback_payload = Value::String(response.data.clone());
        if !(200..300).contains(&response.status) {
            return Err(Error::Custom(response_error_message(
                &serde_json::from_str::<Value>(&response.data).unwrap_or(fallback_payload),
                response.status,
            )));
        }
        let payload = if response.data.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str::<Value>(&response.data).map_err(|error| {
                Error::Custom(format!(
                    "VRChat favorite removal returned invalid JSON: {error}"
                ))
            })?
        };
        if payload.get("error").is_some() {
            return Err(Error::Custom(response_error_message(
                &payload,
                response.status,
            )));
        }
        if self.scope_matches() {
            Ok(RemoteMutationOutcome::Applied)
        } else {
            Ok(RemoteMutationOutcome::AppliedScopeChanged)
        }
    }
}

impl FavoriteBulkRemoveActions for VrchatFavoriteBulkRemoveActions<'_> {
    fn remove_local(&self, kind: FavoriteEntityKind, item: &FavoriteBulkRemoveItem) -> Result<i64> {
        self.deps.mutation.ensure_current()?;
        self.deps.store.remove(
            Some(&OwnerId::new(
                self.deps.mutation.scope().current_user_id.clone(),
            )),
            kind,
            item.entity_id.clone(),
            item.group_name.clone(),
        )
    }

    fn remove_remote<'a>(
        &'a self,
        item: &'a FavoriteBulkRemoveItem,
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>> {
        Box::pin(async move { self.execute_remote(item.entity_id.clone()).await })
    }

    fn scope_matches(&self) -> bool {
        self.deps.mutation.is_current()
    }

    fn wait_for_remote_slot<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.deps
                .mutation
                .pace(FAVORITE_BULK_REMOVE_REMOTE_INTERVAL)
                .await;
        })
    }
}

pub(super) async fn remove_favorites_bulk(
    deps: &FavoriteBulkRemoveDeps<'_>,
    input: FavoriteBulkRemoveInput,
) -> Result<FavoriteBulkRemoveResult> {
    if !deps.mutation.is_current() {
        return Err(Error::Custom(
            "Favorite bulk remove is stale for the current auth scope.".into(),
        ));
    }
    let owner_user_id = deps.mutation.scope().current_user_id.clone();
    let kind = input.kind;
    let items = normalize_items(kind, input.items)?;
    let actions = VrchatFavoriteBulkRemoveActions { deps };
    Ok(run_favorite_bulk_remove(&actions, OwnerId::new(owner_user_id), kind, items).await)
}

pub(super) async fn remove_favorites_selection(
    deps: &FavoriteBulkRemoveDeps<'_>,
    input: FavoriteBulkRemoveInput,
) -> Result<FavoriteBulkRemoveResult> {
    if input.items.len() <= FAVORITE_BULK_REMOVE_MAX_ITEMS {
        return remove_favorites_bulk(deps, input).await;
    }
    let mut result = FavoriteBulkRemoveResult {
        owner_user_id: OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        kind: input.kind,
        total: 0,
        succeeded: 0,
        failed: 0,
        local_changed: false,
        remote_changed: false,
        items: Vec::new(),
        last_error: None,
    };
    for items in input.items.chunks(FAVORITE_BULK_REMOVE_MAX_ITEMS) {
        let chunk = remove_favorites_bulk(
            deps,
            FavoriteBulkRemoveInput {
                kind: input.kind,
                items: items.to_vec(),
            },
        )
        .await?;
        result.owner_user_id = chunk.owner_user_id;
        result.kind = chunk.kind;
        result.total += chunk.total;
        result.succeeded += chunk.succeeded;
        result.failed += chunk.failed;
        result.local_changed |= chunk.local_changed;
        result.remote_changed |= chunk.remote_changed;
        result.items.extend(chunk.items);
        result.last_error = chunk.last_error.or(result.last_error);
        if !deps.mutation.is_current() {
            break;
        }
    }
    Ok(result)
}

async fn run_favorite_bulk_remove(
    actions: &dyn FavoriteBulkRemoveActions,
    owner_user_id: OwnerId,
    kind: FavoriteEntityKind,
    input_items: Vec<FavoriteBulkRemoveWorkItem>,
) -> FavoriteBulkRemoveResult {
    let mut items = input_items
        .iter()
        .map(|work| not_attempted(&work.item))
        .collect::<Vec<_>>();
    let mut last_error = None;

    for (index, work) in input_items.iter().enumerate() {
        if !actions.scope_matches() {
            let message = "Favorite bulk remove authentication scope changed.".to_string();
            mark_not_attempted(&mut items[index..], &message);
            last_error = Some(message);
            break;
        }
        let item = &work.item;
        if let Some(message) = &work.rejection {
            items[index] = FavoriteBulkRemoveItemResult {
                key: item.key.clone(),
                source: item.source,
                entity_id: item.entity_id.clone(),
                state: FavoriteBulkRemoveItemState::Failed,
                local_affected: 0,
                message: message.clone(),
            };
            last_error = Some(message.clone());
            continue;
        }
        let outcome = match item.source {
            FavoriteBulkRemoveSource::Local => actions
                .remove_local(kind, item)
                .map(|affected| (affected, false)),
            FavoriteBulkRemoveSource::Remote => {
                actions.wait_for_remote_slot().await;
                actions
                    .remove_remote(item)
                    .await
                    .map(|outcome| (0, outcome == RemoteMutationOutcome::AppliedScopeChanged))
            }
        };
        match outcome {
            Ok((local_affected, scope_changed)) => {
                items[index] = FavoriteBulkRemoveItemResult {
                    key: item.key.clone(),
                    source: item.source,
                    entity_id: item.entity_id.clone(),
                    state: FavoriteBulkRemoveItemState::Removed,
                    local_affected,
                    message: String::new(),
                };
                if scope_changed {
                    let message = "Favorite bulk remove authentication scope changed.".to_string();
                    mark_not_attempted(&mut items[index + 1..], &message);
                    last_error = Some(message);
                    break;
                }
            }
            Err(error) => {
                let message = error.to_string();
                items[index] = FavoriteBulkRemoveItemResult {
                    key: item.key.clone(),
                    source: item.source,
                    entity_id: item.entity_id.clone(),
                    state: FavoriteBulkRemoveItemState::Failed,
                    local_affected: 0,
                    message: message.clone(),
                };
                last_error = Some(message);
                if !actions.scope_matches() {
                    let message = "Favorite bulk remove authentication scope changed.".to_string();
                    mark_not_attempted(&mut items[index + 1..], &message);
                    last_error = Some(message);
                    break;
                }
            }
        }
    }

    let succeeded = items
        .iter()
        .filter(|item| item.state == FavoriteBulkRemoveItemState::Removed)
        .count();
    FavoriteBulkRemoveResult {
        owner_user_id,
        kind,
        total: crate::wire_count(items.len()),
        succeeded: crate::wire_count(succeeded),
        failed: crate::wire_count(items.len() - succeeded),
        local_changed: items.iter().any(|item| {
            item.source == FavoriteBulkRemoveSource::Local
                && item.state == FavoriteBulkRemoveItemState::Removed
        }),
        remote_changed: items.iter().any(|item| {
            item.source == FavoriteBulkRemoveSource::Remote
                && item.state == FavoriteBulkRemoveItemState::Removed
        }),
        items,
        last_error,
    }
}

fn normalize_items(
    kind: FavoriteEntityKind,
    input_items: Vec<FavoriteBulkRemoveItem>,
) -> Result<Vec<FavoriteBulkRemoveWorkItem>> {
    let expected_prefix = match kind {
        FavoriteEntityKind::Friend => "usr_",
        FavoriteEntityKind::World => "wrld_",
        FavoriteEntityKind::Avatar => "avtr_",
    };
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for item in input_items {
        let key = item.key.trim().to_string();
        let entity_id = item.entity_id.trim().to_string();
        let group_name = item.group_name.trim().to_string();
        if key.is_empty() {
            return Err(Error::Custom(
                "Favorite bulk remove requires an item key.".into(),
            ));
        }
        let rejection = if !entity_id.starts_with(expected_prefix)
            || entity_id.len() == expected_prefix.len()
        {
            Some("Favorite bulk remove contains an invalid entity id.".to_string())
        } else if item.source == FavoriteBulkRemoveSource::Local && group_name.is_empty() {
            Some("Local favorite bulk remove requires a group name.".to_string())
        } else {
            None
        };
        if seen.insert(key.clone()) {
            items.push(FavoriteBulkRemoveWorkItem {
                item: FavoriteBulkRemoveItem {
                    key,
                    source: item.source,
                    entity_id,
                    group_name,
                },
                rejection,
            });
        }
    }
    if items.is_empty() {
        return Err(Error::Custom(
            "Favorite bulk remove requires at least one item.".into(),
        ));
    }
    if items.len() > FAVORITE_BULK_REMOVE_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Favorite bulk remove cannot exceed {FAVORITE_BULK_REMOVE_MAX_ITEMS} items."
        )));
    }
    Ok(items)
}

fn not_attempted(item: &FavoriteBulkRemoveItem) -> FavoriteBulkRemoveItemResult {
    FavoriteBulkRemoveItemResult {
        key: item.key.clone(),
        source: item.source,
        entity_id: item.entity_id.clone(),
        state: FavoriteBulkRemoveItemState::NotAttempted,
        local_affected: 0,
        message: String::new(),
    }
}

fn mark_not_attempted(items: &mut [FavoriteBulkRemoveItemResult], message: &str) {
    for item in items {
        item.message = message.to_string();
    }
}

fn response_error_message(payload: &Value, status: i32) -> String {
    crate::scope_gate::response_error_message(payload, status, "favorite removal")
}

#[cfg(test)]
mod tests;
