use std::{collections::HashSet, future::Future, pin::Pin, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{Error, RemoteMutationGate, Result, RuntimeAuthScopeSnapshot};

use super::{
    service::unfriend_with_expected_scope,
    types::{SocialFriendMutationOutcome, SocialFriendMutationStatus, SocialMutationDeps},
};

pub const SOCIAL_UNFRIEND_BATCH_MAX_ITEMS: usize = 250;
const SOCIAL_UNFRIEND_REMOTE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialUnfriendBatchTarget {
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialUnfriendBatchInput {
    pub expected_owner_user_id: String,
    pub expected_endpoint: String,
    #[serde(default)]
    pub targets: Vec<SocialUnfriendBatchTarget>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SocialUnfriendBatchItemState {
    Applied,
    RemoteOkLocalFailed,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialUnfriendBatchItemResult {
    pub user_id: String,
    pub state: SocialUnfriendBatchItemState,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialUnfriendBatchResult {
    pub owner_user_id: String,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub local_failed: usize,
    pub scope_changed: bool,
    pub items: Vec<SocialUnfriendBatchItemResult>,
    pub last_error: Option<String>,
}

trait SocialUnfriendBatchActions: Send + Sync {
    fn unfriend<'a>(
        &'a self,
        target: &'a SocialUnfriendBatchTarget,
    ) -> Pin<Box<dyn Future<Output = Result<SocialFriendMutationOutcome>> + Send + 'a>>;
    fn scope_matches(&self) -> bool;
    fn wait_for_remote_slot<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async {})
    }
}

struct VrchatSocialUnfriendBatchActions<'a> {
    deps: SocialMutationDeps<'a>,
    expected_scope: RuntimeAuthScopeSnapshot,
    remote_mutation_gate: &'a RemoteMutationGate,
}

impl SocialUnfriendBatchActions for VrchatSocialUnfriendBatchActions<'_> {
    fn unfriend<'a>(
        &'a self,
        target: &'a SocialUnfriendBatchTarget,
    ) -> Pin<Box<dyn Future<Output = Result<SocialFriendMutationOutcome>> + Send + 'a>> {
        Box::pin(async move {
            unfriend_with_expected_scope(
                &self.deps,
                &self.expected_scope,
                &target.user_id,
                &target.display_name,
            )
            .await
        })
    }

    fn scope_matches(&self) -> bool {
        self.deps
            .auth_scope
            .snapshot()
            .generation_matches(&self.expected_scope)
    }

    fn wait_for_remote_slot<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            self.remote_mutation_gate
                .wait(&self.expected_scope, SOCIAL_UNFRIEND_REMOTE_INTERVAL)
                .await;
        })
    }
}

pub async fn unfriend_batch(
    deps: SocialMutationDeps<'_>,
    remote_mutation_gate: &RemoteMutationGate,
    input: SocialUnfriendBatchInput,
) -> Result<SocialUnfriendBatchResult> {
    let expected_scope = deps.auth_scope.snapshot();
    if !expected_scope.active {
        return Err(Error::Custom(
            "Backend social unfriend batch requires an authenticated session.".into(),
        ));
    }
    if input.expected_owner_user_id.trim() != expected_scope.current_user_id
        || input.expected_endpoint.trim() != expected_scope.endpoint
    {
        return Err(Error::Custom(
            "Backend social unfriend batch is stale for the current auth scope.".into(),
        ));
    }
    let owner_user_id = expected_scope.current_user_id.clone();
    let targets = normalize_targets(input.targets)?;
    let actions = VrchatSocialUnfriendBatchActions {
        deps,
        expected_scope,
        remote_mutation_gate,
    };
    Ok(run_social_unfriend_batch(&actions, owner_user_id, targets).await)
}

async fn run_social_unfriend_batch(
    actions: &dyn SocialUnfriendBatchActions,
    owner_user_id: String,
    targets: Vec<SocialUnfriendBatchTarget>,
) -> SocialUnfriendBatchResult {
    let mut items = targets
        .iter()
        .map(|target| SocialUnfriendBatchItemResult {
            user_id: target.user_id.clone(),
            state: SocialUnfriendBatchItemState::NotAttempted,
            message: String::new(),
        })
        .collect::<Vec<_>>();
    let mut last_error = None;
    let mut scope_changed = false;

    for (index, target) in targets.iter().enumerate() {
        if !actions.scope_matches() {
            let message = "Social unfriend batch authentication scope changed.".to_string();
            mark_not_attempted(&mut items[index..], &message);
            last_error = Some(message);
            scope_changed = true;
            break;
        }
        actions.wait_for_remote_slot().await;
        match actions.unfriend(target).await {
            Ok(outcome) => {
                items[index] = match outcome.status {
                    SocialFriendMutationStatus::Applied => SocialUnfriendBatchItemResult {
                        user_id: target.user_id.clone(),
                        state: SocialUnfriendBatchItemState::Applied,
                        message: String::new(),
                    },
                    SocialFriendMutationStatus::RemoteOkLocalFailed => {
                        SocialUnfriendBatchItemResult {
                            user_id: target.user_id.clone(),
                            state: SocialUnfriendBatchItemState::RemoteOkLocalFailed,
                            message: outcome.local_error.unwrap_or_else(|| {
                                "Remote unfriend succeeded but the local projection failed.".into()
                            }),
                        }
                    }
                };
            }
            Err(error) => {
                let message = error.to_string();
                items[index] = SocialUnfriendBatchItemResult {
                    user_id: target.user_id.clone(),
                    state: SocialUnfriendBatchItemState::Failed,
                    message: message.clone(),
                };
                last_error = Some(message);
            }
        }
        if !actions.scope_matches() {
            let message = "Social unfriend batch authentication scope changed.".to_string();
            mark_not_attempted(&mut items[index + 1..], &message);
            last_error = Some(message);
            scope_changed = true;
            break;
        }
    }

    let succeeded = items
        .iter()
        .filter(|item| {
            matches!(
                item.state,
                SocialUnfriendBatchItemState::Applied
                    | SocialUnfriendBatchItemState::RemoteOkLocalFailed
            )
        })
        .count();
    let local_failed = items
        .iter()
        .filter(|item| item.state == SocialUnfriendBatchItemState::RemoteOkLocalFailed)
        .count();
    if last_error.is_none() {
        last_error = items
            .iter()
            .rev()
            .find(|item| {
                matches!(
                    item.state,
                    SocialUnfriendBatchItemState::Failed
                        | SocialUnfriendBatchItemState::RemoteOkLocalFailed
                ) && !item.message.is_empty()
            })
            .map(|item| item.message.clone());
    }
    SocialUnfriendBatchResult {
        owner_user_id,
        total: items.len(),
        succeeded,
        failed: items.len() - succeeded,
        local_failed,
        scope_changed,
        items,
        last_error,
    }
}

fn normalize_targets(
    targets: Vec<SocialUnfriendBatchTarget>,
) -> Result<Vec<SocialUnfriendBatchTarget>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for target in targets {
        let user_id = target.user_id.trim().to_string();
        if !user_id.starts_with("usr_") || user_id.len() == "usr_".len() {
            return Err(Error::Custom(
                "Social unfriend batch contains an invalid user id.".into(),
            ));
        }
        if seen.insert(user_id.clone()) {
            normalized.push(SocialUnfriendBatchTarget {
                user_id,
                display_name: target.display_name.trim().to_string(),
            });
        }
    }
    if normalized.is_empty() {
        return Err(Error::Custom(
            "Social unfriend batch requires at least one target.".into(),
        ));
    }
    if normalized.len() > SOCIAL_UNFRIEND_BATCH_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Social unfriend batch cannot exceed {SOCIAL_UNFRIEND_BATCH_MAX_ITEMS} targets."
        )));
    }
    Ok(normalized)
}

fn mark_not_attempted(items: &mut [SocialUnfriendBatchItemResult], message: &str) {
    for item in items {
        item.message = message.to_string();
    }
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
        outcomes: Mutex<VecDeque<Result<SocialFriendMutationOutcome>>>,
        scope_current: AtomicBool,
        clear_scope_after_call: bool,
    }

    impl FakeActions {
        fn new(outcomes: Vec<Result<SocialFriendMutationOutcome>>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into()),
                scope_current: AtomicBool::new(true),
                clear_scope_after_call: false,
            }
        }
    }

    impl SocialUnfriendBatchActions for FakeActions {
        fn unfriend<'a>(
            &'a self,
            target: &'a SocialUnfriendBatchTarget,
        ) -> Pin<Box<dyn Future<Output = Result<SocialFriendMutationOutcome>> + Send + 'a>>
        {
            Box::pin(async move {
                let outcome = self
                    .outcomes
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or_else(|| Ok(SocialFriendMutationOutcome::applied(&target.user_id)));
                if self.clear_scope_after_call {
                    self.scope_current.store(false, Ordering::SeqCst);
                }
                outcome
            })
        }

        fn scope_matches(&self) -> bool {
            self.scope_current.load(Ordering::SeqCst)
        }
    }

    fn target(user_id: &str) -> SocialUnfriendBatchTarget {
        SocialUnfriendBatchTarget {
            user_id: user_id.into(),
            display_name: user_id.into(),
        }
    }

    #[tokio::test]
    async fn batch_preserves_remote_ok_local_failed_and_continues_remote_failures() {
        let actions = FakeActions::new(vec![
            Ok(SocialFriendMutationOutcome::applied("usr_a")),
            Ok(SocialFriendMutationOutcome::remote_ok_local_failed(
                "usr_b",
                "local write failed",
            )),
            Err(Error::Custom("remote failed".into())),
            Ok(SocialFriendMutationOutcome::applied("usr_d")),
        ]);

        let result = run_social_unfriend_batch(
            &actions,
            "usr_self".into(),
            vec![
                target("usr_a"),
                target("usr_b"),
                target("usr_c"),
                target("usr_d"),
            ],
        )
        .await;

        assert_eq!(result.succeeded, 3);
        assert_eq!(result.failed, 1);
        assert_eq!(result.local_failed, 1);
        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.state)
                .collect::<Vec<_>>(),
            vec![
                SocialUnfriendBatchItemState::Applied,
                SocialUnfriendBatchItemState::RemoteOkLocalFailed,
                SocialUnfriendBatchItemState::Failed,
                SocialUnfriendBatchItemState::Applied,
            ]
        );
    }

    #[tokio::test]
    async fn scope_change_stops_after_the_remote_terminal_outcome() {
        let mut actions = FakeActions::new(vec![Ok(
            SocialFriendMutationOutcome::remote_ok_local_failed(
                "usr_a",
                "scope changed before local projection",
            ),
        )]);
        actions.clear_scope_after_call = true;

        let result = run_social_unfriend_batch(
            &actions,
            "usr_self".into(),
            vec![target("usr_a"), target("usr_b")],
        )
        .await;

        assert_eq!(
            result.items[0].state,
            SocialUnfriendBatchItemState::RemoteOkLocalFailed
        );
        assert_eq!(
            result.items[1].state,
            SocialUnfriendBatchItemState::NotAttempted
        );
        assert!(result.scope_changed);
    }

    #[test]
    fn input_deduplicates_targets_and_enforces_the_limit() {
        let deduped = normalize_targets(vec![target("usr_a"), target("usr_a")]).unwrap();
        assert_eq!(deduped.len(), 1);

        let too_many = (0..=SOCIAL_UNFRIEND_BATCH_MAX_ITEMS)
            .map(|index| target(&format!("usr_{index}")))
            .collect();
        assert!(normalize_targets(too_many).is_err());
    }
}
