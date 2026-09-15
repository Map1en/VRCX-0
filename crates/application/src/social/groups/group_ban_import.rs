use futures_util::future::BoxFuture;

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use vrcx_0_application_core::TaskStopToken;
use vrcx_0_core::vrchat_ids::is_user_id;

use vrcx_0_application_core::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, TaskSupervisor,
};

const GROUP_BAN_IMPORT_MAX_ITEMS: usize = 1_000;
const GROUP_BAN_IMPORT_INTERVAL: Duration = Duration::from_secs(1);
const GROUP_BAN_IMPORT_CANCEL_POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupBanImportStartInput {
    pub group_id: String,
    #[serde(default)]
    pub user_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupBanImportState {
    #[default]
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupBanImportItemState {
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupBanImportItemResult {
    pub user_id: String,
    pub state: GroupBanImportItemState,
    pub message: String,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupBanImportStatus {
    pub run_id: String,
    pub status: GroupBanImportState,
    pub group_id: String,
    pub total: u32,
    pub processed: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub cancel_requested: bool,
    pub items: Vec<GroupBanImportItemResult>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub last_error: Option<String>,
}

pub type GroupBanImportFuture<'a> = BoxFuture<'a, Result<()>>;

pub trait GroupBanImportActions: Send + Sync {
    fn ban_user<'a>(&'a self, group_id: &'a str, user_id: &'a str) -> GroupBanImportFuture<'a>;
}

#[derive(Clone)]
pub struct GroupBanImportRuntime {
    shared: Arc<GroupBanImportRuntimeShared>,
    actions: Arc<dyn GroupBanImportActions>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
    interval: Duration,
}

struct GroupBanImportRuntimeShared {
    state: Mutex<GroupBanImportRuntimeInner>,
    generation: AtomicU64,
}

#[derive(Default)]
struct GroupBanImportRuntimeInner {
    status: GroupBanImportStatus,
    cancel: Option<Arc<AtomicBool>>,
}

struct PreparedGroupBanImport {
    group_id: String,
    user_ids: Vec<String>,
}

impl GroupBanImportRuntime {
    pub fn new(
        actions: Arc<dyn GroupBanImportActions>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
    ) -> Self {
        Self {
            shared: Arc::new(GroupBanImportRuntimeShared {
                state: Mutex::new(GroupBanImportRuntimeInner::default()),
                generation: AtomicU64::new(0),
            }),
            actions,
            event_bus,
            tasks,
            auth_scope,
            interval: GROUP_BAN_IMPORT_INTERVAL,
        }
    }

    #[cfg(test)]
    fn new_with_interval(
        actions: Arc<dyn GroupBanImportActions>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
        interval: Duration,
    ) -> Self {
        Self {
            interval,
            ..Self::new(actions, event_bus, tasks, auth_scope)
        }
    }

    pub fn status(&self) -> GroupBanImportStatus {
        self.lock_inner().status.clone()
    }

    pub fn start(&self, input: GroupBanImportStartInput) -> Result<GroupBanImportStatus> {
        let prepared = prepare_group_ban_import(input)?;
        let scope = self.auth_scope.snapshot();
        require_active_scope(&scope)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let status = {
            let mut inner = self.lock_inner();
            if is_active_state(inner.status.status) {
                return Err(Error::Custom(
                    "Another group ban import is already active.".into(),
                ));
            }
            let generation = self.shared.generation.fetch_add(1, Ordering::AcqRel) + 1;
            let status = GroupBanImportStatus {
                run_id: format!("group-ban-{}-{generation}", Utc::now().timestamp_millis()),
                status: GroupBanImportState::Running,
                group_id: prepared.group_id.clone(),
                total: crate::wire_count(prepared.user_ids.len()),
                started_at: Some(Utc::now().to_rfc3339()),
                ..Default::default()
            };
            inner.status = status.clone();
            inner.cancel = Some(Arc::clone(&cancel));
            status
        };
        self.emit_status(status.clone());

        let runtime = self.clone();
        let run_id = status.run_id.clone();
        self.tasks.spawn_cancellable(move |stop_token| async move {
            runtime
                .run_job(run_id, prepared, scope, cancel, stop_token)
                .await;
        });
        Ok(status)
    }

    pub fn cancel(&self) -> GroupBanImportStatus {
        let status = {
            let mut inner = self.lock_inner();
            if !is_active_state(inner.status.status) {
                return inner.status.clone();
            }
            if let Some(cancel) = &inner.cancel {
                cancel.store(true, Ordering::Release);
            }
            inner.status.status = GroupBanImportState::Cancelling;
            inner.status.cancel_requested = true;
            inner.status.clone()
        };
        self.emit_status(status.clone());
        status
    }

    async fn run_job(
        &self,
        run_id: String,
        prepared: PreparedGroupBanImport,
        scope: RuntimeAuthScopeSnapshot,
        cancel: Arc<AtomicBool>,
        stop_token: TaskStopToken,
    ) {
        for (index, user_id) in prepared.user_ids.iter().enumerate() {
            if self.is_cancelled(&scope, cancel.as_ref(), &stop_token) {
                self.finish(&run_id, GroupBanImportState::Cancelled);
                return;
            }
            if index > 0
                && wait_for_interval(self.interval, || {
                    self.is_cancelled(&scope, cancel.as_ref(), &stop_token)
                })
                .await
            {
                self.finish(&run_id, GroupBanImportState::Cancelled);
                return;
            }

            let item = match self.actions.ban_user(&prepared.group_id, user_id).await {
                Ok(()) => GroupBanImportItemResult {
                    user_id: user_id.clone(),
                    state: GroupBanImportItemState::Succeeded,
                    message: String::new(),
                },
                Err(error) => GroupBanImportItemResult {
                    user_id: user_id.clone(),
                    state: GroupBanImportItemState::Failed,
                    message: error.to_string(),
                },
            };
            self.apply_item(&run_id, item);
            if self.is_cancelled(&scope, cancel.as_ref(), &stop_token) {
                self.finish(&run_id, GroupBanImportState::Cancelled);
                return;
            }
        }
        self.finish(&run_id, GroupBanImportState::Completed);
    }

    fn is_cancelled(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        cancel: &AtomicBool,
        stop_token: &TaskStopToken,
    ) -> bool {
        cancel.load(Ordering::Acquire)
            || stop_token.is_stop_requested()
            || ensure_scope_matches(&self.auth_scope.snapshot(), scope).is_err()
    }

    fn apply_item(&self, run_id: &str, item: GroupBanImportItemResult) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_state(inner.status.status) {
                return;
            }
            inner.status.processed += 1;
            match item.state {
                GroupBanImportItemState::Succeeded => inner.status.succeeded += 1,
                GroupBanImportItemState::Failed => {
                    inner.status.failed += 1;
                    inner.status.last_error = Some(item.message.clone());
                }
            }
            inner.status.items.push(item);
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn finish(&self, run_id: &str, state: GroupBanImportState) {
        let status = {
            let mut inner = self.lock_inner();
            if inner.status.run_id != run_id || !is_active_state(inner.status.status) {
                return;
            }
            inner.status.status = state;
            inner.status.cancel_requested = false;
            inner.status.finished_at = Some(Utc::now().to_rfc3339());
            inner.cancel = None;
            inner.status.clone()
        };
        self.emit_status(status);
    }

    fn emit_status(&self, status: GroupBanImportStatus) {
        self.event_bus.emit(status);
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, GroupBanImportRuntimeInner> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn prepare_group_ban_import(input: GroupBanImportStartInput) -> Result<PreparedGroupBanImport> {
    let group_id = input.group_id.trim().to_string();
    if group_id.is_empty() || !group_id.starts_with("grp_") {
        return Err(Error::Custom(
            "Group ban import requires a group id.".into(),
        ));
    }
    let mut seen = HashSet::new();
    let user_ids = input
        .user_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| is_user_id(id))
        .filter(|id| seen.insert(id.clone()))
        .collect::<Vec<_>>();
    if user_ids.is_empty() {
        return Err(Error::Custom(
            "Group ban import requires at least one valid user id.".into(),
        ));
    }
    if user_ids.len() > GROUP_BAN_IMPORT_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Group ban import cannot exceed {GROUP_BAN_IMPORT_MAX_ITEMS} items."
        )));
    }
    Ok(PreparedGroupBanImport { group_id, user_ids })
}

fn require_active_scope(scope: &RuntimeAuthScopeSnapshot) -> Result<()> {
    if scope.active && !scope.current_user_id.trim().is_empty() {
        Ok(())
    } else {
        Err(Error::Custom(
            "Group ban import requires an authenticated session.".into(),
        ))
    }
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_snapshot_scope_matches(current, expected, "Group ban import")
}

fn is_active_state(state: GroupBanImportState) -> bool {
    matches!(
        state,
        GroupBanImportState::Running | GroupBanImportState::Cancelling
    )
}

async fn wait_for_interval(interval: Duration, should_cancel: impl Fn() -> bool) -> bool {
    let started_at = tokio::time::Instant::now();
    loop {
        if should_cancel() {
            return true;
        }
        let elapsed = started_at.elapsed();
        if elapsed >= interval {
            return false;
        }
        tokio::time::sleep((interval - elapsed).min(GROUP_BAN_IMPORT_CANCEL_POLL)).await;
    }
}

#[cfg(test)]
mod tests;
