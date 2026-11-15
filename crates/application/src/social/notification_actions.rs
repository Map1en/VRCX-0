use futures_util::future::BoxFuture;

use std::{collections::HashSet, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::NotificationKind;

const NOTIFICATION_MARK_SEEN_MAX_RETRIES: usize = 3;
const NOTIFICATION_MARK_SEEN_BASE_DELAY: Duration = Duration::from_millis(1_000);
pub const NOTIFICATION_MARK_SEEN_MAX_ITEMS: usize = 1_000;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenBatchItem {
    pub id: String,
    pub version: i64,
    #[serde(rename = "type")]
    pub notification_type: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenBatchInput {
    #[serde(default)]
    pub items: Vec<NotificationMarkSeenBatchItem>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationMarkSeenItemState {
    Succeeded,
    RemoteFailed,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationMarkSeenEffect {
    Seen,
    Expired,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenItemResult {
    pub id: String,
    pub state: NotificationMarkSeenItemState,
    pub effect: NotificationMarkSeenEffect,
    pub attempts: u32,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenBatchResult {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub items: Vec<NotificationMarkSeenItemResult>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationLocalRead {
    pub id: String,
    pub version: i64,
    pub effect: NotificationMarkSeenEffect,
}

pub struct NotificationRemoteActionError {
    message: String,
    retryable: bool,
    not_found: bool,
}

impl NotificationRemoteActionError {
    pub fn terminal(error: impl ToString) -> Self {
        Self {
            message: error.to_string(),
            retryable: false,
            not_found: false,
        }
    }

    pub fn response(payload: &Value, status: i32) -> Self {
        Self {
            message: response_error_message(payload, status),
            retryable: status == 429 || status >= 500,
            not_found: status == 404,
        }
    }
}

pub trait NotificationMarkSeenActions: Send + Sync {
    fn commit_local(&self, reads: Vec<NotificationLocalRead>) -> Result<()>;
    fn mark_remote<'a>(
        &'a self,
        item: &'a NotificationMarkSeenBatchItem,
    ) -> BoxFuture<'a, std::result::Result<(), NotificationRemoteActionError>>;
}

pub fn notification_mark_seen_effect(
    notification_type: &str,
    version: i64,
) -> NotificationMarkSeenEffect {
    match NotificationKind::from(notification_type) {
        NotificationKind::Invite | NotificationKind::RequestInvite if version < 2 => {
            NotificationMarkSeenEffect::Expired
        }
        _ => NotificationMarkSeenEffect::Seen,
    }
}

pub async fn mark_notifications_seen_batch(
    actions: &dyn NotificationMarkSeenActions,
    input: NotificationMarkSeenBatchInput,
) -> Result<NotificationMarkSeenBatchResult> {
    mark_notifications_seen_batch_with_delay(actions, input, NOTIFICATION_MARK_SEEN_BASE_DELAY)
        .await
}

async fn mark_notifications_seen_batch_with_delay(
    actions: &dyn NotificationMarkSeenActions,
    input: NotificationMarkSeenBatchInput,
    base_delay: Duration,
) -> Result<NotificationMarkSeenBatchResult> {
    let items = normalize_items(input.items)?;
    let reads = items
        .iter()
        .map(|item| NotificationLocalRead {
            id: item.id.clone(),
            version: item.version,
            effect: notification_mark_seen_effect(&item.notification_type, item.version),
        })
        .collect::<Vec<_>>();
    actions.commit_local(reads.clone())?;

    let mut results = Vec::with_capacity(items.len());
    let mut succeeded = 0;
    let mut failed = 0;
    let mut last_error = None;
    for (item, read) in items.into_iter().zip(reads) {
        let (attempts, result) = mark_remote_with_backoff(actions, &item, base_delay).await;
        let attempts = crate::wire_count(attempts);
        let (state, message) = match result {
            Ok(()) => (NotificationMarkSeenItemState::Succeeded, String::new()),
            Err(error) if error.not_found => {
                (NotificationMarkSeenItemState::Succeeded, error.message)
            }
            Err(error) => {
                last_error = Some(error.message.clone());
                (NotificationMarkSeenItemState::RemoteFailed, error.message)
            }
        };
        match state {
            NotificationMarkSeenItemState::Succeeded => succeeded += 1,
            NotificationMarkSeenItemState::RemoteFailed => failed += 1,
        }
        results.push(NotificationMarkSeenItemResult {
            id: item.id,
            state,
            effect: read.effect,
            attempts,
            message,
        });
    }
    Ok(NotificationMarkSeenBatchResult {
        total: crate::wire_count(results.len()),
        succeeded,
        failed,
        items: results,
        last_error,
    })
}

async fn mark_remote_with_backoff(
    actions: &dyn NotificationMarkSeenActions,
    item: &NotificationMarkSeenBatchItem,
    base_delay: Duration,
) -> (
    usize,
    std::result::Result<(), NotificationRemoteActionError>,
) {
    for attempt in 0..=NOTIFICATION_MARK_SEEN_MAX_RETRIES {
        match actions.mark_remote(item).await {
            Ok(()) => return (attempt + 1, Ok(())),
            Err(error) if error.retryable && attempt < NOTIFICATION_MARK_SEEN_MAX_RETRIES => {
                tokio::time::sleep(base_delay.saturating_mul(2u32.saturating_pow(attempt as u32)))
                    .await;
            }
            Err(error) => return (attempt + 1, Err(error)),
        }
    }
    unreachable!()
}

fn normalize_items(
    items: Vec<NotificationMarkSeenBatchItem>,
) -> Result<Vec<NotificationMarkSeenBatchItem>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for mut item in items {
        item.id = item.id.trim().to_string();
        item.notification_type = item.notification_type.trim().to_string();
        if item.id.is_empty() || item.version < 1 {
            return Err(Error::Custom(
                "Notification mark-seen batch contains an invalid notification.".into(),
            ));
        }
        if seen.insert(item.id.clone()) {
            normalized.push(item);
        }
    }
    let items = normalized;
    if items.is_empty() {
        Err(Error::Custom(
            "Notification mark-seen batch requires at least one notification.".into(),
        ))
    } else if items.len() > NOTIFICATION_MARK_SEEN_MAX_ITEMS {
        Err(Error::Custom(format!(
            "Notification mark-seen batch cannot exceed {NOTIFICATION_MARK_SEEN_MAX_ITEMS} items."
        )))
    } else {
        Ok(items)
    }
}

fn response_error_message(payload: &Value, status: i32) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("VRChat notification mark-seen failed with HTTP {status}."))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Clone, Copy)]
    enum RemoteFailure {
        Retryable(usize),
        NotFound,
        Terminal,
    }

    struct FakeActions {
        local_reads: Arc<Mutex<Vec<NotificationLocalRead>>>,
        calls: Arc<Mutex<Vec<String>>>,
        failures: Vec<(String, RemoteFailure)>,
    }

    impl FakeActions {
        fn new(failures: Vec<(&str, RemoteFailure)>) -> Self {
            Self {
                local_reads: Arc::new(Mutex::new(Vec::new())),
                calls: Arc::new(Mutex::new(Vec::new())),
                failures: failures
                    .into_iter()
                    .map(|(id, failure)| (id.to_string(), failure))
                    .collect(),
            }
        }
    }

    impl NotificationMarkSeenActions for FakeActions {
        fn commit_local(&self, reads: Vec<NotificationLocalRead>) -> Result<()> {
            assert!(self.calls.lock().unwrap().is_empty());
            *self.local_reads.lock().unwrap() = reads;
            Ok(())
        }

        fn mark_remote<'a>(
            &'a self,
            item: &'a NotificationMarkSeenBatchItem,
        ) -> BoxFuture<'a, std::result::Result<(), NotificationRemoteActionError>> {
            Box::pin(async move {
                let mut calls = self.calls.lock().unwrap();
                calls.push(item.id.clone());
                let attempts = calls.iter().filter(|id| *id == &item.id).count();
                let failure = self
                    .failures
                    .iter()
                    .find(|(id, _)| id == &item.id)
                    .map(|(_, failure)| *failure);
                match failure {
                    Some(RemoteFailure::Retryable(count)) if attempts <= count => {
                        Err(NotificationRemoteActionError::response(&Value::Null, 429))
                    }
                    Some(RemoteFailure::NotFound) => {
                        Err(NotificationRemoteActionError::response(&Value::Null, 404))
                    }
                    Some(RemoteFailure::Terminal) => {
                        Err(NotificationRemoteActionError::response(&Value::Null, 400))
                    }
                    _ => Ok(()),
                }
            })
        }
    }

    fn item(id: &str, version: i64, notification_type: &str) -> NotificationMarkSeenBatchItem {
        NotificationMarkSeenBatchItem {
            id: id.into(),
            version,
            notification_type: notification_type.into(),
        }
    }

    async fn run(
        actions: &FakeActions,
        items: Vec<NotificationMarkSeenBatchItem>,
    ) -> NotificationMarkSeenBatchResult {
        mark_notifications_seen_batch_with_delay(
            actions,
            NotificationMarkSeenBatchInput { items },
            Duration::ZERO,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn commits_every_row_locally_before_marking_remote_rows_serially() {
        let actions = FakeActions::new(vec![("system", RemoteFailure::Retryable(2))]);

        let output = run(
            &actions,
            vec![
                item("system", 2, "group.announcement"),
                item("invite", 1, "invite"),
                item("friend", 1, "friendRequest"),
            ],
        )
        .await;

        assert_eq!(
            *actions.local_reads.lock().unwrap(),
            vec![
                NotificationLocalRead {
                    id: "system".into(),
                    version: 2,
                    effect: NotificationMarkSeenEffect::Seen,
                },
                NotificationLocalRead {
                    id: "invite".into(),
                    version: 1,
                    effect: NotificationMarkSeenEffect::Expired,
                },
                NotificationLocalRead {
                    id: "friend".into(),
                    version: 1,
                    effect: NotificationMarkSeenEffect::Seen,
                },
            ]
        );
        assert_eq!(
            *actions.calls.lock().unwrap(),
            vec!["system", "system", "system", "invite", "friend"]
        );
        assert_eq!(output.succeeded, 3);
        assert_eq!(output.failed, 0);
        assert_eq!(output.items[0].attempts, 3);
        assert_eq!(output.items[1].effect, NotificationMarkSeenEffect::Expired);
    }

    #[tokio::test]
    async fn remote_failure_keeps_the_local_read_and_does_not_stop_later_rows() {
        let actions = FakeActions::new(vec![
            ("rate-limited", RemoteFailure::Retryable(10)),
            ("rejected", RemoteFailure::Terminal),
        ]);

        let output = run(
            &actions,
            vec![
                item("rate-limited", 2, "boop"),
                item("rejected", 2, "group.invite"),
                item("ok", 2, "group.invite"),
            ],
        )
        .await;

        assert_eq!(actions.local_reads.lock().unwrap().len(), 3);
        assert_eq!(output.succeeded, 1);
        assert_eq!(output.failed, 2);
        assert_eq!(output.items[0].attempts, 4);
        assert_eq!(
            output.items[0].state,
            NotificationMarkSeenItemState::RemoteFailed
        );
        assert_eq!(output.items[1].attempts, 1);
        assert_eq!(
            output.items[1].state,
            NotificationMarkSeenItemState::RemoteFailed
        );
        assert_eq!(output.items[1].effect, NotificationMarkSeenEffect::Seen);
        assert_eq!(
            output.items[2].state,
            NotificationMarkSeenItemState::Succeeded
        );
    }

    #[tokio::test]
    async fn remote_not_found_counts_as_already_read() {
        let actions = FakeActions::new(vec![("gone", RemoteFailure::NotFound)]);

        let output = run(&actions, vec![item("gone", 1, "requestInvite")]).await;

        assert_eq!(output.succeeded, 1);
        assert_eq!(output.failed, 0);
        assert_eq!(output.last_error, None);
        assert_eq!(
            output.items[0].state,
            NotificationMarkSeenItemState::Succeeded
        );
        assert_eq!(output.items[0].effect, NotificationMarkSeenEffect::Expired);
    }

    #[test]
    fn only_v1_invites_expire_when_read() {
        assert_eq!(
            notification_mark_seen_effect("invite", 1),
            NotificationMarkSeenEffect::Expired
        );
        assert_eq!(
            notification_mark_seen_effect("requestInvite", 1),
            NotificationMarkSeenEffect::Expired
        );
        assert_eq!(
            notification_mark_seen_effect("invite", 2),
            NotificationMarkSeenEffect::Seen
        );
        assert_eq!(
            notification_mark_seen_effect("friendRequest", 1),
            NotificationMarkSeenEffect::Seen
        );
        assert_eq!(
            notification_mark_seen_effect("group.invite", 2),
            NotificationMarkSeenEffect::Seen
        );
    }

    #[test]
    fn validation_rejects_invalid_rows_instead_of_dropping_them() {
        assert!(normalize_items(vec![item("", 2, "boop")]).is_err());
        assert!(normalize_items(vec![item("notification", 0, "boop")]).is_err());
    }
}
