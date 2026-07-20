use std::{future::Future, pin::Pin, time::Duration};

use serde::{Deserialize, Serialize};
use vrcx_0_application_core::RuntimeVrchatAuthFailurePayload;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::{
    http_api::{normalize_vrchat_api_endpoint, ApiScope},
    tools::user_note_save_input,
};

use crate::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, WebClient,
};

pub const NOTE_EXPORT_MAX_ITEMS: usize = 1_000;
const NOTE_EXPORT_INTERVAL: Duration = Duration::from_secs(5);
const NOTE_EXPORT_CANCEL_POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteExportItemInput {
    pub user_id: String,
    pub display_name: String,
    pub note: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NoteExportState {
    #[default]
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NoteExportItemState {
    #[default]
    Pending,
    Succeeded,
    Failed,
    NotAttempted,
    Cancelled,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteExportItemStatus {
    pub user_id: String,
    pub display_name: String,
    pub note: String,
    pub state: NoteExportItemState,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteExportStatus {
    pub run_id: String,
    pub status: NoteExportState,
    pub total: usize,
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<NoteExportItemStatus>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteExportStartInput {
    pub items: Vec<NoteExportItemInput>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NoteExportProgress {
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<NoteExportItemStatus>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NoteExportResult {
    pub total: usize,
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub cancelled: bool,
    pub items: Vec<NoteExportItemStatus>,
    pub last_error: Option<String>,
}

pub type NoteExportFuture<'a> = Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;

pub trait NoteExportActions: Send + Sync {
    fn save_note<'a>(&'a self, user_id: &'a str, note: &'a str) -> NoteExportFuture<'a>;
}

pub struct VrchatNoteExportActions<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: &'a RuntimeAuthScopeSnapshot,
    pub event_bus: &'a RuntimeEventBus,
}

impl NoteExportActions for VrchatNoteExportActions<'_> {
    fn save_note<'a>(&'a self, user_id: &'a str, note: &'a str) -> NoteExportFuture<'a> {
        Box::pin(async move {
            let (_, request) = user_note_save_input(
                normalize_vrchat_api_endpoint(Some(&self.expected_scope.endpoint)),
                user_id.to_string(),
                note.to_string(),
            )?;
            let path = request
                .path
                .as_deref()
                .or(request.url.as_deref())
                .unwrap_or("runtime/note-export")
                .to_string();
            let response = self
                .web
                .execute_api(request, ApiScope::Vrchat, self.db)
                .await?;
            if let Some(error) = note_save_response_error(response.status, &response.data) {
                emit_note_export_auth_failure(
                    self.event_bus,
                    self.auth_scope,
                    self.expected_scope,
                    &path,
                    &error,
                    response.status,
                );
                return Err(Error::Custom(error));
            }
            Ok(())
        })
    }
}

fn emit_note_export_auth_failure(
    event_bus: &RuntimeEventBus,
    auth_scope: &RuntimeAuthScope,
    expected_scope: &RuntimeAuthScopeSnapshot,
    path: &str,
    reason: &str,
    status_code: i32,
) {
    if status_code != 401 {
        return;
    }
    let scope = auth_scope.snapshot();
    if !note_export_scope_matches(&scope, expected_scope) {
        return;
    }
    event_bus.emit_runtime_vrchat_auth_failure(RuntimeVrchatAuthFailurePayload {
        owner_user_id: scope.current_user_id,
        endpoint: scope.endpoint,
        path: path.to_string(),
        reason: reason.to_string(),
        status_code,
        auth_scope_generation: scope.generation,
        realtime_transport: None,
    });
}

fn note_export_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> bool {
    current.active
        && current.generation == expected.generation
        && current.current_user_id == expected.current_user_id
        && current.endpoint == expected.endpoint
}

fn note_save_response_error(status: i32, data: &str) -> Option<String> {
    let json = serde_json::from_str::<serde_json::Value>(data)
        .unwrap_or_else(|_| serde_json::Value::String(data.to_string()));
    if status < 400 && json.get("error").is_none() {
        return None;
    }
    let message = json
        .get("error")
        .and_then(|error| error.get("message").or(Some(error)))
        .or_else(|| json.get("message"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| json.as_str())
        .map(str::trim)
        .filter(|message| !message.is_empty());
    Some(
        message
            .map(str::to_string)
            .unwrap_or_else(|| format!("Saving user note failed with status {status}.")),
    )
}

pub fn prepare_note_export(input: NoteExportStartInput) -> Result<Vec<NoteExportItemInput>> {
    if input.items.is_empty() {
        return Err(Error::Custom(
            "Note export requires at least one item.".into(),
        ));
    }
    if input.items.len() > NOTE_EXPORT_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Note export cannot exceed {NOTE_EXPORT_MAX_ITEMS} items."
        )));
    }

    let mut seen = std::collections::HashSet::new();
    input
        .items
        .into_iter()
        .map(|item| {
            let user_id = item.user_id.trim().to_string();
            if !user_id.starts_with("usr_") || user_id.len() <= 4 {
                return Err(Error::Custom(
                    "Note export contains an invalid user id.".into(),
                ));
            }
            if !seen.insert(user_id.clone()) {
                return Err(Error::Custom(format!(
                    "Note export contains duplicate user {user_id}."
                )));
            }
            let note = item
                .note
                .replace(['\r', '\n'], " ")
                .chars()
                .take(256)
                .collect::<String>();
            Ok(NoteExportItemInput {
                display_name: if item.display_name.trim().is_empty() {
                    user_id.clone()
                } else {
                    item.display_name.trim().to_string()
                },
                user_id,
                note,
            })
        })
        .collect()
}

pub async fn run_note_export(
    actions: &dyn NoteExportActions,
    items: Vec<NoteExportItemInput>,
    should_cancel: impl Fn() -> bool,
    on_progress: impl FnMut(NoteExportProgress),
) -> NoteExportResult {
    run_note_export_with_interval(
        actions,
        items,
        NOTE_EXPORT_INTERVAL,
        should_cancel,
        on_progress,
    )
    .await
}

async fn run_note_export_with_interval(
    actions: &dyn NoteExportActions,
    items: Vec<NoteExportItemInput>,
    interval: Duration,
    should_cancel: impl Fn() -> bool,
    mut on_progress: impl FnMut(NoteExportProgress),
) -> NoteExportResult {
    let mut result = NoteExportResult {
        total: items.len(),
        items: items
            .iter()
            .map(|item| NoteExportItemStatus {
                user_id: item.user_id.clone(),
                display_name: item.display_name.clone(),
                note: item.note.clone(),
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    };

    for (index, item) in items.iter().enumerate() {
        if should_cancel()
            || (index > 0 && wait_for_note_export_interval(interval, &should_cancel).await)
        {
            result.cancelled = true;
            mark_remaining(&mut result.items[index..], NoteExportItemState::Cancelled);
            break;
        }

        match actions.save_note(&item.user_id, &item.note).await {
            Ok(()) => {
                result.processed += 1;
                result.succeeded += 1;
                result.items[index].state = NoteExportItemState::Succeeded;
            }
            Err(error) => {
                let error = error.to_string();
                result.processed += 1;
                result.failed += 1;
                result.items[index].state = NoteExportItemState::Failed;
                result.items[index].error = Some(error.clone());
                result.last_error = Some(error);
                mark_remaining(
                    &mut result.items[index + 1..],
                    NoteExportItemState::NotAttempted,
                );
            }
        }
        on_progress(NoteExportProgress {
            processed: result.processed,
            succeeded: result.succeeded,
            failed: result.failed,
            items: result.items.clone(),
            last_error: result.last_error.clone(),
        });
        if result.failed > 0 {
            break;
        }
        if should_cancel() {
            result.cancelled = true;
            mark_remaining(
                &mut result.items[index + 1..],
                NoteExportItemState::Cancelled,
            );
            break;
        }
    }

    result
}

fn mark_remaining(items: &mut [NoteExportItemStatus], state: NoteExportItemState) {
    for item in items {
        if item.state == NoteExportItemState::Pending {
            item.state = state;
        }
    }
}

async fn wait_for_note_export_interval(
    interval: Duration,
    should_cancel: &impl Fn() -> bool,
) -> bool {
    let started_at = tokio::time::Instant::now();
    loop {
        if should_cancel() {
            return true;
        }
        let elapsed = started_at.elapsed();
        if elapsed >= interval {
            return false;
        }
        tokio::time::sleep((interval - elapsed).min(NOTE_EXPORT_CANCEL_POLL)).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Default)]
    struct FakeActions {
        attempts: Arc<Mutex<Vec<String>>>,
        fail_user_id: Option<String>,
    }

    impl NoteExportActions for FakeActions {
        fn save_note<'a>(&'a self, user_id: &'a str, _note: &'a str) -> NoteExportFuture<'a> {
            Box::pin(async move {
                self.attempts.lock().unwrap().push(user_id.to_string());
                if self.fail_user_id.as_deref() == Some(user_id) {
                    Err(Error::Custom("save failed".into()))
                } else {
                    Ok(())
                }
            })
        }
    }

    fn item(user_id: &str) -> NoteExportItemInput {
        NoteExportItemInput {
            user_id: user_id.into(),
            display_name: user_id.into(),
            note: format!("note-{user_id}"),
        }
    }

    #[tokio::test]
    async fn stops_at_first_failure_without_attempting_later_items() {
        let actions = FakeActions {
            fail_user_id: Some("usr_2".into()),
            ..Default::default()
        };
        let result = run_note_export_with_interval(
            &actions,
            vec![item("usr_1"), item("usr_2"), item("usr_3")],
            Duration::ZERO,
            || false,
            |_| {},
        )
        .await;

        assert_eq!(
            actions.attempts.lock().unwrap().as_slice(),
            &["usr_1", "usr_2"]
        );
        assert_eq!(result.succeeded, 1);
        assert_eq!(result.failed, 1);
        assert_eq!(result.items[2].state, NoteExportItemState::NotAttempted);
    }

    #[tokio::test]
    async fn successful_items_remain_successful_after_a_later_failure() {
        let actions = FakeActions {
            fail_user_id: Some("usr_2".into()),
            ..Default::default()
        };
        let result = run_note_export_with_interval(
            &actions,
            vec![item("usr_1"), item("usr_2")],
            Duration::ZERO,
            || false,
            |_| {},
        )
        .await;

        assert_eq!(result.items[0].state, NoteExportItemState::Succeeded);
        assert_eq!(result.items[1].state, NoteExportItemState::Failed);
        assert_eq!(result.processed, 2);
        assert_eq!(result.succeeded, 1);
        assert_eq!(result.failed, 1);
    }

    #[tokio::test]
    async fn cancellation_marks_remaining_items_terminal_without_rollback() {
        let actions = FakeActions::default();
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cancel_for_check = Arc::clone(&cancelled);
        let cancel_for_progress = Arc::clone(&cancelled);
        let result = run_note_export_with_interval(
            &actions,
            vec![item("usr_1"), item("usr_2")],
            Duration::ZERO,
            move || cancel_for_check.load(std::sync::atomic::Ordering::Acquire),
            move |_| cancel_for_progress.store(true, std::sync::atomic::Ordering::Release),
        )
        .await;

        assert!(result.cancelled);
        assert_eq!(result.items[0].state, NoteExportItemState::Succeeded);
        assert_eq!(result.items[1].state, NoteExportItemState::Cancelled);
    }

    #[test]
    fn note_save_accepts_redirect_status_without_error_payload() {
        assert_eq!(note_save_response_error(302, "{}"), None);
    }

    #[test]
    fn note_save_rejects_error_payload_on_success_status() {
        assert_eq!(
            note_save_response_error(200, r#"{"error":{"message":"denied"}}"#),
            Some("denied".into())
        );
    }

    #[test]
    fn auth_failure_event_requires_the_original_active_scope() {
        let auth_scope = RuntimeAuthScope::new();
        let expected_scope = auth_scope.set("usr_owner", "");
        let event_bus = RuntimeEventBus::new();

        emit_note_export_auth_failure(
            &event_bus,
            &auth_scope,
            &expected_scope,
            "auth/user/usr_target/note",
            "Missing Credentials",
            401,
        );
        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "runtimeVrchatAuthFailure");
        assert_eq!(events[0].payload["ownerUserId"], "usr_owner");
        assert_eq!(events[0].payload["statusCode"], 401);

        auth_scope.set("usr_next", "");
        emit_note_export_auth_failure(
            &event_bus,
            &auth_scope,
            &expected_scope,
            "auth/user/usr_target/note",
            "Missing Credentials",
            401,
        );
        assert!(event_bus.take_events_for_test().is_empty());
    }
}
