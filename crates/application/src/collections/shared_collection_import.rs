use futures_util::future::BoxFuture;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use vrcx_0_core::vrchat_ids::is_world_id;

use vrcx_0_application_core::{Error, Result};

pub const SHARED_COLLECTION_IMPORT_MAX_WORLDS: usize = 1_000;
const SHARED_COLLECTION_IMPORT_INTERVAL: Duration = Duration::from_millis(500);
const SHARED_COLLECTION_IMPORT_CANCEL_POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SharedCollectionImportStartInput {
    pub world_ids: Vec<String>,
    pub group_name: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SharedCollectionImportState {
    #[default]
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SharedCollectionImportStatus {
    pub run_id: String,
    pub status: SharedCollectionImportState,
    pub total: u32,
    pub processed: u32,
    pub imported: u32,
    pub failed: u32,
    pub group_name: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedSharedCollectionImport {
    pub world_ids: Vec<String>,
    pub group_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SharedCollectionImportProgress {
    pub processed: usize,
    pub imported: usize,
    pub failed: usize,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SharedCollectionImportResult {
    pub total: usize,
    pub processed: usize,
    pub imported: usize,
    pub failed: usize,
    pub cancelled: bool,
    pub last_error: Option<String>,
}

pub trait SharedCollectionImportActions: Send + Sync {
    fn create_group(&self, group_name: &str) -> Result<i64>;
    fn fetch_and_cache_world<'a>(&'a self, world_id: &'a str) -> BoxFuture<'a, Result<()>>;
    fn add_world_favorite(&self, world_id: &str, group_id: i64) -> Result<()>;
}

pub fn prepare_shared_collection_import(
    input: SharedCollectionImportStartInput,
) -> Result<PreparedSharedCollectionImport> {
    let group_name = input.group_name.trim().to_string();
    if group_name.is_empty() {
        return Err(Error::Custom(
            "Local world favorite group name is required.".into(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let world_ids = input
        .world_ids
        .into_iter()
        .map(|world_id| world_id.trim().to_string())
        .filter(|world_id| is_world_id(world_id))
        .filter(|world_id| seen.insert(world_id.clone()))
        .collect::<Vec<_>>();
    if world_ids.is_empty() {
        return Err(Error::Custom(
            "Shared collection import requires at least one valid world id.".into(),
        ));
    }
    if world_ids.len() > SHARED_COLLECTION_IMPORT_MAX_WORLDS {
        return Err(Error::Custom(format!(
            "Shared collection import cannot exceed {SHARED_COLLECTION_IMPORT_MAX_WORLDS} worlds."
        )));
    }
    Ok(PreparedSharedCollectionImport {
        world_ids,
        group_name,
    })
}

pub async fn run_shared_collection_import(
    actions: &dyn SharedCollectionImportActions,
    input: PreparedSharedCollectionImport,
    should_cancel: impl Fn() -> bool,
    on_progress: impl FnMut(SharedCollectionImportProgress),
) -> Result<SharedCollectionImportResult> {
    run_shared_collection_import_with_interval(
        actions,
        input,
        SHARED_COLLECTION_IMPORT_INTERVAL,
        should_cancel,
        on_progress,
    )
    .await
}

async fn run_shared_collection_import_with_interval(
    actions: &dyn SharedCollectionImportActions,
    input: PreparedSharedCollectionImport,
    interval: Duration,
    should_cancel: impl Fn() -> bool,
    mut on_progress: impl FnMut(SharedCollectionImportProgress),
) -> Result<SharedCollectionImportResult> {
    let total = input.world_ids.len();
    let mut result = SharedCollectionImportResult {
        total,
        ..Default::default()
    };
    if should_cancel() {
        result.cancelled = true;
        return Ok(result);
    }
    let group_id = actions.create_group(&input.group_name)?;

    for (index, world_id) in input.world_ids.iter().enumerate() {
        if should_cancel() {
            result.cancelled = true;
            break;
        }
        if index > 0 && wait_for_import_interval(interval, &should_cancel).await {
            result.cancelled = true;
            break;
        }

        let fetch_result = actions.fetch_and_cache_world(world_id).await;
        if should_cancel() {
            result.cancelled = true;
            break;
        }
        let item_result =
            fetch_result.and_then(|()| actions.add_world_favorite(world_id, group_id));
        result.processed += 1;
        match item_result {
            Ok(()) => result.imported += 1,
            Err(error) => {
                result.failed += 1;
                result.last_error = Some(error.to_string());
            }
        }
        on_progress(SharedCollectionImportProgress {
            processed: result.processed,
            imported: result.imported,
            failed: result.failed,
            last_error: result.last_error.clone(),
        });
        if should_cancel() {
            result.cancelled = true;
            break;
        }
    }

    Ok(result)
}

async fn wait_for_import_interval(interval: Duration, should_cancel: &impl Fn() -> bool) -> bool {
    let started_at = tokio::time::Instant::now();
    loop {
        if should_cancel() {
            return true;
        }
        let elapsed = started_at.elapsed();
        if elapsed >= interval {
            return false;
        }
        tokio::time::sleep((interval - elapsed).min(SHARED_COLLECTION_IMPORT_CANCEL_POLL)).await;
    }
}

#[cfg(test)]
mod tests;
