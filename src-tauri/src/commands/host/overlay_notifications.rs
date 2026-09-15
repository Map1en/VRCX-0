#![allow(non_snake_case)]

use serde_json::{json, Value};
use tauri::State;
use vrcx_0_application_activity::notification::{
    filter_generic_webhook_payload, parse_webhook_fields, webhook_local_time_string,
    NotificationWebhookFormat, WebhookDeliveryOutcome, WebhookDeliverySnapshot,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__webhook_send_test(
    state: State<'_, AppState>,
    url: String,
    format: NotificationWebhookFormat,
    fields: String,
) -> Result<WebhookDeliveryOutcome, AppError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::Custom("Webhook URL is required.".into()));
    }
    let payload = webhook_test_payload(format, &fields);
    state
        .runtime_host()
        .send_test_webhook(url.to_string(), format, payload)
        .await
        .map_err(AppError::from)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__webhook_delivery_snapshot_get(
    state: State<'_, AppState>,
) -> Result<WebhookDeliverySnapshot, AppError> {
    Ok(state.runtime_host().webhook_delivery_snapshot())
}

fn webhook_test_payload(format: NotificationWebhookFormat, fields: &str) -> Value {
    let timestamp = chrono::Utc::now().to_rfc3339();
    if format == NotificationWebhookFormat::Discord {
        json!({
            "content": null,
            "embeds": [{
                "title": "VRCX-0 webhook test",
                "description": "Webhook delivery is configured.",
                "timestamp": &timestamp,
            }]
        })
    } else {
        let payload = json!({
            "version": 1,
            "event": "test",
            "category": "systemSafety",
            "title": "VRCX-0 webhook test",
            "message": "Webhook delivery is configured.",
            "user": {
                "id": "",
                "displayName": "VRCX-0",
            },
            "location": "VRCX-0 test world public",
            "locationId": "wrld_00000000-0000-0000-0000-000000000000:12345",
            "worldId": "wrld_00000000-0000-0000-0000-000000000000",
            "worldName": "VRCX-0 test world",
            "timestamp": &timestamp,
            "localTime": webhook_local_time_string(&timestamp),
        });
        filter_generic_webhook_payload(payload, &parse_webhook_fields(fields))
    }
}

#[cfg(test)]
mod tests {
    use super::{webhook_test_payload, NotificationWebhookFormat};

    #[test]
    fn generic_webhook_test_payload_honors_selected_fields() {
        let payload = webhook_test_payload(
            NotificationWebhookFormat::Generic,
            r#"["locationId","localTime"]"#,
        );

        assert_eq!(
            payload.get("locationId").and_then(|value| value.as_str()),
            Some("wrld_00000000-0000-0000-0000-000000000000:12345")
        );
        assert!(payload.get("localTime").is_some());
        assert!(payload.get("timestamp").is_none());
        assert!(payload.get("worldName").is_none());
    }

    #[test]
    fn generic_webhook_test_payload_ignores_localized_field_names() {
        let payload = webhook_test_payload(
            NotificationWebhookFormat::Generic,
            r#"["locationId","位置","タイトル"]"#,
        );

        assert_eq!(payload.as_object().unwrap().len(), 1);
        assert_eq!(
            payload.get("locationId").and_then(|value| value.as_str()),
            Some("wrld_00000000-0000-0000-0000-000000000000:12345")
        );
        assert!(payload.get("位置").is_none());
        assert!(payload.get("タイトル").is_none());
    }

    #[test]
    fn discord_webhook_test_payload_ignores_selected_fields() {
        let payload = webhook_test_payload(NotificationWebhookFormat::Discord, r#"["locationId"]"#);

        assert!(payload.get("locationId").is_none());
        assert!(payload.get("embeds").is_some());
    }
}
