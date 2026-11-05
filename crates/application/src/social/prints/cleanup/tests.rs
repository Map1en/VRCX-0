use super::{
    clamp_print_limit, favorite_limit_for_print_limit, is_print_created_content_refresh,
    print_list_items_from_json, select_prints_to_delete, CleanupWarningKind, PrintCleanupDeps,
    PrintCleanupQueue, PrintCleanupTrigger, PrintListItem,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle,
    TaskSupervisor,
};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

fn item(id: &str, created_at: &str) -> PrintListItem {
    PrintListItem {
        id: id.to_string(),
        created_at: created_at.to_string(),
    }
}

fn favorite(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| (*id).to_string()).collect()
}

fn payload(json: serde_json::Value) -> RealtimeWsMessagePayload {
    RealtimeWsMessagePayload {
        json,
        raw: String::new(),
        received_at: "2026-06-29T00:00:00Z".to_string(),
    }
}

#[test]
fn deletes_oldest_non_favorite_prints_until_limit() {
    let prints = (0..33)
        .map(|index| {
            item(
                &format!("prnt_{index:02}"),
                &format!("2026-06-29T01:{index:02}:00Z"),
            )
        })
        .collect::<Vec<_>>();

    let selection = select_prints_to_delete(&prints, 30, &HashSet::new());

    assert_eq!(selection.to_delete, vec!["prnt_00", "prnt_01", "prnt_02"]);
    assert_eq!(selection.remaining, 30);
    assert_eq!(selection.warning, None);
}

#[test]
fn skips_favorite_prints_even_when_they_are_oldest() {
    let mut prints = vec![item("prnt_favorite", "2026-06-29T00:00:00Z")];
    prints.extend((0..32).map(|index| {
        item(
            &format!("prnt_deletable_{index:02}"),
            &format!("2026-06-29T00:{index:02}:00Z"),
        )
    }));

    let selection = select_prints_to_delete(&prints, 30, &favorite(&["prnt_favorite"]));

    assert_eq!(
        selection.to_delete,
        vec![
            "prnt_deletable_00",
            "prnt_deletable_01",
            "prnt_deletable_02"
        ]
    );
    assert_eq!(selection.remaining, 30);
    assert_eq!(selection.warning, None);
}

#[test]
fn warns_when_favorite_count_exceeds_the_favorite_limit() {
    let prints = (0..27)
        .map(|index| item(&format!("prnt_{index:02}"), "2026-06-29T00:00:00Z"))
        .collect::<Vec<_>>();
    let favorite_ids = prints
        .iter()
        .map(|print| print.id.as_str())
        .collect::<Vec<_>>();

    let selection = select_prints_to_delete(&prints, 30, &favorite(&favorite_ids));

    assert!(selection.to_delete.is_empty());
    assert_eq!(selection.remaining, 27);
    assert_eq!(
        selection.warning.map(|warning| warning.kind),
        Some(CleanupWarningKind::TooManyFavorites)
    );
}

#[test]
fn clamps_print_limit_to_the_supported_range() {
    assert_eq!(clamp_print_limit(1), 30);
    assert_eq!(clamp_print_limit(45), 45);
    assert_eq!(clamp_print_limit(64), 60);
    assert_eq!(favorite_limit_for_print_limit(60), 55);
}

#[test]
fn parses_print_list_items_from_vrchat_json() {
    let items = print_list_items_from_json(&json!([
        { "id": "prnt_a", "createdAt": "2026-06-29T00:00:00Z" },
        { "id": "prnt_b", "timestamp": "2026-06-29T01:00:00Z" },
        { "id": "", "createdAt": "2026-06-29T02:00:00Z" },
        { "name": "missing id" }
    ]));

    assert_eq!(
        items,
        vec![
            item("prnt_a", "2026-06-29T00:00:00Z"),
            item("prnt_b", "2026-06-29T01:00:00Z")
        ]
    );
}

#[test]
fn detects_print_created_content_refresh_messages() {
    assert!(is_print_created_content_refresh(&payload(json!({
        "type": "content-refresh",
        "content": {
            "contentType": "print",
            "actionType": "created"
        }
    }))));
    assert!(!is_print_created_content_refresh(&payload(json!({
        "type": "content-refresh",
        "content": {
            "contentType": "print",
            "actionType": "deleted"
        }
    }))));
    assert!(!is_print_created_content_refresh(&payload(json!({
        "type": "friend-online",
        "content": {
            "contentType": "print",
            "actionType": "created"
        }
    }))));
}

#[test]
fn cleanup_queue_keeps_one_flight_pending() {
    let supervisor = TaskSupervisor::new();
    let executor = CountingTaskExecutor::default();
    let spawned = Arc::clone(&executor.spawned);
    supervisor.set_executor(executor);
    let queue = PrintCleanupQueue::new();
    let deps = test_deps(Arc::new(TestPrintAdapter::new(&[], &[])));
    let trigger = PrintCleanupTrigger {
        user_id: "usr_self".into(),
        endpoint: "https://api.vrchat.cloud/api/1".into(),
        reason: "test".into(),
    };

    queue.schedule(&supervisor, deps.clone(), trigger.clone());
    queue.schedule(&supervisor, deps.clone(), trigger.clone());
    queue.schedule(&supervisor, deps, trigger);

    assert_eq!(spawned.load(Ordering::Acquire), 1);
}

#[derive(Clone, Default)]
struct CountingTaskExecutor {
    spawned: Arc<AtomicUsize>,
}

struct CountingTaskHandle {
    finished: bool,
}

impl RuntimeTaskExecutor for CountingTaskExecutor {
    fn spawn(&self, _task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        self.spawned.fetch_add(1, Ordering::AcqRel);
        Box::new(CountingTaskHandle { finished: false })
    }
}

impl RuntimeTaskHandle for CountingTaskHandle {
    fn abort(&self) {}

    fn is_finished(&self) -> bool {
        self.finished
    }

    fn join_or_abort(&mut self, _timeout: Duration) {
        self.finished = true;
    }
}

struct TestPrintAdapter {
    legacy_favorite_ids: serde_json::Value,
    favorite_ids_by_user: Mutex<HashMap<String, serde_json::Value>>,
    prints_by_user: HashMap<String, serde_json::Value>,
    deleted: Mutex<Vec<String>>,
}

impl TestPrintAdapter {
    fn new(legacy_favorite_ids: &[&str], prints_by_user: &[(&str, Vec<String>)]) -> Self {
        Self {
            legacy_favorite_ids: json!(legacy_favorite_ids),
            favorite_ids_by_user: Mutex::new(HashMap::new()),
            prints_by_user: prints_by_user
                .iter()
                .map(|(user_id, ids)| {
                    let prints = ids
                        .iter()
                        .enumerate()
                        .map(|(index, id)| {
                            json!({ "id": id, "createdAt": format!("2026-06-01T00:00:{index:02}Z") })
                        })
                        .collect::<Vec<_>>();
                    ((*user_id).to_string(), json!(prints))
                })
                .collect(),
            deleted: Mutex::new(Vec::new()),
        }
    }

    fn deleted(&self) -> Vec<String> {
        self.deleted.lock().unwrap().clone()
    }
}

impl super::super::favorites::PrintFavoritesStore for TestPrintAdapter {
    fn auto_delete_enabled(&self) -> vrcx_0_application_core::Result<bool> {
        Ok(true)
    }

    fn auto_delete_limit(&self) -> vrcx_0_application_core::Result<String> {
        Ok("30".into())
    }

    fn legacy_favorite_ids(&self) -> vrcx_0_application_core::Result<serde_json::Value> {
        Ok(self.legacy_favorite_ids.clone())
    }

    fn favorite_ids(
        &self,
        user_id: &str,
    ) -> vrcx_0_application_core::Result<Option<serde_json::Value>> {
        Ok(self
            .favorite_ids_by_user
            .lock()
            .unwrap()
            .get(user_id)
            .cloned())
    }

    fn write_favorite_ids(
        &self,
        user_id: &str,
        ids: &serde_json::Value,
    ) -> vrcx_0_application_core::Result<()> {
        self.favorite_ids_by_user
            .lock()
            .unwrap()
            .insert(user_id.to_string(), ids.clone());
        Ok(())
    }
}

impl super::PrintRemote for TestPrintAdapter {
    fn list_prints<'a>(
        &'a self,
        _endpoint: &'a str,
        user_id: &'a str,
        _count: i32,
    ) -> super::PrintRemoteFuture<'a> {
        let data = self
            .prints_by_user
            .get(user_id)
            .cloned()
            .unwrap_or_else(|| json!([]))
            .to_string();
        Box::pin(async move { Ok(VrchatResponse { status: 200, data }) })
    }

    fn delete_print<'a>(
        &'a self,
        _endpoint: &'a str,
        print_id: &'a str,
    ) -> super::PrintRemoteFuture<'a> {
        self.deleted.lock().unwrap().push(print_id.to_string());
        Box::pin(async {
            Ok(VrchatResponse {
                status: 200,
                data: "{}".into(),
            })
        })
    }
}

fn test_deps(adapter: Arc<TestPrintAdapter>) -> PrintCleanupDeps {
    PrintCleanupDeps {
        store: adapter.clone(),
        remote: adapter,
        event_bus: vrcx_0_application_core::RuntimeEventBus::new(),
        auth_scope: RuntimeAuthScope::new(),
        remote_mutations: Arc::new(RemoteMutationGate::default()),
    }
}

async fn run_cleanup_as(deps: &PrintCleanupDeps, user_id: &str) {
    deps.auth_scope.set(user_id, VRCHAT_API_DEFAULT_ENDPOINT);
    super::run_print_auto_cleanup(
        deps,
        &PrintCleanupTrigger {
            user_id: user_id.into(),
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            reason: "test".into(),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn cleanup_under_another_account_keeps_favorites_protected() {
    let account_a_prints = (0..31)
        .map(|index| format!("prnt_a_{index:02}"))
        .collect::<Vec<_>>();
    let adapter = Arc::new(TestPrintAdapter::new(
        &["prnt_a_00"],
        &[
            ("usr_a", account_a_prints),
            ("usr_b", vec!["prnt_b_00".to_string()]),
        ],
    ));
    let deps = test_deps(adapter.clone());

    run_cleanup_as(&deps, "usr_b").await;
    run_cleanup_as(&deps, "usr_a").await;

    assert_eq!(adapter.deleted(), vec!["prnt_a_01"]);
}
