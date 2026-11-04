use super::*;
use crate::social::{MutualGraphLinkOutput, MutualGraphMetaOutput, MutualGraphSnapshotOutput};
use serde_json::{json, Value};
use std::sync::Condvar;
use vrcx_0_application_core::{
    RuntimeEventSink, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle,
};

struct NoopMutualGraphStore;

impl MutualGraphStore for NoopMutualGraphStore {
    fn friend_refresh_commit(
        &self,
        _owner_user_id: String,
        _friend_id: String,
        _mutual_ids: Option<Vec<String>>,
        _total_count: Option<usize>,
        _opted_out: bool,
    ) -> Result<()> {
        Ok(())
    }

    fn snapshot_get(&self, _owner_user_id: String) -> Result<MutualGraphSnapshotOutput> {
        Ok(MutualGraphSnapshotOutput {
            friend_ids: Vec::new(),
            links: Vec::new(),
            meta: Vec::new(),
        })
    }

    fn snapshot_commit(
        &self,
        _owner_user_id: String,
        _entries: Vec<MutualGraphSnapshotEntryInput>,
        _meta: Vec<MutualGraphMetaInput>,
    ) -> Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
struct DropTaskExecutor;

struct FinishedTaskHandle;

impl RuntimeTaskExecutor for DropTaskExecutor {
    fn spawn(&self, _task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        Box::new(FinishedTaskHandle)
    }
}

impl RuntimeTaskHandle for FinishedTaskHandle {
    fn abort(&self) {}

    fn is_finished(&self) -> bool {
        true
    }

    fn join_or_abort(&mut self, _timeout: Duration) {}
}

#[derive(Default)]
struct ReorderedDeliveryState {
    cancelling_entered: (Mutex<bool>, Condvar),
    cancelled_delivered: (Mutex<bool>, Condvar),
    delivered: Mutex<Vec<Value>>,
}

#[derive(Clone, Default)]
struct ReorderedDeliverySink {
    state: Arc<ReorderedDeliveryState>,
}

impl ReorderedDeliverySink {
    fn wait_for_cancelling(&self) {
        let (entered, ready) = &self.state.cancelling_entered;
        let mut entered = entered.lock().unwrap();
        while !*entered {
            entered = ready.wait(entered).unwrap();
        }
    }

    fn delivered(&self) -> Vec<Value> {
        self.state.delivered.lock().unwrap().clone()
    }
}

impl RuntimeEventSink for ReorderedDeliverySink {
    fn emit(&self, event: &str, payload: Value) {
        if event != "mutualGraphFetchStatus" {
            return;
        }
        if payload["status"] == "cancelling" {
            let (entered, ready) = &self.state.cancelling_entered;
            *entered.lock().unwrap() = true;
            ready.notify_all();

            let (delivered, ready) = &self.state.cancelled_delivered;
            let mut delivered = delivered.lock().unwrap();
            while !*delivered {
                delivered = ready.wait(delivered).unwrap();
            }
        }

        self.state.delivered.lock().unwrap().push(payload.clone());
        if payload["status"] == "cancelled" {
            let (delivered, ready) = &self.state.cancelled_delivered;
            *delivered.lock().unwrap() = true;
            ready.notify_all();
        }
    }
}

#[test]
fn auth_scope_change_cancels_the_fetch_guard() {
    let auth_scope = RuntimeAuthScope::new();
    let expected_scope = auth_scope.set("usr_owner", "");
    let cancel_flag = AtomicBool::new(false);

    assert!(!fetch_should_cancel(
        &cancel_flag,
        &auth_scope,
        &expected_scope
    ));

    auth_scope.set("usr_other", "");

    assert!(fetch_should_cancel(
        &cancel_flag,
        &auth_scope,
        &expected_scope
    ));
}

#[test]
fn fetch_scope_uses_the_authenticated_owner_and_endpoint() {
    let auth_scope = RuntimeAuthScope::new();
    let expected = auth_scope.set("usr_owner", "https://api.example.test/api/1");
    let input = MutualGraphFetchStartInput {
        owner_user_id: OwnerId::new("usr_owner"),
        endpoint: "https://stale.example.test/api/1".into(),
        friend_ids: vec!["usr_friend".into()],
    };

    let (owner_user_id, endpoint, scope) = resolve_fetch_scope(&input, &auth_scope).unwrap();

    assert_eq!(owner_user_id, expected.current_user_id);
    assert_eq!(endpoint, expected.endpoint);
    assert_eq!(scope.generation, expected.generation);
}

#[test]
fn fetch_scope_rejects_a_different_owner() {
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_owner", "");
    let input = MutualGraphFetchStartInput {
        owner_user_id: OwnerId::new("usr_other"),
        endpoint: String::new(),
        friend_ids: vec!["usr_friend".into()],
    };

    assert!(resolve_fetch_scope(&input, &auth_scope).is_err());
}

#[test]
fn start_emits_a_running_status_before_the_job_is_spawned() {
    let remote = Arc::new(crate::remote::TestVrchatRequestPort);
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_owner", "https://api.example.test/api/1");
    let event_bus = RuntimeEventBus::new();
    let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
    let tasks = TaskSupervisor::new();
    tasks.set_executor(DropTaskExecutor);

    let started = runtime
        .start(
            MutualGraphFetchStartInput {
                owner_user_id: OwnerId::new("usr_owner"),
                endpoint: String::new(),
                friend_ids: vec!["usr_friend".into()],
            },
            Arc::new(NoopMutualGraphStore),
            remote,
            auth_scope,
            tasks.clone(),
        )
        .unwrap();

    assert_eq!(started.status, MutualGraphFetchState::Running);
    assert_eq!(started.revision, 1);
    let events = event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "mutualGraphFetchStatus");
    assert_eq!(events[0].payload["status"], json!("running"));
    assert_eq!(events[0].payload["revision"], json!(1));
    tasks.stop_all();
}

#[test]
fn cancel_active_marks_the_running_fetch_as_cancelling() {
    let event_bus = RuntimeEventBus::new();
    let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut inner = runtime.shared.state.lock().unwrap();
        inner.status = MutualGraphFetchStatus {
            run_id: 7,
            revision: 1,
            status: MutualGraphFetchState::Running,
            owner_user_id: OwnerId::new("usr_owner"),
            total_friends: 2,
            ..idle_status()
        };
        inner.cancel_flag = Some(Arc::clone(&cancel_flag));
    }

    let status = runtime.cancel_active().unwrap();

    assert_eq!(status.status, MutualGraphFetchState::Cancelling);
    assert_eq!(status.revision, 2);
    assert!(status.cancel_requested);
    assert!(cancel_flag.load(Ordering::Acquire));
    let events = event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "mutualGraphFetchStatus");
    assert_eq!(events[0].payload["status"], json!("cancelling"));
    assert_eq!(events[0].payload["revision"], json!(2));
}

#[test]
fn progress_and_terminal_transitions_emit_typed_status_events() {
    let event_bus = RuntimeEventBus::new();
    let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
    {
        let mut inner = runtime.shared.state.lock().unwrap();
        inner.status = MutualGraphFetchStatus {
            run_id: 7,
            revision: 1,
            status: MutualGraphFetchState::Running,
            owner_user_id: OwnerId::new("usr_owner"),
            total_friends: 2,
            ..idle_status()
        };
    }

    runtime.update_current_friend(7, "usr_friend");
    runtime.update_progress(7, 1, 1, 0, 0, None);
    runtime.finish_run(7, MutualGraphFetchState::Completed, None);

    let events = event_bus.take_events_for_test();
    assert_eq!(events.len(), 3);
    assert!(events
        .iter()
        .all(|event| event.name == "mutualGraphFetchStatus"));
    assert_eq!(events[0].payload["currentFriendId"], json!("usr_friend"));
    assert_eq!(events[0].payload["revision"], json!(2));
    assert_eq!(events[1].payload["processedFriends"], json!(1));
    assert_eq!(events[1].payload["revision"], json!(3));
    assert_eq!(events[2].payload["status"], json!("completed"));
    assert_eq!(events[2].payload["revision"], json!(4));
    assert!(events[2].payload["finishedAt"].is_string());
}

#[test]
fn delayed_cancelling_event_has_an_older_revision_than_cancelled() {
    let event_bus = RuntimeEventBus::new();
    let sink = ReorderedDeliverySink::default();
    event_bus.set_sink(sink.clone());
    let runtime = MutualGraphFetchRuntime::with_event_bus(event_bus);
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut inner = runtime.shared.state.lock().unwrap();
        inner.status = MutualGraphFetchStatus {
            run_id: 7,
            revision: 1,
            status: MutualGraphFetchState::Running,
            owner_user_id: OwnerId::new("usr_owner"),
            total_friends: 1,
            ..idle_status()
        };
        inner.cancel_flag = Some(cancel_flag);
    }

    let cancelling_runtime = runtime.clone();
    let cancelling = std::thread::spawn(move || cancelling_runtime.cancel_active().unwrap());
    sink.wait_for_cancelling();
    let cancelled = runtime.finish_run(7, MutualGraphFetchState::Cancelled, None);
    let cancelling = cancelling.join().unwrap();

    assert_eq!(cancelling.revision, 2);
    assert_eq!(cancelled.revision, 3);
    let delivered = sink.delivered();
    assert_eq!(delivered.len(), 2);
    assert_eq!(delivered[0]["status"], json!("cancelled"));
    assert_eq!(delivered[0]["revision"], json!(3));
    assert_eq!(delivered[1]["status"], json!("cancelling"));
    assert_eq!(delivered[1]["revision"], json!(2));
    assert_eq!(runtime.status().revision, 3);
}

#[test]
fn failed_friends_keep_their_cached_snapshot_entries() {
    let mut entries = vec![MutualGraphSnapshotEntryInput {
        friend_id: "usr_ok".into(),
        mutual_ids: vec!["usr_mutual_new".into()],
    }];
    let mut meta_entries = vec![MutualGraphMetaInput {
        friend_id: "usr_ok".into(),
        last_fetched_at: "new".into(),
        opted_out: false,
        total_count: Some(1),
    }];
    let failed_friend_ids = HashSet::from(["usr_failed".to_string()]);
    let cached = MutualGraphSnapshotOutput {
        friend_ids: vec!["usr_failed".into(), "usr_removed".into()],
        links: vec![
            MutualGraphLinkOutput {
                friend_id: "usr_failed".into(),
                mutual_id: "usr_mutual_old".into(),
            },
            MutualGraphLinkOutput {
                friend_id: "usr_removed".into(),
                mutual_id: "usr_removed_mutual".into(),
            },
        ],
        meta: vec![
            MutualGraphMetaOutput {
                friend_id: "usr_failed".into(),
                last_fetched_at: "old".into(),
                opted_out: false,
                total_count: Some(3),
            },
            MutualGraphMetaOutput {
                friend_id: "usr_removed".into(),
                last_fetched_at: "removed".into(),
                opted_out: false,
                total_count: Some(4),
            },
        ],
    };

    preserve_failed_friend_cache(&mut entries, &mut meta_entries, &failed_friend_ids, cached);

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].friend_id, "usr_failed");
    assert_eq!(entries[1].mutual_ids, vec!["usr_mutual_old"]);
    assert_eq!(meta_entries.len(), 2);
    assert_eq!(meta_entries[1].friend_id, "usr_failed");
    assert_eq!(meta_entries[1].last_fetched_at, "old");
    assert_eq!(meta_entries[1].total_count, Some(3));
}
