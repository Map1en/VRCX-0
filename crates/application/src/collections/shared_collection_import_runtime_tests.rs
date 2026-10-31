use super::*;
use serde_json::Value;
use std::{sync::Condvar, time::Duration};
use vrcx_0_application_core::{
    FavoriteChangeScope, FavoritesChangedPayload, RuntimeAuthScope, RuntimeEventBus,
    RuntimeEventSink, TaskSupervisor,
};

fn running_inner() -> SharedCollectionImportRuntimeInner {
    SharedCollectionImportRuntimeInner {
        status: SharedCollectionImportStatus {
            run_id: "run-1".into(),
            status: SharedCollectionImportState::Running,
            total: 2,
            ..Default::default()
        },
        cancel: Some(Arc::new(AtomicBool::new(false))),
        auth_generation: 1,
    }
}

#[test]
fn cancelled_terminal_with_imports_is_prepared_once() {
    let mut inner = running_inner();
    let result = SharedCollectionImportResult {
        total: 2,
        processed: 1,
        imported: 1,
        cancelled: true,
        ..Default::default()
    };

    let terminal = prepare_terminal_result(&inner, "run-1", Ok(result.clone()));
    assert!(commit_terminal_status(
        &mut inner,
        "run-1",
        terminal.as_ref().unwrap().status.clone()
    ));
    let duplicate = prepare_terminal_result(&inner, "run-1", Ok(result));

    assert_eq!(
        terminal.as_ref().unwrap().status.status,
        SharedCollectionImportState::Cancelled
    );
    assert_eq!(terminal.unwrap().status.imported, 1);
    assert!(duplicate.is_none());
}

struct UnusedActionsFactory;

impl SharedCollectionImportActionsFactory for UnusedActionsFactory {
    fn create(&self, _endpoint: String) -> Arc<dyn SharedCollectionImportActions> {
        panic!("test runner bypasses the outbound actions factory")
    }
}

#[derive(Clone)]
struct BlockingCompletion {
    event_bus: RuntimeEventBus,
    state: Arc<(Mutex<BlockingCompletionState>, Condvar)>,
}

#[derive(Default)]
struct BlockingCompletionState {
    entered: bool,
    released: bool,
}

impl BlockingCompletion {
    fn new(event_bus: RuntimeEventBus) -> Self {
        Self {
            event_bus,
            state: Arc::default(),
        }
    }

    fn wait_until_entered(&self) {
        let (state, changed) = self.state.as_ref();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut state = state.lock().unwrap();
        while !state.entered {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            assert!(!remaining.is_zero(), "favoritesChanged was not emitted");
            let (next, timeout) = changed.wait_timeout(state, remaining).unwrap();
            state = next;
            assert!(
                !timeout.timed_out() || state.entered,
                "favoritesChanged was not emitted"
            );
        }
    }

    fn release(&self) {
        let (state, changed) = self.state.as_ref();
        let mut state = state.lock().unwrap();
        state.released = true;
        changed.notify_all();
    }
}

impl SharedCollectionImportCompletion for BlockingCompletion {
    fn complete(&self, scope: &RuntimeAuthScopeSnapshot, _imported: usize) {
        self.event_bus
            .emit_favorites_changed(FavoritesChangedPayload::invalidated(
                scope,
                FavoriteChangeScope::World,
                true,
                false,
            ));
        let (state, changed) = self.state.as_ref();
        let mut state = state.lock().unwrap();
        state.entered = true;
        changed.notify_all();
        while !state.released {
            state = changed.wait(state).unwrap();
        }
    }
}

#[derive(Clone, Default)]
struct CapturingEventSink {
    events: Arc<Mutex<Vec<String>>>,
}

impl RuntimeEventSink for CapturingEventSink {
    fn emit(&self, event: &str, _payload: Value) {
        self.events.lock().unwrap().push(event.to_string());
    }
}

#[test]
fn terminal_status_is_committed_after_favorites_changed_delivery() {
    let event_bus = RuntimeEventBus::new();
    let capturing_sink = CapturingEventSink::default();
    event_bus.set_sink(capturing_sink.clone());
    let completion = Arc::new(BlockingCompletion::new(event_bus.clone()));
    let tasks = TaskSupervisor::new();
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_current", "https://api.vrchat.cloud/api/1");
    let runtime = SharedCollectionImportRuntime::new(
        Arc::new(UnusedActionsFactory),
        event_bus,
        tasks.clone(),
        auth_scope,
        completion.clone(),
    )
    .with_test_runner(Arc::new(|prepared, cancel| {
        Box::pin(async move {
            while !cancel.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            Ok(SharedCollectionImportResult {
                total: prepared.world_ids.len(),
                processed: 1,
                imported: 1,
                cancelled: true,
                ..Default::default()
            })
        })
    }));
    let input = SharedCollectionImportStartInput {
        world_ids: vec!["wrld_11111111-1111-1111-1111-111111111111".into()],
        group_name: "Imported worlds".into(),
    };

    let running = runtime.start(input.clone()).unwrap();
    assert_eq!(running.status, SharedCollectionImportState::Running);
    assert!(runtime
        .start(input)
        .unwrap_err()
        .to_string()
        .contains("already active"));

    let cancelling = runtime.cancel();
    assert_eq!(cancelling.status, SharedCollectionImportState::Cancelling);
    completion.wait_until_entered();
    assert_eq!(
        runtime.status().status,
        SharedCollectionImportState::Cancelling
    );
    completion.release();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while is_active_status(runtime.status().status) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }

    let terminal = runtime.status();
    assert_eq!(terminal.status, SharedCollectionImportState::Cancelled);
    assert_eq!(terminal.imported, 1);
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while capturing_sink.events.lock().unwrap().len() < 4 && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        capturing_sink.events.lock().unwrap().as_slice(),
        [
            "sharedCollectionImportStatus",
            "sharedCollectionImportStatus",
            "favoritesChanged",
            "sharedCollectionImportStatus"
        ]
    );
    tasks.stop_all();
}
