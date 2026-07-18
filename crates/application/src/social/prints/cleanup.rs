use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serde_json::Value;
use vrcx_0_application_core::vrchat_api::media::{print_delete_input, prints_get_input};
use vrcx_0_application_core::vrchat_api::VrchatScope;
pub use vrcx_0_application_core::PrintAutoCleanupEvent;
pub use vrcx_0_application_core::PrintCleanupTrigger;
use vrcx_0_application_core::{PrintCleanupInputSink, RuntimeEventBus, TaskSupervisor, WebClient};
pub use vrcx_0_application_realtime::is_print_created_content_refresh;
use vrcx_0_persistence::DatabaseService;

use super::favorites::{
    read_auto_delete_old_prints_enabled, read_auto_delete_prints_limit, read_favorite_ids,
    write_favorite_ids,
};
use crate::{Error, Result};

pub const PRINT_HARD_CAP: i64 = 64;
pub const PRINT_AUTO_DELETE_LIMIT_MIN: i64 = 30;
pub const PRINT_AUTO_DELETE_LIMIT_MAX: i64 = 60;
pub const PRINT_FAVORITE_LIMIT_BUFFER: usize = 5;
const PRINT_CLEANUP_DEBOUNCE: Duration = Duration::from_millis(2500);
const PRINT_CLEANUP_LIST_COUNT: i64 = 100;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrintListItem {
    pub id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CleanupWarningKind {
    TooManyFavorites,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupWarning {
    pub kind: CleanupWarningKind,
    pub favorites: usize,
    pub max: usize,
    pub over: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrintCleanupSelection {
    pub to_delete: Vec<String>,
    pub remaining: usize,
    pub warning: Option<CleanupWarning>,
}

#[derive(Clone)]
pub struct PrintCleanupDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub event_bus: RuntimeEventBus,
}

#[derive(Clone, Default)]
pub struct PrintCleanupQueue {
    gate: Arc<tokio::sync::Mutex<()>>,
    pending: Arc<AtomicBool>,
}

impl PrintCleanupQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn schedule(
        &self,
        tasks: &TaskSupervisor,
        deps: PrintCleanupDeps,
        trigger: PrintCleanupTrigger,
    ) {
        if trigger.user_id.trim().is_empty() || self.pending.swap(true, Ordering::AcqRel) {
            return;
        }

        let queue = self.clone();
        tasks.spawn(async move {
            tokio::time::sleep(PRINT_CLEANUP_DEBOUNCE).await;
            let _guard = queue.gate.lock().await;
            queue.pending.store(false, Ordering::Release);
            if let Err(error) = run_print_auto_cleanup(&deps, &trigger).await {
                tracing::warn!(
                    reason = %trigger.reason,
                    user_id = %trigger.user_id,
                    "print auto cleanup failed: {error}"
                );
            }
        });
    }
}

#[derive(Clone)]
pub struct PrintCleanupQueueSink {
    queue: PrintCleanupQueue,
    tasks: TaskSupervisor,
    deps: PrintCleanupDeps,
}

impl PrintCleanupQueueSink {
    pub fn new(queue: PrintCleanupQueue, tasks: TaskSupervisor, deps: PrintCleanupDeps) -> Self {
        Self { queue, tasks, deps }
    }
}

impl PrintCleanupInputSink for PrintCleanupQueueSink {
    fn schedule_print_cleanup(&self, trigger: PrintCleanupTrigger) {
        self.queue.schedule(&self.tasks, self.deps.clone(), trigger);
    }
}

pub fn clamp_print_limit(limit: i64) -> usize {
    limit.clamp(PRINT_AUTO_DELETE_LIMIT_MIN, PRINT_AUTO_DELETE_LIMIT_MAX) as usize
}

pub fn favorite_limit_for_print_limit(limit: i64) -> usize {
    clamp_print_limit(limit).saturating_sub(PRINT_FAVORITE_LIMIT_BUFFER)
}

pub fn select_prints_to_delete(
    prints: &[PrintListItem],
    limit: i64,
    favorite_ids: &HashSet<String>,
) -> PrintCleanupSelection {
    let limit = clamp_print_limit(limit);
    let existing_ids = prints
        .iter()
        .map(|print| print.id.as_str())
        .collect::<HashSet<_>>();
    let favorite_count = favorite_ids
        .iter()
        .filter(|id| existing_ids.contains(id.as_str()))
        .count();

    if prints.len() <= limit {
        return PrintCleanupSelection {
            to_delete: Vec::new(),
            remaining: prints.len(),
            warning: cleanup_warning(limit, favorite_count),
        };
    }

    let target = prints.len() - limit;
    let mut deletable = prints
        .iter()
        .filter(|print| !favorite_ids.contains(print.id.as_str()))
        .collect::<Vec<_>>();
    deletable.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let to_delete = deletable
        .into_iter()
        .take(target)
        .map(|print| print.id.clone())
        .collect::<Vec<_>>();
    let remaining = prints.len().saturating_sub(to_delete.len());

    PrintCleanupSelection {
        to_delete,
        remaining,
        warning: cleanup_warning(limit, favorite_count),
    }
}

pub fn print_list_items_from_json(value: &Value) -> Vec<PrintListItem> {
    let Some(array) = value.as_array() else {
        return Vec::new();
    };
    array
        .iter()
        .filter_map(|entry| {
            let id = text_field(entry, "id");
            if id.is_empty() {
                return None;
            }
            let mut created_at = text_field(entry, "createdAt");
            if created_at.is_empty() {
                created_at = text_field(entry, "timestamp");
            }
            Some(PrintListItem { id, created_at })
        })
        .collect()
}

pub async fn run_print_auto_cleanup(
    deps: &PrintCleanupDeps,
    trigger: &PrintCleanupTrigger,
) -> Result<Option<PrintAutoCleanupEvent>> {
    if !read_auto_delete_old_prints_enabled(&deps.db)? {
        return Ok(None);
    }

    let limit = read_auto_delete_prints_limit(&deps.db)?;
    let prints = load_prints(deps, trigger).await?;
    let existing_ids = prints
        .iter()
        .map(|print| print.id.clone())
        .collect::<HashSet<_>>();
    let stored_favorite_ids = read_favorite_ids(&deps.db)?;
    let favorite_ids_list = stored_favorite_ids
        .iter()
        .filter(|id| existing_ids.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    let favorite_ids = favorite_ids_list.iter().cloned().collect::<HashSet<_>>();
    if favorite_ids_list.len() != stored_favorite_ids.len() {
        write_favorite_ids(&deps.db, &favorite_ids_list)?;
    }

    let selection = select_prints_to_delete(&prints, limit, &favorite_ids);
    let mut deleted = 0usize;
    for print_id in &selection.to_delete {
        match delete_print(deps, trigger, print_id).await {
            Ok(()) => deleted += 1,
            Err(error) => {
                tracing::warn!(
                    print_id = %print_id,
                    reason = %trigger.reason,
                    "print auto cleanup delete failed: {error}"
                );
            }
        }
    }

    let event = PrintAutoCleanupEvent {
        deleted,
        remaining: prints.len().saturating_sub(deleted),
        warning: selection
            .warning
            .as_ref()
            .map(|warning| cleanup_warning_event_kind(&warning.kind).to_string()),
    };
    deps.event_bus.emit_prints_auto_cleanup(event.clone());
    Ok(Some(event))
}

fn cleanup_warning(limit: usize, favorite_count: usize) -> Option<CleanupWarning> {
    let favorite_limit = favorite_limit_for_print_limit(limit as i64);
    if favorite_count > favorite_limit {
        return Some(CleanupWarning {
            kind: CleanupWarningKind::TooManyFavorites,
            favorites: favorite_count,
            max: favorite_limit,
            over: favorite_count - favorite_limit,
        });
    }

    None
}

async fn load_prints(
    deps: &PrintCleanupDeps,
    trigger: &PrintCleanupTrigger,
) -> Result<Vec<PrintListItem>> {
    let response = deps
        .web
        .execute_api(
            prints_get_input(
                trigger.endpoint.clone(),
                trigger.user_id.clone(),
                PRINT_CLEANUP_LIST_COUNT,
            )?,
            VrchatScope::Vrchat,
            deps.db.as_ref(),
        )
        .await?;
    if !(200..300).contains(&response.status) {
        return Err(Error::Custom(format!(
            "print auto cleanup list failed with HTTP {}",
            response.status
        )));
    }
    let json = serde_json::from_str::<Value>(&response.data)?;
    Ok(print_list_items_from_json(&json))
}

async fn delete_print(
    deps: &PrintCleanupDeps,
    trigger: &PrintCleanupTrigger,
    print_id: &str,
) -> Result<()> {
    let response = deps
        .web
        .execute_api(
            print_delete_input(trigger.endpoint.clone(), print_id.to_string())?,
            VrchatScope::Vrchat,
            deps.db.as_ref(),
        )
        .await?;
    if !(200..300).contains(&response.status) {
        return Err(Error::Custom(format!(
            "print auto cleanup delete {print_id} failed with HTTP {}",
            response.status
        )));
    }
    Ok(())
}

fn cleanup_warning_event_kind(kind: &CleanupWarningKind) -> &'static str {
    match kind {
        CleanupWarningKind::TooManyFavorites => "too_many_favorites",
    }
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_print_limit, favorite_limit_for_print_limit, is_print_created_content_refresh,
        print_list_items_from_json, select_prints_to_delete, CleanupWarningKind, PrintCleanupDeps,
        PrintCleanupQueue, PrintCleanupTrigger, PrintListItem, PRINT_CLEANUP_DEBOUNCE,
    };
    use serde_json::json;
    use std::collections::HashSet;
    use std::path::PathBuf;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;
    use vrcx_0_application_core::{
        RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskSupervisor,
    };
    use vrcx_0_core::realtime::RealtimeWsMessagePayload;

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
    fn cleanup_queue_uses_2500ms_debounce_and_keeps_one_flight_pending() {
        let supervisor = TaskSupervisor::new();
        let executor = CountingTaskExecutor::default();
        let spawned = Arc::clone(&executor.spawned);
        supervisor.set_executor(executor);
        let queue = PrintCleanupQueue::new();
        let _dir = TestDir::new("print-cleanup-queue");
        let deps = test_deps(&_dir.path);
        let trigger = PrintCleanupTrigger {
            user_id: "usr_self".into(),
            endpoint: "https://api.vrchat.cloud/api/1".into(),
            reason: "test".into(),
        };

        assert_eq!(PRINT_CLEANUP_DEBOUNCE, Duration::from_millis(2500));
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

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_deps(path: &std::path::Path) -> PrintCleanupDeps {
        let db = Arc::new(
            vrcx_0_persistence::DatabaseService::new(&path.join("VRCX-0.sqlite3")).unwrap(),
        );
        let storage =
            vrcx_0_persistence::storage::StorageService::new(&path.join("storage.json")).unwrap();
        let web = Arc::new(
            crate::WebClient::new(
                &storage,
                db.as_ref(),
                "wss://pipeline.vrchat.cloud".into(),
                env!("CARGO_PKG_VERSION"),
            )
            .unwrap(),
        );
        PrintCleanupDeps {
            db,
            web,
            event_bus: vrcx_0_application_core::RuntimeEventBus::new(),
        }
    }
}
