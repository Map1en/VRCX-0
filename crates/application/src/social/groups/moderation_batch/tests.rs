use futures_util::future::BoxFuture;

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
    outcomes: Mutex<VecDeque<Result<RemoteMutationOutcome>>>,
    progress: Mutex<Vec<(u32, u32)>>,
    scope_current: AtomicBool,
}

impl FakeActions {
    fn new(outcomes: Vec<Result<RemoteMutationOutcome>>) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            outcomes: Mutex::new(outcomes.into()),
            progress: Mutex::new(Vec::new()),
            scope_current: AtomicBool::new(true),
        }
    }

    fn run(&self, call: String) -> Result<RemoteMutationOutcome> {
        self.calls.lock().unwrap().push(call);
        self.outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(RemoteMutationOutcome::Applied))
    }
}

impl GroupModerationBatchActions for FakeActions {
    fn execute<'a>(
        &'a self,
        operation: GroupModerationOperation<'a>,
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>> {
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
        expected_owner_user_id: OwnerId::new("usr_self"),
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
        Ok(RemoteMutationOutcome::Applied),
        Err(Error::Custom("denied".into())),
        Ok(RemoteMutationOutcome::Applied),
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
        Ok(RemoteMutationOutcome::Applied),
        Err(Error::Custom("role denied".into())),
        Ok(RemoteMutationOutcome::Applied),
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
    let actions = FakeActions::new(vec![Ok(RemoteMutationOutcome::AppliedScopeChanged)]);

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
        expected_owner_user_id: OwnerId::new("usr_self"),
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
    let _running = coordinator
        .try_begin(&OwnerId::new("usr_self"), "grp_test")
        .unwrap();

    assert!(coordinator
        .try_begin(&OwnerId::new("usr_self"), "grp_test")
        .is_err());
    assert!(coordinator
        .try_begin(&OwnerId::new("usr_other"), "grp_test")
        .is_ok());
    assert!(coordinator
        .try_begin(&OwnerId::new("usr_self"), "grp_other")
        .is_ok());
}
