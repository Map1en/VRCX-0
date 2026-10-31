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

impl GroupMembershipBatchActions for FakeActions {
    fn execute<'a>(
        &'a self,
        operation: GroupMembershipOperation<'a>,
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>> {
        Box::pin(async move {
            let call = match operation {
                GroupMembershipOperation::Leave { group_id } => format!("leave:{group_id}"),
                GroupMembershipOperation::SetVisibility {
                    group_id,
                    user_id,
                    visibility,
                } => format!("visibility:{group_id}:{user_id}:{visibility:?}"),
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

    fn report_progress(&self, progress: GroupMembershipBatchProgress) {
        self.progress
            .lock()
            .unwrap()
            .push((progress.completed, progress.total));
    }
}

fn input(action: GroupMembershipBatchAction, group_ids: &[&str]) -> GroupMembershipBatchInput {
    GroupMembershipBatchInput {
        expected_owner_user_id: OwnerId::new("usr_self"),
        expected_endpoint: String::new(),
        action,
        group_ids: group_ids.iter().map(|value| (*value).to_string()).collect(),
    }
}

#[tokio::test]
async fn leave_batch_continues_after_item_failure_without_rollback() {
    let actions = FakeActions::new(vec![
        Ok(RemoteMutationOutcome::Applied),
        Err(Error::Custom("denied".into())),
        Ok(RemoteMutationOutcome::Applied),
    ]);

    let result = run_group_membership_batch_with_actions(
        &actions,
        input(
            GroupMembershipBatchAction::Leave,
            &["grp_a", "grp_b", "grp_c"],
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
            GroupMembershipBatchItemState::Applied,
            GroupMembershipBatchItemState::Failed,
            GroupMembershipBatchItemState::Applied,
        ]
    );
    assert_eq!(
        *actions.calls.lock().unwrap(),
        vec!["leave:grp_a", "leave:grp_b", "leave:grp_c"]
    );
    assert_eq!(
        *actions.progress.lock().unwrap(),
        vec![(1, 3), (2, 3), (3, 3)]
    );
}

#[tokio::test]
async fn visibility_batch_targets_the_authenticated_member() {
    let actions = FakeActions::new(Vec::new());

    let result = run_group_membership_batch_with_actions(
        &actions,
        input(
            GroupMembershipBatchAction::SetVisibility {
                visibility: GroupMemberVisibility::Hidden,
            },
            &["grp_a", "grp_b"],
        ),
    )
    .await
    .unwrap();

    assert_eq!(result.succeeded, 2);
    assert_eq!(
        *actions.calls.lock().unwrap(),
        vec![
            "visibility:grp_a:usr_self:Hidden",
            "visibility:grp_b:usr_self:Hidden"
        ]
    );
}

#[tokio::test]
async fn scope_change_stops_the_batch_and_marks_remaining_groups() {
    let actions = FakeActions::new(vec![
        Ok(RemoteMutationOutcome::Applied),
        Ok(RemoteMutationOutcome::AppliedScopeChanged),
    ]);

    let result = run_group_membership_batch_with_actions(
        &actions,
        input(
            GroupMembershipBatchAction::Leave,
            &["grp_a", "grp_b", "grp_c"],
        ),
    )
    .await
    .unwrap();

    assert_eq!(actions.calls.lock().unwrap().len(), 2);
    assert_eq!(result.succeeded, 2);
    assert_eq!(
        result.items[2].state,
        GroupMembershipBatchItemState::NotAttempted
    );
    assert_eq!(result.items[2].message, SCOPE_CHANGED_MESSAGE);
    assert_eq!(result.last_error.as_deref(), Some(SCOPE_CHANGED_MESSAGE));
    assert_eq!(
        *actions.progress.lock().unwrap(),
        vec![(1, 3), (2, 3), (3, 3)]
    );
}

#[test]
fn prepare_input_deduplicates_groups_and_rejects_invalid_ids() {
    let prepared = prepare_input(input(
        GroupMembershipBatchAction::Leave,
        &["grp_a", " grp_a ", "grp_b"],
    ))
    .unwrap();
    assert_eq!(prepared.group_ids, vec!["grp_a", "grp_b"]);

    assert!(prepare_input(input(GroupMembershipBatchAction::Leave, &["usr_a"])).is_err());
    assert!(prepare_input(input(GroupMembershipBatchAction::Leave, &[])).is_err());
}
