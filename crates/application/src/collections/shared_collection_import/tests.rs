use futures_util::future::BoxFuture;

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
    fn create_group(&self, _group_name: &str) -> Result<i64> {
        self.created.fetch_add(1, Ordering::AcqRel);
        Ok(1)
    }

    fn fetch_and_cache_world<'a>(&'a self, world_id: &'a str) -> BoxFuture<'a, Result<()>> {
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

    fn add_world_favorite(&self, world_id: &str, _group_id: i64) -> Result<()> {
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
