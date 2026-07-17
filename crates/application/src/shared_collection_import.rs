use std::{future::Future, pin::Pin, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::vrchat_ids::is_world_id;
use vrcx_0_persistence::{favorites::favorite_add, DatabaseService};
use vrcx_0_vrchat_client::{
    http_api::{normalize_vrchat_api_endpoint, ApiScope},
    worlds::world_get_input,
};

use crate::{create_local_favorite_group, Error, Result, WebClient, WorldCache};

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
    pub total: usize,
    pub processed: usize,
    pub imported: usize,
    pub failed: usize,
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
    fn create_group(&self, group_name: &str) -> Result<()>;
    fn fetch_and_cache_world<'a>(
        &'a self,
        world_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
    fn add_world_favorite(&self, world_id: &str, group_name: &str) -> Result<()>;
}

pub struct VrchatSharedCollectionImportActions<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub world_cache: &'a WorldCache,
    pub endpoint: &'a str,
}

impl SharedCollectionImportActions for VrchatSharedCollectionImportActions<'_> {
    fn create_group(&self, group_name: &str) -> Result<()> {
        create_local_favorite_group(self.db, "world", group_name.to_string())
    }

    fn fetch_and_cache_world<'a>(
        &'a self,
        world_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let (_, request) = world_get_input(
                normalize_vrchat_api_endpoint(Some(self.endpoint)),
                world_id.to_string(),
            )?;
            let response = self
                .web
                .execute_api(request, ApiScope::Vrchat, self.db)
                .await?;
            if !(200..=299).contains(&response.status) {
                return Err(Error::Custom(format!(
                    "World lookup failed with status {}.",
                    response.status
                )));
            }
            let world: Value = serde_json::from_str(&response.data)
                .map_err(|error| Error::Custom(format!("Invalid world payload: {error}")))?;
            let response_world_id = world
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if response_world_id != world_id {
                return Err(Error::Custom(
                    "World payload id did not match request.".into(),
                ));
            }
            self.world_cache
                .hydrate_from_payload(&world)
                .ok_or_else(|| Error::Custom("World payload could not be cached.".into()))?;
            Ok(())
        })
    }

    fn add_world_favorite(&self, world_id: &str, group_name: &str) -> Result<()> {
        favorite_add(
            self.db,
            "world".into(),
            world_id.to_string(),
            group_name.to_string(),
        )?;
        Ok(())
    }
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
    actions.create_group(&input.group_name)?;

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
            fetch_result.and_then(|()| actions.add_world_favorite(world_id, &input.group_name));
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
mod tests {
    use std::{
        collections::HashSet,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };

    use super::*;

    #[derive(Default)]
    struct FakeActions {
        fail: HashSet<String>,
        created: AtomicUsize,
        fetched: Arc<Mutex<Vec<String>>>,
        added: Arc<Mutex<Vec<String>>>,
        cancel_on_fetch: Option<Arc<AtomicBool>>,
        cancel_on_add: Option<Arc<AtomicBool>>,
    }

    impl SharedCollectionImportActions for FakeActions {
        fn create_group(&self, _group_name: &str) -> Result<()> {
            self.created.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }

        fn fetch_and_cache_world<'a>(
            &'a self,
            world_id: &'a str,
        ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
            Box::pin(async move {
                self.fetched.lock().unwrap().push(world_id.to_string());
                if let Some(cancel) = &self.cancel_on_fetch {
                    cancel.store(true, Ordering::Release);
                }
                if self.fail.contains(world_id) {
                    Err(Error::Custom("lookup failed".into()))
                } else {
                    Ok(())
                }
            })
        }

        fn add_world_favorite(&self, world_id: &str, _group_name: &str) -> Result<()> {
            self.added.lock().unwrap().push(world_id.to_string());
            if let Some(cancel) = &self.cancel_on_add {
                cancel.store(true, Ordering::Release);
            }
            Ok(())
        }
    }

    fn world_id(index: usize) -> String {
        format!("wrld_00000000-0000-0000-0000-{index:012x}")
    }

    #[test]
    fn validates_deduplicates_and_enforces_world_limit() {
        let first = world_id(1);
        let prepared = prepare_shared_collection_import(SharedCollectionImportStartInput {
            world_ids: vec!["invalid".into(), first.clone(), first.clone()],
            group_name: " Group ".into(),
        })
        .unwrap();
        assert_eq!(prepared.world_ids, vec![first]);
        assert_eq!(prepared.group_name, "Group");

        let too_many = (0..=SHARED_COLLECTION_IMPORT_MAX_WORLDS)
            .map(world_id)
            .collect();
        assert!(
            prepare_shared_collection_import(SharedCollectionImportStartInput {
                world_ids: too_many,
                group_name: "Group".into(),
            })
            .is_err()
        );
    }

    #[tokio::test]
    async fn continues_after_item_failure_and_reports_progress() {
        let failed_id = world_id(2);
        let actions = FakeActions {
            fail: HashSet::from([failed_id.clone()]),
            ..Default::default()
        };
        let progress = Arc::new(Mutex::new(Vec::new()));
        let progress_for_callback = Arc::clone(&progress);
        let result = run_shared_collection_import_with_interval(
            &actions,
            PreparedSharedCollectionImport {
                world_ids: vec![world_id(1), failed_id, world_id(3)],
                group_name: "Group".into(),
            },
            Duration::ZERO,
            || false,
            move |value| progress_for_callback.lock().unwrap().push(value),
        )
        .await
        .unwrap();

        assert_eq!(result.processed, 3);
        assert_eq!(result.imported, 2);
        assert_eq!(result.failed, 1);
        assert_eq!(actions.fetched.lock().unwrap().len(), 3);
        assert_eq!(actions.added.lock().unwrap().len(), 2);
        assert_eq!(progress.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn cancellation_stops_before_the_next_world() {
        let actions = FakeActions::default();
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_for_check = Arc::clone(&cancelled);
        let cancelled_for_progress = Arc::clone(&cancelled);
        let result = run_shared_collection_import_with_interval(
            &actions,
            PreparedSharedCollectionImport {
                world_ids: vec![world_id(1), world_id(2)],
                group_name: "Group".into(),
            },
            Duration::ZERO,
            move || cancelled_for_check.load(Ordering::Acquire),
            move |_| cancelled_for_progress.store(true, Ordering::Release),
        )
        .await
        .unwrap();

        assert!(result.cancelled);
        assert_eq!(result.processed, 1);
        assert_eq!(result.imported, 1);
        assert_eq!(actions.fetched.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cancellation_before_start_performs_no_writes_or_fetches() {
        let actions = FakeActions::default();
        let progress = Arc::new(Mutex::new(Vec::new()));
        let progress_for_callback = Arc::clone(&progress);

        let result = run_shared_collection_import_with_interval(
            &actions,
            PreparedSharedCollectionImport {
                world_ids: vec![world_id(1)],
                group_name: "Group".into(),
            },
            Duration::ZERO,
            || true,
            move |value| progress_for_callback.lock().unwrap().push(value),
        )
        .await
        .unwrap();

        assert!(result.cancelled);
        assert_eq!(result.processed, 0);
        assert_eq!(result.imported, 0);
        assert_eq!(actions.created.load(Ordering::Acquire), 0);
        assert!(actions.fetched.lock().unwrap().is_empty());
        assert!(actions.added.lock().unwrap().is_empty());
        assert!(progress.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cancellation_during_fetch_is_not_counted_as_failure() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let actions = FakeActions {
            cancel_on_fetch: Some(Arc::clone(&cancelled)),
            ..Default::default()
        };
        let cancelled_for_check = Arc::clone(&cancelled);
        let progress = Arc::new(Mutex::new(Vec::new()));
        let progress_for_callback = Arc::clone(&progress);

        let result = run_shared_collection_import_with_interval(
            &actions,
            PreparedSharedCollectionImport {
                world_ids: vec![world_id(1)],
                group_name: "Group".into(),
            },
            Duration::ZERO,
            move || cancelled_for_check.load(Ordering::Acquire),
            move |value| progress_for_callback.lock().unwrap().push(value),
        )
        .await
        .unwrap();

        assert!(result.cancelled);
        assert_eq!(result.processed, 0);
        assert_eq!(result.imported, 0);
        assert_eq!(result.failed, 0);
        assert_eq!(result.last_error, None);
        assert!(actions.added.lock().unwrap().is_empty());
        assert!(progress.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn add_success_is_recorded_before_observing_cancellation() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let actions = FakeActions {
            cancel_on_add: Some(Arc::clone(&cancelled)),
            ..Default::default()
        };
        let cancelled_for_check = Arc::clone(&cancelled);
        let progress = Arc::new(Mutex::new(Vec::new()));
        let progress_for_callback = Arc::clone(&progress);

        let result = run_shared_collection_import_with_interval(
            &actions,
            PreparedSharedCollectionImport {
                world_ids: vec![world_id(1), world_id(2)],
                group_name: "Group".into(),
            },
            Duration::ZERO,
            move || cancelled_for_check.load(Ordering::Acquire),
            move |value| progress_for_callback.lock().unwrap().push(value),
        )
        .await
        .unwrap();

        assert!(result.cancelled);
        assert_eq!(result.processed, 1);
        assert_eq!(result.imported, 1);
        assert_eq!(result.failed, 0);
        assert_eq!(actions.created.load(Ordering::Acquire), 1);
        assert_eq!(actions.fetched.lock().unwrap().len(), 1);
        assert_eq!(actions.added.lock().unwrap().len(), 1);
        assert_eq!(
            progress.lock().unwrap().as_slice(),
            &[SharedCollectionImportProgress {
                processed: 1,
                imported: 1,
                failed: 0,
                last_error: None,
            }]
        );
    }
}
