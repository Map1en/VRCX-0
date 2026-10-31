use futures_util::future::BoxFuture;

use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serde_json::Value;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
pub use vrcx_0_application_core::PrintAutoCleanupEvent;
pub use vrcx_0_application_core::PrintCleanupTrigger;
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_application_core::{PrintCleanupInputSink, RuntimeEventBus, TaskSupervisor};
pub use vrcx_0_application_realtime::is_print_created_content_refresh;

use super::favorites::{
    read_auto_delete_old_prints_enabled, read_auto_delete_prints_limit,
    retain_existing_favorite_ids, PrintFavoritesStore,
};
use vrcx_0_application_core::{AuthenticatedMutationContext, Error, RemoteMutationGate, Result};

pub const PRINT_HARD_CAP: i64 = 64;
pub const PRINT_AUTO_DELETE_LIMIT_MIN: i64 = 30;
pub const PRINT_AUTO_DELETE_LIMIT_MAX: i64 = 60;
pub const PRINT_FAVORITE_LIMIT_BUFFER: usize = 5;
const PRINT_CLEANUP_DEBOUNCE: Duration = Duration::from_millis(2500);
const PRINT_CLEANUP_LIST_COUNT: i32 = 100;
const PRINT_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub type PrintRemoteFuture<'a> = BoxFuture<'a, Result<VrchatApiResponse>>;

pub trait PrintRemote: Send + Sync {
    fn list_prints<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        count: i32,
    ) -> PrintRemoteFuture<'a>;
    fn delete_print<'a>(&'a self, endpoint: &'a str, print_id: &'a str) -> PrintRemoteFuture<'a>;
}

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
    pub favorites: u32,
    pub max: u32,
    pub over: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrintCleanupSelection {
    pub to_delete: Vec<String>,
    pub remaining: usize,
    pub warning: Option<CleanupWarning>,
}

#[derive(Clone)]
pub struct PrintCleanupDeps {
    pub(crate) store: Arc<dyn PrintFavoritesStore>,
    pub(crate) remote: Arc<dyn PrintRemote>,
    pub event_bus: RuntimeEventBus,
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
}

impl PrintCleanupDeps {
    pub fn new(
        store: Arc<dyn PrintFavoritesStore>,
        remote: Arc<dyn PrintRemote>,
        event_bus: RuntimeEventBus,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
    ) -> Self {
        Self {
            store,
            remote,
            event_bus,
            auth_scope,
            remote_mutations,
        }
    }
}

#[derive(Default)]
struct PrintCleanupQueueInner {
    gate: tokio::sync::Mutex<()>,
    pending: AtomicBool,
}

#[derive(Clone, Default)]
pub struct PrintCleanupQueue {
    inner: Arc<PrintCleanupQueueInner>,
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
        if trigger.user_id.trim().is_empty() || self.inner.pending.swap(true, Ordering::AcqRel) {
            return;
        }

        let queue = self.clone();
        tasks.spawn(async move {
            tokio::time::sleep(PRINT_CLEANUP_DEBOUNCE).await;
            let _guard = queue.inner.gate.lock().await;
            queue.inner.pending.store(false, Ordering::Release);
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
            let id = trimmed_text_field(entry, "id");
            if id.is_empty() {
                return None;
            }
            let mut created_at = trimmed_text_field(entry, "createdAt");
            if created_at.is_empty() {
                created_at = trimmed_text_field(entry, "timestamp");
            }
            Some(PrintListItem { id, created_at })
        })
        .collect()
}

pub async fn run_print_auto_cleanup(
    deps: &PrintCleanupDeps,
    trigger: &PrintCleanupTrigger,
) -> Result<Option<PrintAutoCleanupEvent>> {
    if !read_auto_delete_old_prints_enabled(deps.store.as_ref())? {
        return Ok(None);
    }

    let mutation = AuthenticatedMutationContext::capture(
        &deps.auth_scope,
        deps.remote_mutations.as_ref(),
        "Print cleanup",
    )?;
    if trigger.user_id.trim() != mutation.scope().current_user_id
        || normalize_print_endpoint(&trigger.endpoint)
            != normalize_print_endpoint(&mutation.scope().endpoint)
    {
        return Err(Error::Custom(
            "Print cleanup authentication scope changed.".into(),
        ));
    }

    let limit = read_auto_delete_prints_limit(deps.store.as_ref())?;
    let prints = load_prints(deps, &mutation).await?;
    let existing_ids = prints
        .iter()
        .map(|print| print.id.clone())
        .collect::<HashSet<_>>();
    let favorite_ids = retain_existing_favorite_ids(
        deps.store.as_ref(),
        &mutation.scope().current_user_id,
        &existing_ids,
    )?;

    let selection = select_prints_to_delete(&prints, limit, &favorite_ids);
    let mut deleted = 0usize;
    for print_id in &selection.to_delete {
        match delete_print(deps, &mutation, print_id).await {
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
        deleted: crate::wire_count(deleted),
        remaining: crate::wire_count(prints.len().saturating_sub(deleted)),
        warning: selection
            .warning
            .as_ref()
            .map(|warning| cleanup_warning_event_kind(&warning.kind).to_string()),
    };
    deps.event_bus.emit(event.clone());
    Ok(Some(event))
}

fn cleanup_warning(limit: usize, favorite_count: usize) -> Option<CleanupWarning> {
    let favorite_limit = favorite_limit_for_print_limit(limit as i64);
    if favorite_count > favorite_limit {
        return Some(CleanupWarning {
            kind: CleanupWarningKind::TooManyFavorites,
            favorites: crate::wire_count(favorite_count),
            max: crate::wire_count(favorite_limit),
            over: crate::wire_count(favorite_count - favorite_limit),
        });
    }

    None
}

async fn load_prints(
    deps: &PrintCleanupDeps,
    mutation: &AuthenticatedMutationContext<'_>,
) -> Result<Vec<PrintListItem>> {
    let response = deps
        .remote
        .list_prints(
            &mutation.scope().endpoint,
            &mutation.scope().current_user_id,
            PRINT_CLEANUP_LIST_COUNT,
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
    mutation: &AuthenticatedMutationContext<'_>,
    print_id: &str,
) -> Result<()> {
    let response = mutation
        .run_after_wait(PRINT_REMOTE_MUTATION_INTERVAL, || async {
            deps.remote
                .delete_print(&mutation.scope().endpoint, print_id)
                .await
        })
        .await?;
    if !(200..300).contains(&response.status) {
        return Err(Error::Custom(format!(
            "print auto cleanup delete {print_id} failed with HTTP {}",
            response.status
        )));
    }
    Ok(())
}

fn normalize_print_endpoint(endpoint: &str) -> String {
    vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint(Some(endpoint))
}

fn cleanup_warning_event_kind(kind: &CleanupWarningKind) -> &'static str {
    match kind {
        CleanupWarningKind::TooManyFavorites => "too_many_favorites",
    }
}

fn trimmed_text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests;
