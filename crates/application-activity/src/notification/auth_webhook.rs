use std::sync::Arc;
use vrcx_0_application_core::ConfigStore;

use serde_json::{json, Value};
use vrcx_0_application_core::{
    BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot, RuntimeDiagnostics,
    TaskStopToken, TaskSupervisor,
};

use super::webhook::{discord_webhook_url_with_wait, wait_for_webhook_stop};
use super::webhook_delivery::{WebhookDeliveryChannel, WebhookDeliveryMonitor};
use super::{
    send_json_webhook_with_retry, webhook_local_time_string, NotificationWebhookFormat,
    NotificationWebhookTransport,
};

const AUTH_WEBHOOK_ENABLED_CONFIG_KEY: &str = "webhookAuthEventsEnabled";
const AUTH_WEBHOOK_DIAGNOSTICS_KEY: &str = "authWebhook";
const AUTH_WEBHOOK_QUEUE_CAPACITY: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthWebhookEventKind {
    ReloginFailed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthWebhookEvent {
    pub kind: AuthWebhookEventKind,
    pub user_id: String,
    pub display_name: String,
    pub reason: String,
    pub mode: BackendRuntimeMode,
    pub timestamp: String,
}

struct AuthWebhookJob {
    url: String,
    payload: Value,
    event_label: &'static str,
}

struct AuthWebhookWorkerDeps {
    config: Arc<dyn ConfigStore>,
    webhook_transport: Arc<dyn NotificationWebhookTransport>,
    diagnostics: RuntimeDiagnostics,
    monitor: WebhookDeliveryMonitor,
}

pub struct AuthWebhookQueueDeps {
    pub config: Arc<dyn ConfigStore>,
    pub webhook_transport: Arc<dyn NotificationWebhookTransport>,
    pub diagnostics: RuntimeDiagnostics,
    pub monitor: WebhookDeliveryMonitor,
    pub tasks: TaskSupervisor,
}

#[derive(Clone)]
pub struct AuthWebhookQueue {
    diagnostics: RuntimeDiagnostics,
    monitor: WebhookDeliveryMonitor,
    queue: tokio::sync::mpsc::Sender<AuthWebhookEvent>,
}

impl AuthWebhookQueue {
    pub fn new(deps: AuthWebhookQueueDeps) -> Self {
        let (queue, receiver) = tokio::sync::mpsc::channel(AUTH_WEBHOOK_QUEUE_CAPACITY);
        let worker_deps = AuthWebhookWorkerDeps {
            config: deps.config,
            webhook_transport: deps.webhook_transport,
            diagnostics: deps.diagnostics.clone(),
            monitor: deps.monitor.clone(),
        };
        deps.tasks.spawn_cancellable(move |stop_token| {
            run_auth_webhook_worker(receiver, worker_deps, stop_token)
        });
        Self {
            diagnostics: deps.diagnostics,
            monitor: deps.monitor,
            queue,
        }
    }

    pub fn enqueue(&self, event: AuthWebhookEvent) {
        if let Err(error) = self.queue.try_send(event) {
            let (event_label, reason) = match error {
                tokio::sync::mpsc::error::TrySendError::Full(event) => {
                    (event.kind.as_event_name(), "queue full")
                }
                tokio::sync::mpsc::error::TrySendError::Closed(event) => {
                    (event.kind.as_event_name(), "worker stopped")
                }
            };
            self.monitor.record_drop(
                &self.diagnostics,
                AUTH_WEBHOOK_DIAGNOSTICS_KEY,
                WebhookDeliveryChannel::Auth,
                event_label,
                reason,
            );
        }
    }
}

impl AuthWebhookEventKind {
    pub fn as_event_name(self) -> &'static str {
        match self {
            Self::ReloginFailed => "auth.relogin.failed",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::ReloginFailed => "Automatic login failed",
        }
    }
}

pub fn auth_webhook_should_recover(snapshot: &BackendRuntimeSnapshot) -> bool {
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
        && snapshot.auth_status == vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated
        && !snapshot.auth_user_id.trim().is_empty()
}

pub fn auth_webhook_is_enabled(config: &dyn ConfigStore) -> bool {
    config
        .get_bool(AUTH_WEBHOOK_ENABLED_CONFIG_KEY, true)
        .unwrap_or(true)
        && !config
            .get_string("webhookUrl", "")
            .unwrap_or_default()
            .trim()
            .is_empty()
}

fn auth_webhook_job(config: &dyn ConfigStore, event: &AuthWebhookEvent) -> Option<AuthWebhookJob> {
    if !auth_webhook_is_enabled(config) {
        return None;
    }
    let url = config.get_string("webhookUrl", "").unwrap_or_default();
    let format = NotificationWebhookFormat::from_config(
        &config
            .get_string("webhookFormat", "generic")
            .unwrap_or_else(|_| "generic".into()),
    );
    let (url, payload) = match format {
        NotificationWebhookFormat::Discord => (
            discord_webhook_url_with_wait(&url),
            auth_webhook_discord_payload(event),
        ),
        NotificationWebhookFormat::Generic => {
            (url.trim().to_string(), auth_webhook_generic_payload(event))
        }
    };
    Some(AuthWebhookJob {
        url,
        payload,
        event_label: event.kind.as_event_name(),
    })
}

async fn run_auth_webhook_worker(
    mut receiver: tokio::sync::mpsc::Receiver<AuthWebhookEvent>,
    deps: AuthWebhookWorkerDeps,
    stop_token: TaskStopToken,
) {
    loop {
        let event = tokio::select! {
            event = receiver.recv() => event,
            _ = wait_for_webhook_stop(&stop_token) => return,
        };
        let Some(event) = event else {
            return;
        };
        let Some(job) = auth_webhook_job(deps.config.as_ref(), &event) else {
            continue;
        };
        tokio::select! {
            _ = deliver_auth_webhook(&deps, job) => {}
            _ = wait_for_webhook_stop(&stop_token) => return,
        }
    }
}

async fn deliver_auth_webhook(deps: &AuthWebhookWorkerDeps, job: AuthWebhookJob) {
    let result =
        send_json_webhook_with_retry(deps.webhook_transport.as_ref(), &job.url, job.payload).await;
    deps.monitor.record_result(
        &deps.diagnostics,
        AUTH_WEBHOOK_DIAGNOSTICS_KEY,
        WebhookDeliveryChannel::Auth,
        job.event_label,
        &result,
    );
}

pub fn auth_webhook_generic_payload(event: &AuthWebhookEvent) -> Value {
    json!({
        "version": 1,
        "event": event.kind.as_event_name(),
        "title": event.kind.title(),
        "message": auth_webhook_message(event),
        "user": {
            "id": &event.user_id,
            "displayName": &event.display_name,
        },
        "reason": sanitize_auth_webhook_reason(&event.reason),
        "mode": &event.mode,
        "timestamp": &event.timestamp,
        "localTime": webhook_local_time_string(&event.timestamp),
    })
}

fn auth_webhook_discord_payload(event: &AuthWebhookEvent) -> Value {
    let message = auth_webhook_message(event);
    let reason = sanitize_auth_webhook_reason(&event.reason);
    json!({
        "version": 1,
        "event": event.kind.as_event_name(),
        "title": event.kind.title(),
        "message": &message,
        "user": {
            "id": &event.user_id,
            "displayName": &event.display_name,
        },
        "reason": &reason,
        "mode": &event.mode,
        "timestamp": &event.timestamp,
        "localTime": webhook_local_time_string(&event.timestamp),
        "content": null,
        "embeds": [{
            "title": event.kind.title(),
            "description": &message,
            "fields": [
                {
                    "name": "User",
                    "value": auth_webhook_user_label(event),
                    "inline": true
                },
                {
                    "name": "Mode",
                    "value": &event.mode,
                    "inline": true
                },
                {
                    "name": "Reason",
                    "value": &reason,
                    "inline": false
                }
            ],
            "timestamp": &event.timestamp
        }]
    })
}

fn auth_webhook_message(event: &AuthWebhookEvent) -> String {
    match event.kind {
        AuthWebhookEventKind::ReloginFailed => {
            format!(
                "VRCX-0 could not automatically restore the VRChat session for {}.",
                auth_webhook_user_label(event)
            )
        }
    }
}

fn auth_webhook_user_label(event: &AuthWebhookEvent) -> String {
    if event.display_name.trim().is_empty() {
        event.user_id.clone()
    } else {
        format!("{} ({})", event.display_name, event.user_id)
    }
}

fn sanitize_auth_webhook_reason(reason: &str) -> String {
    let reason = reason.trim();
    if reason.is_empty() {
        return "Unknown auth failure.".into();
    }
    redact_sensitive_reason_terms(&reason.chars().take(300).collect::<String>())
}

fn redact_sensitive_reason_terms(reason: &str) -> String {
    reason
        .split_whitespace()
        .map(|part| {
            let normalized = part.to_ascii_lowercase();
            if normalized.contains("cookie")
                || normalized.contains("password")
                || normalized.contains("token")
            {
                "[redacted]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_payload_keeps_auth_webhook_contract_fields() {
        let payload = auth_webhook_discord_payload(&event());

        assert_eq!(payload["version"], 1);
        assert_eq!(payload["event"], "auth.relogin.failed");
        assert_eq!(payload["title"], "Automatic login failed");
        assert_eq!(payload["message"], payload["embeds"][0]["description"]);
        assert_eq!(payload["user"]["id"], "usr_123");
        assert_eq!(payload["user"]["displayName"], "Pizza");
        assert_eq!(payload["reason"], "expired [redacted]");
        assert_eq!(payload["mode"], "background");
        assert_eq!(payload["timestamp"], "2026-07-03T08:30:00.000Z");
        assert_eq!(payload["localTime"].as_str().unwrap().len(), 19);
        assert!(payload["embeds"].is_array());
    }

    fn event() -> AuthWebhookEvent {
        AuthWebhookEvent {
            kind: AuthWebhookEventKind::ReloginFailed,
            user_id: "usr_123".into(),
            display_name: "Pizza".into(),
            reason: "expired token".into(),
            mode: BackendRuntimeMode::Background,
            timestamp: "2026-07-03T08:30:00.000Z".into(),
        }
    }
}
