use std::time::Duration;

use serde_json::Value;
use vrcx_0_application_core::{RuntimeDiagnostics, WebClient};
use vrcx_0_vrchat_client::web_client::WebExecuteRequest;

const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(10);
const WEBHOOK_RETRY_DELAYS: &[Duration] = &[Duration::from_millis(750), Duration::from_secs(2)];
const WEBHOOK_MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

struct WebhookResponse {
    status: i32,
    body: String,
}

pub async fn send_json_webhook_with_retry(
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
        let mut retry_after = None;
        match send_webhook_once(web, url, &body).await {
            Ok(response) if (200..=399).contains(&response.status) => return,
            Ok(response) => {
                last_error = format!("HTTP {}", response.status);
                if !webhook_status_retryable(response.status) {
                    break;
                }
                if response.status == 429 {
                    retry_after = webhook_retry_after(&response.body);
                }
            }
            Err(error) => {
                last_error = error;
            }
        }
        if let Some(fallback_delay) = WEBHOOK_RETRY_DELAYS.get(attempt) {
            tokio::time::sleep(retry_after.unwrap_or(*fallback_delay)).await;
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

pub fn webhook_local_time_string(created_at: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default()
}

pub(super) fn discord_webhook_url_with_wait(url: &str) -> String {
    let url = url.trim();
    let Ok(mut parsed) = url::Url::parse(url) else {
        return url.to_string();
    };
    let mut query_pairs = parsed
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    let mut found_wait = false;
    for (key, value) in &mut query_pairs {
        if key == "wait" {
            *value = "true".into();
            found_wait = true;
        }
    }
    if !found_wait {
        query_pairs.push(("wait".into(), "true".into()));
    }
    parsed.query_pairs_mut().clear().extend_pairs(query_pairs);
    parsed.into()
}

fn webhook_retry_after(body: &str) -> Option<Duration> {
    let seconds = serde_json::from_str::<Value>(body)
        .ok()?
        .get("retry_after")?
        .as_f64()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(seconds).min(WEBHOOK_MAX_RETRY_DELAY))
}

async fn send_webhook_once(
    web: &WebClient,
    url: &str,
    body: &str,
) -> Result<WebhookResponse, String> {
    let mut request = WebExecuteRequest::new(url.to_string(), "POST".to_string());
    request
        .headers
        .push(("Content-Type".into(), "application/json".into()));
    request.body = Some(body.to_string());
    match tokio::time::timeout(WEBHOOK_TIMEOUT, web.execute(request)).await {
        Ok(Ok((status, body))) => Ok(WebhookResponse { status, body }),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("timeout".into()),
    }
}

fn webhook_status_retryable(status: i32) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500..=599 | -1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_webhook_url_enables_wait_without_dropping_query() {
        assert_eq!(
            discord_webhook_url_with_wait(
                "https://discord.com/api/webhooks/1/token?thread_id=2&wait=false"
            ),
            "https://discord.com/api/webhooks/1/token?thread_id=2&wait=true"
        );
        assert_eq!(
            discord_webhook_url_with_wait("https://discord.com/api/webhooks/1/token"),
            "https://discord.com/api/webhooks/1/token?wait=true"
        );
    }

    #[test]
    fn webhook_retry_after_uses_fractional_seconds_and_caps_delay() {
        assert_eq!(
            webhook_retry_after(r#"{"retry_after":0.25}"#),
            Some(Duration::from_millis(250))
        );
        assert_eq!(
            webhook_retry_after(r#"{"retry_after":120}"#),
            Some(WEBHOOK_MAX_RETRY_DELAY)
        );
        assert_eq!(webhook_retry_after(r#"{"retry_after":"soon"}"#), None);
    }
}
