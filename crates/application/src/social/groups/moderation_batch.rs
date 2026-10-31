use futures_util::future::BoxFuture;

use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::remote::VrchatRequestPort;
use crate::scope_gate::{execute_vrchat_mutation, RemoteMutationOutcome};
use vrcx_0_application_core::{
    vrchat_api::VrchatApiRequest, AuthenticatedMutationContext, Error, Result, RuntimeEventBus,
};
use vrcx_0_core::OwnerId;

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
        owner_user_id: &OwnerId,
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
    pub expected_owner_user_id: OwnerId,
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
    pub owner_user_id: OwnerId,
    pub endpoint: String,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub skipped: u32,
    pub applied_operations: u32,
    pub failed_operations: u32,
    pub items: Vec<GroupModerationBatchItemResult>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupModerationBatchProgress {
    pub owner_user_id: OwnerId,
    pub endpoint: String,
    pub group_id: String,
    pub completed: u32,
    pub total: u32,
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
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>>;
    fn scope_matches(&self) -> bool;
    fn current_user_id(&self) -> &str;
    fn current_endpoint(&self) -> &str;
    fn report_progress(&self, _progress: GroupModerationBatchProgress) {}
    fn wait_for_remote_slot<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
}

pub trait GroupModerationRemoteRequests: Send + Sync {
    fn kick(&self, endpoint: String, group_id: String, user_id: String)
        -> Result<VrchatApiRequest>;
    fn ban(&self, endpoint: String, group_id: String, user_id: String) -> Result<VrchatApiRequest>;
    fn unban(&self, group_id: String, user_id: String) -> Result<VrchatApiRequest>;
    fn save_note(
        &self,
        endpoint: String,
        group_id: String,
        user_id: String,
        note: String,
    ) -> Result<VrchatApiRequest>;
    fn add_role(
        &self,
        group_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<VrchatApiRequest>;
    fn remove_role(
        &self,
        group_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<VrchatApiRequest>;
}

pub struct VrchatGroupModerationBatchActions<'a> {
    remote: &'a dyn VrchatRequestPort,
    remote_requests: &'a dyn GroupModerationRemoteRequests,
    mutation: AuthenticatedMutationContext<'a>,
    pub event_bus: RuntimeEventBus,
}

impl<'a> VrchatGroupModerationBatchActions<'a> {
    pub fn new(
        remote: &'a dyn VrchatRequestPort,
        remote_requests: &'a dyn GroupModerationRemoteRequests,
        mutation: AuthenticatedMutationContext<'a>,
        event_bus: RuntimeEventBus,
    ) -> Self {
        Self {
            remote,
            remote_requests,
            mutation,
            event_bus,
        }
    }
}

impl GroupModerationBatchActions for VrchatGroupModerationBatchActions<'_> {
    fn execute<'a>(
        &'a self,
        operation: GroupModerationOperation<'a>,
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>> {
        Box::pin(async move {
            let (request, action) = match operation {
                GroupModerationOperation::Kick { group_id, user_id } => {
                    let request = self.remote_requests.kick(
                        self.mutation.scope().endpoint.clone(),
                        group_id.to_string(),
                        user_id.to_string(),
                    )?;
                    (request, "group member kick")
                }
                GroupModerationOperation::Ban { group_id, user_id } => {
                    let request = self.remote_requests.ban(
                        self.mutation.scope().endpoint.clone(),
                        group_id.to_string(),
                        user_id.to_string(),
                    )?;
                    (request, "group member ban")
                }
                GroupModerationOperation::Unban { group_id, user_id } => {
                    let request = self
                        .remote_requests
                        .unban(group_id.to_string(), user_id.to_string())?;
                    (request, "group member unban")
                }
                GroupModerationOperation::SaveNote {
                    group_id,
                    user_id,
                    note,
                } => {
                    let request = self.remote_requests.save_note(
                        self.mutation.scope().endpoint.clone(),
                        group_id.to_string(),
                        user_id.to_string(),
                        note.to_string(),
                    )?;
                    (request, "group member note update")
                }
                GroupModerationOperation::AddRole {
                    group_id,
                    user_id,
                    role_id,
                } => {
                    let request = self.remote_requests.add_role(
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
                    let request = self.remote_requests.remove_role(
                        group_id.to_string(),
                        user_id.to_string(),
                        role_id.to_string(),
                    )?;
                    (request, "group member role remove")
                }
            };
            execute_vrchat_mutation(self.remote, &self.mutation, request, action).await
        })
    }

    fn scope_matches(&self) -> bool {
        self.mutation.is_current()
    }

    fn current_user_id(&self) -> &str {
        &self.mutation.scope().current_user_id
    }

    fn current_endpoint(&self) -> &str {
        &self.mutation.scope().endpoint
    }

    fn report_progress(&self, progress: GroupModerationBatchProgress) {
        self.event_bus.emit(progress);
    }

    fn wait_for_remote_slot<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.mutation.pace(GROUP_MODERATION_REMOTE_INTERVAL).await;
        })
    }
}

pub async fn run_group_moderation_batch(
    coordinator: &GroupModerationBatchCoordinator,
    actions: &VrchatGroupModerationBatchActions<'_>,
    input: GroupModerationBatchInput,
) -> Result<GroupModerationBatchResult> {
    if input.expected_owner_user_id.as_str().trim() != actions.mutation.scope().current_user_id
        || input.expected_endpoint.trim() != actions.mutation.scope().endpoint
    {
        return Err(Error::Custom(
            "Group moderation batch is stale for the current auth scope.".into(),
        ));
    }
    let _guard = coordinator.try_begin(
        &OwnerId::new(actions.mutation.scope().current_user_id.clone()),
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
                owner_user_id: OwnerId::new(owner_user_id.clone()),
                endpoint: endpoint.clone(),
                group_id: prepared.group_id.clone(),
                completed: crate::wire_count(index + 1),
                total: crate::wire_count(total),
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
                    if outcome == RemoteMutationOutcome::AppliedScopeChanged {
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
            owner_user_id: OwnerId::new(owner_user_id.clone()),
            endpoint: endpoint.clone(),
            group_id: prepared.group_id.clone(),
            completed: crate::wire_count(index + 1),
            total: crate::wire_count(total),
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
            owner_user_id: OwnerId::new(owner_user_id.clone()),
            endpoint: endpoint.clone(),
            group_id: prepared.group_id.clone(),
            completed: crate::wire_count(total),
            total: crate::wire_count(total),
        });
    }
    Ok(summarize(
        OwnerId::new(owner_user_id),
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
) -> Result<RemoteMutationOutcome> {
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
                if outcome == RemoteMutationOutcome::AppliedScopeChanged {
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
    owner_user_id: OwnerId,
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
        total: crate::wire_count(items.len()),
        succeeded: crate::wire_count(succeeded),
        failed: crate::wire_count(items.len() - succeeded - skipped),
        skipped: crate::wire_count(skipped),
        applied_operations: crate::wire_count(applied_operations),
        failed_operations: crate::wire_count(failed_operations),
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

#[cfg(test)]
mod tests;
