use std::time::Duration;

use serde_json::Value;
use vrcx_0_application::{RuntimeDiagnostics, WebClient};
use vrcx_0_vrchat_client::web_client::WebExecuteRequest;

const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(10);
const WEBHOOK_RETRY_DELAYS: &[Duration] = &[Duration::from_millis(750), Duration::from_secs(2)];

pub(crate) async fn send_json_webhook_with_retry(
    web: &WebClient,
    diagnostics: &RuntimeDiagnostics,
    url: &str,
    payload: Value,
    diagnostics_key: &str,
    event_label: &str,
) {
    let url = url.trim();
    if url.is_empty() {
        return;
    }
    let body = match serde_json::to_string(&payload) {
        Ok(body) => body,
        Err(error) => {
            diagnostics.record_command(diagnostics_key, "error", error.to_string());
            return;
        }
    };
    let mut last_error = String::new();
    for attempt in 0..=WEBHOOK_RETRY_DELAYS.len() {
        match send_webhook_once(web, url, &body).await {
            Ok(status) if (200..=399).contains(&status) => return,
            Ok(status) => {
                last_error = format!("HTTP {status}");
                if !webhook_status_retryable(status) {
                    break;
                }
            }
            Err(error) => {
                last_error = error;
            }
        }
        if let Some(delay) = WEBHOOK_RETRY_DELAYS.get(attempt) {
            tokio::time::sleep(*delay).await;
        }
    }
    diagnostics.record_command(
        diagnostics_key,
        "error",
        format!("{event_label}: {last_error}"),
    );
    tracing::warn!(
        event = %event_label,
        error = %last_error,
        "webhook delivery failed"
    );
}

async fn send_webhook_once(web: &WebClient, url: &str, body: &str) -> Result<i32, String> {
    let mut request = WebExecuteRequest::new(url.to_string(), "POST".to_string());
    request
        .headers
        .push(("Content-Type".into(), "application/json".into()));
    request.body = Some(body.to_string());
    match tokio::time::timeout(WEBHOOK_TIMEOUT, web.execute(request)).await {
        Ok(Ok((status, _data))) => Ok(status),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("timeout".into()),
    }
}

fn webhook_status_retryable(status: i32) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500..=599 | -1)
}
