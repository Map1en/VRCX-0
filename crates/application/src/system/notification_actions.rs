use std::{collections::HashSet, future::Future, pin::Pin, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_persistence::{
    notifications::{notification_mark_seen_local_bulk, notification_v2_mark_seen},
    DatabaseService,
};
use vrcx_0_vrchat_client::{http_api::ApiScope, notifications::notification_mark_seen_input};

use crate::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, WebClient};

const NOTIFICATION_MARK_SEEN_MAX_RETRIES: usize = 3;
const NOTIFICATION_MARK_SEEN_BASE_DELAY: Duration = Duration::from_millis(1_000);
pub const NOTIFICATION_MARK_SEEN_MAX_ITEMS: usize = 1_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationMarkSeenLocation {
    Remote,
    Local,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenBatchItem {
    pub id: String,
    pub version: i64,
    pub location: NotificationMarkSeenLocation,
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
    Failed,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenItemResult {
    pub id: String,
    pub state: NotificationMarkSeenItemState,
    pub attempts: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMarkSeenBatchResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<NotificationMarkSeenItemResult>,
    pub last_error: Option<String>,
}

pub struct NotificationRemoteActionError {
    message: String,
    retryable: bool,
}

impl NotificationRemoteActionError {
    fn terminal(error: impl ToString) -> Self {
        Self {
            message: error.to_string(),
            retryable: false,
        }
    }

    fn response(payload: &Value, status: i32) -> Self {
        Self {
            message: response_error_message(payload, status),
            retryable: status == 429 || status >= 500,
        }
    }
}

pub trait NotificationMarkSeenActions: Send + Sync {
    fn mark_local(&self, ids: Vec<String>) -> Result<()>;
    fn mark_remote<'a>(
        &'a self,
        item: &'a NotificationMarkSeenBatchItem,
    ) -> Pin<
        Box<
            dyn Future<Output = std::result::Result<(), NotificationRemoteActionError>> + Send + 'a,
        >,
    >;
}

pub struct VrchatNotificationMarkSeenActions<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
}

impl NotificationMarkSeenActions for VrchatNotificationMarkSeenActions<'_> {
    fn mark_local(&self, ids: Vec<String>) -> Result<()> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        notification_mark_seen_local_bulk(
            self.db,
            self.expected_scope.current_user_id.clone(),
            ids,
        )?;
        Ok(())
    }

    fn mark_remote<'a>(
        &'a self,
        item: &'a NotificationMarkSeenBatchItem,
    ) -> Pin<
        Box<
            dyn Future<Output = std::result::Result<(), NotificationRemoteActionError>> + Send + 'a,
        >,
    > {
        Box::pin(async move {
            ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)
                .map_err(NotificationRemoteActionError::terminal)?;
            let (_, id, request) = notification_mark_seen_input(
                self.expected_scope.endpoint.clone(),
                self.expected_scope.current_user_id.clone(),
                item.id.clone(),
                item.version,
            )
            .map_err(NotificationRemoteActionError::terminal)?;
            let response = self
                .web
                .execute_api(request, ApiScope::Vrchat, self.db)
                .await
                .map_err(NotificationRemoteActionError::terminal)?;
            let payload = serde_json::from_str::<Value>(&response.data)
                .unwrap_or_else(|_| Value::String(response.data.clone()));
            if response.status >= 400 || payload.get("error").is_some() {
                return Err(NotificationRemoteActionError::response(
                    &payload,
                    response.status,
                ));
            }
            ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)
                .map_err(NotificationRemoteActionError::terminal)?;
            if item.version >= 2 {
                notification_v2_mark_seen(self.db, self.expected_scope.current_user_id.clone(), id)
                    .map_err(NotificationRemoteActionError::terminal)?;
            }
            Ok(())
        })
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
    let local_ids = items
        .iter()
        .filter(|item| item.location == NotificationMarkSeenLocation::Local)
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    if !local_ids.is_empty() {
        actions.mark_local(local_ids)?;
    }

    let mut results = Vec::with_capacity(items.len());
    let mut succeeded = 0;
    let mut failed = 0;
    let mut last_error = None;
    for item in items {
        if item.location == NotificationMarkSeenLocation::Local {
            succeeded += 1;
            results.push(NotificationMarkSeenItemResult {
                id: item.id,
                state: NotificationMarkSeenItemState::Succeeded,
                attempts: 1,
                message: String::new(),
            });
            continue;
        }
        let (attempts, result) = mark_remote_with_backoff(actions, &item, base_delay).await;
        match result {
            Ok(()) => {
                succeeded += 1;
                results.push(NotificationMarkSeenItemResult {
                    id: item.id,
                    state: NotificationMarkSeenItemState::Succeeded,
                    attempts,
                    message: String::new(),
                });
            }
            Err(error) => {
                failed += 1;
                last_error = Some(error.message.clone());
                results.push(NotificationMarkSeenItemResult {
                    id: item.id,
                    state: NotificationMarkSeenItemState::Failed,
                    attempts,
                    message: error.message,
                });
            }
        }
    }
    Ok(NotificationMarkSeenBatchResult {
        total: results.len(),
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
    } else if items
        .iter()
        .any(|item| item.location == NotificationMarkSeenLocation::Local && item.version < 2)
    {
        Err(Error::Custom(
            "Only v2 notifications can be committed as local-only seen rows.".into(),
        ))
    } else {
        Ok(items)
    }
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    if current.active
        && current.generation == expected.generation
        && current.current_user_id == expected.current_user_id
        && current.endpoint == expected.endpoint
    {
        Ok(())
    } else {
        Err(Error::Custom(
            "Notification action authentication scope changed.".into(),
        ))
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

    struct FakeActions {
        local_ids: Arc<Mutex<Vec<String>>>,
        calls: Arc<Mutex<Vec<String>>>,
        retry_id: String,
        retry_failures: usize,
    }

    impl NotificationMarkSeenActions for FakeActions {
        fn mark_local(&self, ids: Vec<String>) -> Result<()> {
            *self.local_ids.lock().unwrap() = ids;
            Ok(())
        }

        fn mark_remote<'a>(
            &'a self,
            item: &'a NotificationMarkSeenBatchItem,
        ) -> Pin<
            Box<
                dyn Future<Output = std::result::Result<(), NotificationRemoteActionError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                let mut calls = self.calls.lock().unwrap();
                calls.push(item.id.clone());
                let attempts = calls.iter().filter(|id| *id == &item.id).count();
                if item.id == self.retry_id && attempts <= self.retry_failures {
                    Err(NotificationRemoteActionError {
                        message: "rate limited".into(),
                        retryable: true,
                    })
                } else {
                    Ok(())
                }
            })
        }
    }

    #[tokio::test]
    async fn mixed_batch_commits_local_rows_and_retries_remote_rows_serially() {
        let local_ids = Arc::new(Mutex::new(Vec::new()));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let actions = FakeActions {
            local_ids: Arc::clone(&local_ids),
            calls: Arc::clone(&calls),
            retry_id: "remote-a".into(),
            retry_failures: 2,
        };

        let output = mark_notifications_seen_batch_with_delay(
            &actions,
            NotificationMarkSeenBatchInput {
                items: vec![
                    NotificationMarkSeenBatchItem {
                        id: "local-system".into(),
                        version: 2,
                        location: NotificationMarkSeenLocation::Local,
                    },
                    NotificationMarkSeenBatchItem {
                        id: "remote-a".into(),
                        version: 2,
                        location: NotificationMarkSeenLocation::Remote,
                    },
                    NotificationMarkSeenBatchItem {
                        id: "remote-b".into(),
                        version: 2,
                        location: NotificationMarkSeenLocation::Remote,
                    },
                ],
            },
            Duration::ZERO,
        )
        .await
        .unwrap();

        assert_eq!(*local_ids.lock().unwrap(), vec!["local-system"]);
        assert_eq!(
            *calls.lock().unwrap(),
            vec!["remote-a", "remote-a", "remote-a", "remote-b"]
        );
        assert_eq!(output.succeeded, 3);
        assert_eq!(output.failed, 0);
        assert_eq!(output.items[1].attempts, 3);
    }

    #[tokio::test]
    async fn retry_exhaustion_is_reported_per_item_and_does_not_stop_later_rows() {
        let actions = FakeActions {
            local_ids: Arc::new(Mutex::new(Vec::new())),
            calls: Arc::new(Mutex::new(Vec::new())),
            retry_id: "remote-a".into(),
            retry_failures: 10,
        };
        let output = mark_notifications_seen_batch_with_delay(
            &actions,
            NotificationMarkSeenBatchInput {
                items: vec![
                    NotificationMarkSeenBatchItem {
                        id: "remote-a".into(),
                        version: 2,
                        location: NotificationMarkSeenLocation::Remote,
                    },
                    NotificationMarkSeenBatchItem {
                        id: "remote-b".into(),
                        version: 2,
                        location: NotificationMarkSeenLocation::Remote,
                    },
                ],
            },
            Duration::ZERO,
        )
        .await
        .unwrap();

        assert_eq!(output.succeeded, 1);
        assert_eq!(output.failed, 1);
        assert_eq!(output.items[0].attempts, 4);
        assert_eq!(
            output.items[1].state,
            NotificationMarkSeenItemState::Succeeded
        );
    }

    #[test]
    fn validation_rejects_invalid_rows_instead_of_dropping_them() {
        assert!(normalize_items(vec![NotificationMarkSeenBatchItem {
            id: String::new(),
            version: 2,
            location: NotificationMarkSeenLocation::Remote,
        }])
        .is_err());
        assert!(normalize_items(vec![NotificationMarkSeenBatchItem {
            id: "notification".into(),
            version: 0,
            location: NotificationMarkSeenLocation::Remote,
        }])
        .is_err());
    }
}
