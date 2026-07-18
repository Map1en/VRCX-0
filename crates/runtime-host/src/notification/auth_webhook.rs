use serde_json::{json, Value};
use vrcx_0_application_core::{
    BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot, RuntimeDiagnostics, WebClient,
};
use vrcx_0_persistence::config::ConfigRepository;

use super::{send_json_webhook_with_retry, webhook_local_time_string};

const AUTH_WEBHOOK_ENABLED_CONFIG_KEY: &str = "webhookAuthEventsEnabled";
const AUTH_WEBHOOK_DIAGNOSTICS_KEY: &str = "authWebhook";

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
    pub mode: String,
    pub timestamp: String,
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
        && snapshot.auth_status == "authenticated"
        && !snapshot.auth_user_id.trim().is_empty()
}

pub fn auth_webhook_is_enabled(config: &ConfigRepository) -> bool {
    config
        .get_bool(AUTH_WEBHOOK_ENABLED_CONFIG_KEY, true)
        .unwrap_or(true)
        && !config
            .get_string("webhookUrl", "")
            .unwrap_or_default()
            .trim()
            .is_empty()
}

pub async fn send_auth_webhook(
    config: &ConfigRepository,
    web: &WebClient,
    diagnostics: &RuntimeDiagnostics,
    event: &AuthWebhookEvent,
) {
    if !auth_webhook_is_enabled(config) {
        return;
    }
    let url = config.get_string("webhookUrl", "").unwrap_or_default();
    let format = config
        .get_string("webhookFormat", "generic")
        .unwrap_or_else(|_| "generic".into());
    let payload = if format == "discord" {
        auth_webhook_discord_payload(event)
    } else {
        auth_webhook_generic_payload(event)
    };
    send_json_webhook_with_retry(
        web,
        diagnostics,
        &url,
        payload,
        AUTH_WEBHOOK_DIAGNOSTICS_KEY,
        event.kind.as_event_name(),
    )
    .await;
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
            mode: "background".into(),
            timestamp: "2026-07-03T08:30:00.000Z".into(),
        }
    }
}
