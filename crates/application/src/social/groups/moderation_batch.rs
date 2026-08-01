use std::{
    collections::{HashMap, HashSet},
    future::Future,
    pin::Pin,
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::{
    groups::{
        member_ban_input, member_kick_input, member_props_set_input, member_role_add_input,
        member_role_remove_input, member_unban_input,
    },
    http_api::{ApiScope, HttpApiRequestInput},
};

use crate::{
    Error, RemoteMutationGate, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    WebClient,
};

pub const GROUP_MODERATION_BATCH_MAX_TARGETS: usize = 250;
pub const GROUP_MODERATION_BATCH_MAX_OPERATIONS: usize = 1_000;
const GROUP_MODERATION_REMOTE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct GroupModerationBatchCoordinator {
    active: Mutex<HashSet<(String, String)>>,
}

struct GroupModerationBatchGuard<'a> {
    coordinator: &'a GroupModerationBatchCoordinator,
    key: (String, String),
}

impl GroupModerationBatchCoordinator {
    fn try_begin(
        &self,
        owner_user_id: &str,
        group_id: &str,
    ) -> Result<GroupModerationBatchGuard<'_>> {
        let key = (owner_user_id.to_string(), group_id.to_string());
        let mut active = self.active.lock().map_err(|_| {
            Error::Custom("Group moderation batch coordinator is unavailable.".into())
        })?;
        if !active.insert(key.clone()) {
            return Err(Error::Custom(
                "A group moderation batch is already running for this group.".into(),
            ));
        }
        Ok(GroupModerationBatchGuard {
            coordinator: self,
            key,
        })
    }
}

impl Drop for GroupModerationBatchGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.coordinator.active.lock() {
            active.remove(&self.key);
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GroupModerationBatchAction {
    Kick,
    Ban,
    Unban,
    SaveNote { note: String },
    AddRoles,
    RemoveRoles,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupModerationBatchTarget {
    pub user_id: String,
    #[serde(default)]
    pub role_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupModerationBatchInput {
    pub expected_owner_user_id: String,
    pub expected_endpoint: String,
    pub group_id: String,
    pub action: GroupModerationBatchAction,
    #[serde(default)]
    pub targets: Vec<GroupModerationBatchTarget>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupModerationBatchItemState {
    Applied,
    PartiallyApplied,
    Skipped,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupModerationBatchItemResult {
    pub user_id: String,
    pub state: GroupModerationBatchItemState,
    pub applied_role_ids: Vec<String>,
    pub failed_role_ids: Vec<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupModerationBatchResult {
    pub owner_user_id: String,
    pub endpoint: String,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub applied_operations: usize,
    pub failed_operations: usize,
    pub items: Vec<GroupModerationBatchItemResult>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupModerationBatchProgress {
    pub owner_user_id: String,
    pub endpoint: String,
    pub group_id: String,
    pub completed: usize,
    pub total: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GroupModerationRemoteOutcome {
    Applied,
    AppliedScopeChanged,
}

enum GroupModerationOperation<'a> {
    Kick {
        group_id: &'a str,
        user_id: &'a str,
    },
    Ban {
        group_id: &'a str,
        user_id: &'a str,
    },
    Unban {
        group_id: &'a str,
        user_id: &'a str,
    },
    SaveNote {
        group_id: &'a str,
        user_id: &'a str,
        note: &'a str,
    },
    AddRole {
        group_id: &'a str,
        user_id: &'a str,
        role_id: &'a str,
    },
    RemoveRole {
        group_id: &'a str,
        user_id: &'a str,
        role_id: &'a str,
    },
}

trait GroupModerationBatchActions: Send + Sync {
    fn execute<'a>(
        &'a self,
        operation: GroupModerationOperation<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<GroupModerationRemoteOutcome>> + Send + 'a>>;
    fn scope_matches(&self) -> bool;
    fn current_user_id(&self) -> &str;
    fn current_endpoint(&self) -> &str;
    fn report_progress(&self, _progress: GroupModerationBatchProgress) {}
    fn wait_for_remote_slot<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async {})
    }
}

pub struct VrchatGroupModerationBatchActions<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
    pub event_bus: RuntimeEventBus,
    pub remote_mutation_gate: &'a RemoteMutationGate,
}

impl VrchatGroupModerationBatchActions<'_> {
    async fn execute_request(
        &self,
        mut request: HttpApiRequestInput,
        action: &str,
    ) -> Result<GroupModerationRemoteOutcome> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        request.endpoint = Some(self.expected_scope.endpoint.clone());
        let response = self
            .web
            .execute_api(request, ApiScope::Vrchat, self.db)
            .await?;
        let fallback_payload = Value::String(response.data.clone());
        if !(200..300).contains(&response.status) {
            return Err(Error::Custom(response_error_message(
                &serde_json::from_str::<Value>(&response.data).unwrap_or(fallback_payload),
                response.status,
                action,
            )));
        }
        let payload = if response.data.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str::<Value>(&response.data).map_err(|error| {
                Error::Custom(format!("VRChat {action} returned invalid JSON: {error}"))
            })?
        };
        if payload.get("error").is_some() {
            return Err(Error::Custom(response_error_message(
                &payload,
                response.status,
                action,
            )));
        }
        if self
            .auth_scope
            .snapshot()
            .generation_matches(&self.expected_scope)
        {
            Ok(GroupModerationRemoteOutcome::Applied)
        } else {
            Ok(GroupModerationRemoteOutcome::AppliedScopeChanged)
        }
    }
}

impl GroupModerationBatchActions for VrchatGroupModerationBatchActions<'_> {
    fn execute<'a>(
        &'a self,
        operation: GroupModerationOperation<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<GroupModerationRemoteOutcome>> + Send + 'a>> {
        Box::pin(async move {
            let (request, action) = match operation {
                GroupModerationOperation::Kick { group_id, user_id } => {
                    let (_, _, request) = member_kick_input(
                        self.expected_scope.endpoint.clone(),
                        group_id.to_string(),
                        user_id.to_string(),
                    )?;
                    (request, "group member kick")
                }
                GroupModerationOperation::Ban { group_id, user_id } => {
                    let (_, _, request) = member_ban_input(
                        self.expected_scope.endpoint.clone(),
                        group_id.to_string(),
                        user_id.to_string(),
                    )?;
                    (request, "group member ban")
                }
                GroupModerationOperation::Unban { group_id, user_id } => {
                    let (_, _, request) =
                        member_unban_input(group_id.to_string(), user_id.to_string())?;
                    (request, "group member unban")
                }
                GroupModerationOperation::SaveNote {
                    group_id,
                    user_id,
                    note,
                } => {
                    let (_, _, request) = member_props_set_input(
                        self.expected_scope.endpoint.clone(),
                        group_id.to_string(),
                        user_id.to_string(),
                        Some(json!({ "managerNotes": note })),
                    )?;
                    (request, "group member note update")
                }
                GroupModerationOperation::AddRole {
                    group_id,
                    user_id,
                    role_id,
                } => {
                    let (_, _, _, request) = member_role_add_input(
                        group_id.to_string(),
                        user_id.to_string(),
                        role_id.to_string(),
                    )?;
                    (request, "group member role add")
                }
                GroupModerationOperation::RemoveRole {
                    group_id,
                    user_id,
                    role_id,
                } => {
                    let (_, _, _, request) = member_role_remove_input(
                        group_id.to_string(),
                        user_id.to_string(),
                        role_id.to_string(),
                    )?;
                    (request, "group member role remove")
                }
            };
            self.execute_request(request, action).await
        })
    }

    fn scope_matches(&self) -> bool {
        self.auth_scope
            .snapshot()
            .generation_matches(&self.expected_scope)
    }

    fn current_user_id(&self) -> &str {
        &self.expected_scope.current_user_id
    }

    fn current_endpoint(&self) -> &str {
        &self.expected_scope.endpoint
    }

    fn report_progress(&self, progress: GroupModerationBatchProgress) {
        self.event_bus.emit(progress);
    }

    fn wait_for_remote_slot<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            self.remote_mutation_gate
                .wait(&self.expected_scope, GROUP_MODERATION_REMOTE_INTERVAL)
                .await;
        })
    }
}

pub async fn run_group_moderation_batch(
    coordinator: &GroupModerationBatchCoordinator,
    actions: &VrchatGroupModerationBatchActions<'_>,
    input: GroupModerationBatchInput,
) -> Result<GroupModerationBatchResult> {
    if input.expected_owner_user_id.trim() != actions.expected_scope.current_user_id
        || input.expected_endpoint.trim() != actions.expected_scope.endpoint
    {
        return Err(Error::Custom(
            "Group moderation batch is stale for the current auth scope.".into(),
        ));
    }
    let _guard = coordinator.try_begin(
        &actions.expected_scope.current_user_id,
        input.group_id.trim(),
    )?;
    run_group_moderation_batch_with_actions(actions, input).await
}

async fn run_group_moderation_batch_with_actions(
    actions: &dyn GroupModerationBatchActions,
    input: GroupModerationBatchInput,
) -> Result<GroupModerationBatchResult> {
    let prepared = prepare_input(input)?;
    let owner_user_id = actions.current_user_id().to_string();
    let endpoint = actions.current_endpoint().to_string();
    let mut items = prepared
        .targets
        .iter()
        .map(|target| not_attempted(&target.user_id))
        .collect::<Vec<_>>();
    let mut stop_after = None;
    let total = items.len();
    let mut completed = 0;

    for (index, target) in prepared.targets.iter().enumerate() {
        if !actions.scope_matches() {
            stop_after = Some((
                index,
                "Group moderation batch authentication scope changed.".to_string(),
            ));
            break;
        }
        if should_skip_self(&prepared.action) && target.user_id == actions.current_user_id() {
            items[index] = GroupModerationBatchItemResult {
                user_id: target.user_id.clone(),
                state: GroupModerationBatchItemState::Skipped,
                applied_role_ids: Vec::new(),
                failed_role_ids: Vec::new(),
                message: "The authenticated user cannot be targeted by this action.".into(),
            };
            actions.report_progress(GroupModerationBatchProgress {
                owner_user_id: owner_user_id.clone(),
                endpoint: endpoint.clone(),
                group_id: prepared.group_id.clone(),
                completed: index + 1,
                total,
            });
            completed = index + 1;
            continue;
        }

        if is_role_action(&prepared.action) {
            let outcome =
                run_role_target(actions, &prepared.group_id, &prepared.action, target).await;
            if outcome.scope_changed {
                stop_after = Some((
                    index + 1,
                    "Group moderation batch authentication scope changed.".to_string(),
                ));
            }
            items[index] = outcome.item;
        } else {
            actions.wait_for_remote_slot().await;
            match run_single_action(
                actions,
                &prepared.group_id,
                &prepared.action,
                &target.user_id,
            )
            .await
            {
                Ok(outcome) => {
                    items[index] = applied(&target.user_id);
                    if outcome == GroupModerationRemoteOutcome::AppliedScopeChanged {
                        stop_after = Some((
                            index + 1,
                            "Group moderation batch authentication scope changed.".to_string(),
                        ));
                    }
                }
                Err(error) => {
                    items[index] = failed(&target.user_id, error.to_string());
                }
            }
        }

        actions.report_progress(GroupModerationBatchProgress {
            owner_user_id: owner_user_id.clone(),
            endpoint: endpoint.clone(),
            group_id: prepared.group_id.clone(),
            completed: index + 1,
            total,
        });
        completed = index + 1;
        if stop_after.is_some() {
            break;
        }
    }

    let scope_error = stop_after.map(|(start, message)| {
        for item in items.iter_mut().skip(start) {
            item.message = message.clone();
        }
        message
    });
    if completed < total {
        actions.report_progress(GroupModerationBatchProgress {
            owner_user_id: owner_user_id.clone(),
            endpoint: endpoint.clone(),
            group_id: prepared.group_id.clone(),
            completed: total,
            total,
        });
    }
    Ok(summarize(
        owner_user_id,
        endpoint,
        items,
        scope_error,
        is_role_action(&prepared.action),
    ))
}

struct PreparedGroupModerationBatch {
    group_id: String,
    action: GroupModerationBatchAction,
    targets: Vec<GroupModerationBatchTarget>,
}

struct RoleTargetOutcome {
    item: GroupModerationBatchItemResult,
    scope_changed: bool,
}

fn prepare_input(input: GroupModerationBatchInput) -> Result<PreparedGroupModerationBatch> {
    let group_id = require_prefixed_id(input.group_id, "grp_", "group")?;
    let role_action = is_role_action(&input.action);
    let mut target_indexes = HashMap::<String, usize>::new();
    let mut targets: Vec<GroupModerationBatchTarget> = Vec::new();
    for target in input.targets {
        let user_id = require_prefixed_id(target.user_id, "usr_", "user")?;
        let role_ids = normalize_role_ids(target.role_ids)?;
        if !role_action && !role_ids.is_empty() {
            return Err(Error::Custom(
                "Only group role batch actions accept roleIds.".into(),
            ));
        }
        if let Some(index) = target_indexes.get(&user_id).copied() {
            if role_action {
                let existing = &mut targets[index].role_ids;
                for role_id in role_ids {
                    if !existing.contains(&role_id) {
                        existing.push(role_id);
                    }
                }
            }
            continue;
        }
        target_indexes.insert(user_id.clone(), targets.len());
        targets.push(GroupModerationBatchTarget { user_id, role_ids });
    }
    if targets.is_empty() {
        return Err(Error::Custom(
            "Group moderation batch requires at least one target.".into(),
        ));
    }
    if targets.len() > GROUP_MODERATION_BATCH_MAX_TARGETS {
        return Err(Error::Custom(format!(
            "Group moderation batch cannot exceed {GROUP_MODERATION_BATCH_MAX_TARGETS} targets."
        )));
    }
    let operation_count = if role_action {
        targets.iter().map(|target| target.role_ids.len()).sum()
    } else {
        targets.len()
    };
    if operation_count > GROUP_MODERATION_BATCH_MAX_OPERATIONS {
        return Err(Error::Custom(format!(
            "Group moderation batch cannot exceed {GROUP_MODERATION_BATCH_MAX_OPERATIONS} operations."
        )));
    }
    Ok(PreparedGroupModerationBatch {
        group_id,
        action: input.action,
        targets,
    })
}

async fn run_single_action(
    actions: &dyn GroupModerationBatchActions,
    group_id: &str,
    action: &GroupModerationBatchAction,
    user_id: &str,
) -> Result<GroupModerationRemoteOutcome> {
    let operation = match action {
        GroupModerationBatchAction::Kick => GroupModerationOperation::Kick { group_id, user_id },
        GroupModerationBatchAction::Ban => GroupModerationOperation::Ban { group_id, user_id },
        GroupModerationBatchAction::Unban => GroupModerationOperation::Unban { group_id, user_id },
        GroupModerationBatchAction::SaveNote { note } => GroupModerationOperation::SaveNote {
            group_id,
            user_id,
            note,
        },
        GroupModerationBatchAction::AddRoles | GroupModerationBatchAction::RemoveRoles => {
            return Err(Error::Custom(
                "Group role action requires explicit role operations.".into(),
            ));
        }
    };
    actions.execute(operation).await
}

async fn run_role_target(
    actions: &dyn GroupModerationBatchActions,
    group_id: &str,
    action: &GroupModerationBatchAction,
    target: &GroupModerationBatchTarget,
) -> RoleTargetOutcome {
    let mut applied_role_ids = Vec::new();
    let mut failed_role_ids = Vec::new();
    let mut messages = Vec::new();
    let mut scope_changed = false;

    for role_id in &target.role_ids {
        if !actions.scope_matches() {
            messages.push("Group moderation batch authentication scope changed.".to_string());
            scope_changed = true;
            break;
        }
        actions.wait_for_remote_slot().await;
        let operation = match action {
            GroupModerationBatchAction::AddRoles => GroupModerationOperation::AddRole {
                group_id,
                user_id: &target.user_id,
                role_id,
            },
            GroupModerationBatchAction::RemoveRoles => GroupModerationOperation::RemoveRole {
                group_id,
                user_id: &target.user_id,
                role_id,
            },
            _ => {
                return RoleTargetOutcome {
                    item: failed(
                        &target.user_id,
                        "Group role action requires addRoles or removeRoles.".into(),
                    ),
                    scope_changed: false,
                };
            }
        };
        let result = actions.execute(operation).await;
        match result {
            Ok(outcome) => {
                applied_role_ids.push(role_id.clone());
                if outcome == GroupModerationRemoteOutcome::AppliedScopeChanged {
                    messages
                        .push("Group moderation batch authentication scope changed.".to_string());
                    scope_changed = true;
                    break;
                }
            }
            Err(error) => {
                failed_role_ids.push(role_id.clone());
                messages.push(format!("{role_id}: {error}"));
            }
        }
    }

    let state = if failed_role_ids.is_empty() && applied_role_ids.len() == target.role_ids.len() {
        GroupModerationBatchItemState::Applied
    } else if applied_role_ids.is_empty() && failed_role_ids.is_empty() {
        GroupModerationBatchItemState::NotAttempted
    } else if applied_role_ids.is_empty() {
        GroupModerationBatchItemState::Failed
    } else {
        GroupModerationBatchItemState::PartiallyApplied
    };
    RoleTargetOutcome {
        item: GroupModerationBatchItemResult {
            user_id: target.user_id.clone(),
            state,
            applied_role_ids,
            failed_role_ids,
            message: messages.join("; "),
        },
        scope_changed,
    }
}

fn summarize(
    owner_user_id: String,
    endpoint: String,
    items: Vec<GroupModerationBatchItemResult>,
    scope_error: Option<String>,
    role_action: bool,
) -> GroupModerationBatchResult {
    let succeeded = items
        .iter()
        .filter(|item| item.state == GroupModerationBatchItemState::Applied)
        .count();
    let skipped = items
        .iter()
        .filter(|item| item.state == GroupModerationBatchItemState::Skipped)
        .count();
    let applied_operations = if role_action {
        items.iter().map(|item| item.applied_role_ids.len()).sum()
    } else {
        succeeded
    };
    let failed_operations = if role_action {
        items.iter().map(|item| item.failed_role_ids.len()).sum()
    } else {
        items
            .iter()
            .filter(|item| item.state == GroupModerationBatchItemState::Failed)
            .count()
    };
    let last_error = scope_error.or_else(|| {
        items
            .iter()
            .rev()
            .find(|item| !item.message.is_empty())
            .map(|item| item.message.clone())
    });
    GroupModerationBatchResult {
        owner_user_id,
        endpoint,
        total: items.len(),
        succeeded,
        failed: items.len() - succeeded - skipped,
        skipped,
        applied_operations,
        failed_operations,
        items,
        last_error,
    }
}

fn require_prefixed_id(value: String, prefix: &str, label: &str) -> Result<String> {
    let value = value.trim().to_string();
    if value.starts_with(prefix) && value.len() > prefix.len() {
        Ok(value)
    } else {
        Err(Error::Custom(format!(
            "Group moderation batch contains an invalid {label} id."
        )))
    }
}

fn normalize_role_ids(role_ids: Vec<String>) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for role_id in role_ids {
        let role_id = require_prefixed_id(role_id, "grol_", "role")?;
        if seen.insert(role_id.clone()) {
            normalized.push(role_id);
        }
    }
    Ok(normalized)
}

fn is_role_action(action: &GroupModerationBatchAction) -> bool {
    matches!(
        action,
        GroupModerationBatchAction::AddRoles | GroupModerationBatchAction::RemoveRoles
    )
}

fn should_skip_self(action: &GroupModerationBatchAction) -> bool {
    !matches!(action, GroupModerationBatchAction::SaveNote { .. })
}

fn applied(user_id: &str) -> GroupModerationBatchItemResult {
    GroupModerationBatchItemResult {
        user_id: user_id.to_string(),
        state: GroupModerationBatchItemState::Applied,
        applied_role_ids: Vec::new(),
        failed_role_ids: Vec::new(),
        message: String::new(),
    }
}

fn failed(user_id: &str, message: String) -> GroupModerationBatchItemResult {
    GroupModerationBatchItemResult {
        user_id: user_id.to_string(),
        state: GroupModerationBatchItemState::Failed,
        applied_role_ids: Vec::new(),
        failed_role_ids: Vec::new(),
        message,
    }
}

fn not_attempted(user_id: &str) -> GroupModerationBatchItemResult {
    GroupModerationBatchItemResult {
        user_id: user_id.to_string(),
        state: GroupModerationBatchItemState::NotAttempted,
        applied_role_ids: Vec::new(),
        failed_role_ids: Vec::new(),
        message: String::new(),
    }
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_snapshot_scope_matches(current, expected, "Group moderation batch")
}

fn response_error_message(payload: &Value, status: i32, action: &str) -> String {
    crate::scope_gate::response_error_message(payload, status, action)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    use super::*;

    struct FakeActions {
        calls: Mutex<Vec<String>>,
        outcomes: Mutex<VecDeque<Result<GroupModerationRemoteOutcome>>>,
        progress: Mutex<Vec<(usize, usize)>>,
        scope_current: AtomicBool,
    }

    impl FakeActions {
        fn new(outcomes: Vec<Result<GroupModerationRemoteOutcome>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                outcomes: Mutex::new(outcomes.into()),
                progress: Mutex::new(Vec::new()),
                scope_current: AtomicBool::new(true),
            }
        }

        fn run(&self, call: String) -> Result<GroupModerationRemoteOutcome> {
            self.calls.lock().unwrap().push(call);
            self.outcomes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(GroupModerationRemoteOutcome::Applied))
        }
    }

    impl GroupModerationBatchActions for FakeActions {
        fn execute<'a>(
            &'a self,
            operation: GroupModerationOperation<'a>,
        ) -> Pin<Box<dyn Future<Output = Result<GroupModerationRemoteOutcome>> + Send + 'a>>
        {
            Box::pin(async move {
                let call = match operation {
                    GroupModerationOperation::Kick { group_id, user_id } => {
                        format!("kick:{group_id}:{user_id}")
                    }
                    GroupModerationOperation::Ban { group_id, user_id } => {
                        format!("ban:{group_id}:{user_id}")
                    }
                    GroupModerationOperation::Unban { group_id, user_id } => {
                        format!("unban:{group_id}:{user_id}")
                    }
                    GroupModerationOperation::SaveNote {
                        group_id,
                        user_id,
                        note,
                    } => format!("note:{group_id}:{user_id}:{note}"),
                    GroupModerationOperation::AddRole {
                        group_id,
                        user_id,
                        role_id,
                    } => format!("add:{group_id}:{user_id}:{role_id}"),
                    GroupModerationOperation::RemoveRole {
                        group_id,
                        user_id,
                        role_id,
                    } => format!("remove:{group_id}:{user_id}:{role_id}"),
                };
                self.run(call)
            })
        }

        fn scope_matches(&self) -> bool {
            self.scope_current.load(Ordering::SeqCst)
        }

        fn current_user_id(&self) -> &str {
            "usr_self"
        }

        fn current_endpoint(&self) -> &str {
            ""
        }

        fn report_progress(&self, progress: GroupModerationBatchProgress) {
            self.progress
                .lock()
                .unwrap()
                .push((progress.completed, progress.total));
        }
    }

    fn input(
        action: GroupModerationBatchAction,
        targets: Vec<GroupModerationBatchTarget>,
    ) -> GroupModerationBatchInput {
        GroupModerationBatchInput {
            expected_owner_user_id: "usr_self".into(),
            expected_endpoint: String::new(),
            group_id: "grp_test".into(),
            action,
            targets,
        }
    }

    fn target(user_id: &str, role_ids: &[&str]) -> GroupModerationBatchTarget {
        GroupModerationBatchTarget {
            user_id: user_id.into(),
            role_ids: role_ids.iter().map(|value| (*value).to_string()).collect(),
        }
    }

    #[tokio::test]
    async fn irreversible_batch_continues_after_item_failure_without_rollback() {
        let actions = FakeActions::new(vec![
            Ok(GroupModerationRemoteOutcome::Applied),
            Err(Error::Custom("denied".into())),
            Ok(GroupModerationRemoteOutcome::Applied),
        ]);

        let result = run_group_moderation_batch_with_actions(
            &actions,
            input(
                GroupModerationBatchAction::Kick,
                vec![
                    target("usr_a", &[]),
                    target("usr_b", &[]),
                    target("usr_c", &[]),
                ],
            ),
        )
        .await
        .unwrap();

        assert_eq!(result.succeeded, 2);
        assert_eq!(result.failed, 1);
        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.state)
                .collect::<Vec<_>>(),
            vec![
                GroupModerationBatchItemState::Applied,
                GroupModerationBatchItemState::Failed,
                GroupModerationBatchItemState::Applied,
            ]
        );
        assert_eq!(actions.calls.lock().unwrap().len(), 3);
        assert_eq!(
            *actions.progress.lock().unwrap(),
            vec![(1, 3), (2, 3), (3, 3)]
        );
    }

    #[tokio::test]
    async fn role_batch_reports_partial_target_and_keeps_explicit_operation_order() {
        let actions = FakeActions::new(vec![
            Ok(GroupModerationRemoteOutcome::Applied),
            Err(Error::Custom("role denied".into())),
            Ok(GroupModerationRemoteOutcome::Applied),
        ]);

        let result = run_group_moderation_batch_with_actions(
            &actions,
            input(
                GroupModerationBatchAction::AddRoles,
                vec![target(
                    "usr_target",
                    &["grol_one", "grol_two", "grol_three"],
                )],
            ),
        )
        .await
        .unwrap();

        assert_eq!(result.succeeded, 0);
        assert_eq!(result.failed, 1);
        assert_eq!(result.applied_operations, 2);
        assert_eq!(result.failed_operations, 1);
        assert_eq!(
            result.items[0].state,
            GroupModerationBatchItemState::PartiallyApplied
        );
        assert_eq!(
            result.items[0].applied_role_ids,
            vec!["grol_one", "grol_three"]
        );
        assert_eq!(result.items[0].failed_role_ids, vec!["grol_two"]);
        assert_eq!(
            *actions.calls.lock().unwrap(),
            vec![
                "add:grp_test:usr_target:grol_one",
                "add:grp_test:usr_target:grol_two",
                "add:grp_test:usr_target:grol_three",
            ]
        );
    }

    #[tokio::test]
    async fn scope_change_after_remote_success_stops_remaining_targets() {
        let actions = FakeActions::new(vec![Ok(GroupModerationRemoteOutcome::AppliedScopeChanged)]);

        let result = run_group_moderation_batch_with_actions(
            &actions,
            input(
                GroupModerationBatchAction::Ban,
                vec![target("usr_a", &[]), target("usr_b", &[])],
            ),
        )
        .await
        .unwrap();

        assert_eq!(
            result.items[0].state,
            GroupModerationBatchItemState::Applied
        );
        assert_eq!(
            result.items[1].state,
            GroupModerationBatchItemState::NotAttempted
        );
        assert_eq!(actions.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn input_rejects_more_than_the_operation_limit() {
        let role_ids = (0..=GROUP_MODERATION_BATCH_MAX_OPERATIONS)
            .map(|index| format!("grol_{index}"))
            .collect();

        let result = prepare_input(GroupModerationBatchInput {
            expected_owner_user_id: "usr_self".into(),
            expected_endpoint: String::new(),
            group_id: "grp_test".into(),
            action: GroupModerationBatchAction::RemoveRoles,
            targets: vec![GroupModerationBatchTarget {
                user_id: "usr_target".into(),
                role_ids,
            }],
        });

        assert!(result.is_err());
    }

    #[test]
    fn coordinator_rejects_overlapping_batches_for_the_same_owner_and_group() {
        let coordinator = GroupModerationBatchCoordinator::default();
        let _running = coordinator.try_begin("usr_self", "grp_test").unwrap();

        assert!(coordinator.try_begin("usr_self", "grp_test").is_err());
        assert!(coordinator.try_begin("usr_other", "grp_test").is_ok());
        assert!(coordinator.try_begin("usr_self", "grp_other").is_ok());
    }
}
