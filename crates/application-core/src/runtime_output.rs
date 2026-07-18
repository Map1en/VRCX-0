use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeOutputMode {
    Background,
    Headless,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeOutputLevel {
    Info,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeOutputLine {
    pub level: RuntimeOutputLevel,
    pub message: String,
    pub fatal_reason: Option<String>,
}

pub fn format_runtime_output_event(
    mode: RuntimeOutputMode,
    event: &str,
    payload: &Value,
) -> Option<RuntimeOutputLine> {
    match event {
        "realtimeWsStatus" => format_realtime_ws_status(mode, payload),
        "backendRuntimeTelemetry" => format_backend_runtime_telemetry(mode, payload),
        _ => None,
    }
}

fn format_realtime_ws_status(
    mode: RuntimeOutputMode,
    payload: &Value,
) -> Option<RuntimeOutputLine> {
    let status = string_field(payload, "status");
    if status.is_empty() {
        return None;
    }

    let reason = string_field(payload, "reason");
    let detail = if reason.is_empty() {
        format!("ws status: {status}")
    } else {
        format!("ws status: {status} ({reason})")
    };
    let is_auth_failure = status == "authFailure";
    Some(RuntimeOutputLine {
        level: if is_auth_failure {
            RuntimeOutputLevel::Error
        } else {
            RuntimeOutputLevel::Info
        },
        message: with_mode_prefix(mode, detail),
        fatal_reason: is_auth_failure.then(|| {
            if reason.is_empty() {
                "websocket auth failure".into()
            } else {
                reason
            }
        }),
    })
}

fn format_backend_runtime_telemetry(
    mode: RuntimeOutputMode,
    payload: &Value,
) -> Option<RuntimeOutputLine> {
    let kind = string_field(payload, "kind");
    let detail = string_field(payload, "detail");
    let snapshot = payload.get("snapshot").unwrap_or(&Value::Null);
    match kind.as_str() {
        "authSuccess" => {
            let name = string_field(snapshot, "authDisplayName");
            let user_id = string_field(snapshot, "authUserId");
            info(
                mode,
                format!(
                    "login success: {} ({})",
                    empty_fallback(&name, "unknown user"),
                    empty_fallback(&user_id, "unknown id")
                ),
            )
        }
        "wsStatus" => None,
        "wsMessage" => {
            let total = snapshot
                .get("wsMessageCounts")
                .and_then(|counts| counts.get(&detail))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            info(mode, format!("ws message: type={detail}, count={total}"))
        }
        "wsPersisted" => {
            let total = snapshot
                .get("wsPersistedCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            info(
                mode,
                format!("ws persisted to db: count={detail}, total={total}"),
            )
        }
        "processStatus" => match detail.as_str() {
            "vrchatRunning" => info(mode, "vrchat started"),
            "vrchatStopped" => info(mode, "vrchat stopped"),
            _ => info(mode, format!("vrchat process status: {detail}")),
        },
        "gameLogPersisted" => {
            let total = snapshot
                .get("gameLogPersistedCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            info(
                mode,
                format!("gamelog persisted to db: count={detail}, total={total}"),
            )
        }
        "gameLogWatcher" => info(mode, format!("gamelog watcher: {detail}")),
        "runtimeStopped" => Some(RuntimeOutputLine {
            level: RuntimeOutputLevel::Info,
            message: match mode {
                RuntimeOutputMode::Background => format!("background mode exited: {detail}"),
                RuntimeOutputMode::Headless => format!("headless runtime exited: {detail}"),
            },
            fatal_reason: None,
        }),
        "backgroundInfo" => info(mode, detail),
        "backgroundError" => Some(RuntimeOutputLine {
            level: RuntimeOutputLevel::Error,
            message: with_mode_prefix(mode, detail),
            fatal_reason: None,
        }),
        _ => None,
    }
}

fn info(mode: RuntimeOutputMode, message: impl Into<String>) -> Option<RuntimeOutputLine> {
    Some(RuntimeOutputLine {
        level: RuntimeOutputLevel::Info,
        message: with_mode_prefix(mode, message.into()),
        fatal_reason: None,
    })
}

fn with_mode_prefix(mode: RuntimeOutputMode, message: impl Into<String>) -> String {
    let message = message.into();
    match mode {
        RuntimeOutputMode::Background => format!("background mode {message}"),
        RuntimeOutputMode::Headless => message,
    }
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn empty_fallback<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn formats_shared_runtime_info_for_background_and_headless() {
        let payload = json!({
            "kind": "authSuccess",
            "detail": "Example",
            "snapshot": {
                "authDisplayName": "Example",
                "authUserId": "usr_test"
            }
        });

        let background = format_runtime_output_event(
            RuntimeOutputMode::Background,
            "backendRuntimeTelemetry",
            &payload,
        )
        .unwrap();
        assert_eq!(background.level, RuntimeOutputLevel::Info);
        assert_eq!(
            background.message,
            "background mode login success: Example (usr_test)"
        );

        let headless = format_runtime_output_event(
            RuntimeOutputMode::Headless,
            "backendRuntimeTelemetry",
            &payload,
        )
        .unwrap();
        assert_eq!(headless.message, "login success: Example (usr_test)");
    }

    #[test]
    fn formats_background_error_as_error_output() {
        let payload = json!({
            "kind": "backgroundError",
            "detail": "Discord SetAssets failed: pipe closed.",
            "snapshot": {
                "mode": "background",
                "phase": "running"
            }
        });

        let output = format_runtime_output_event(
            RuntimeOutputMode::Background,
            "backendRuntimeTelemetry",
            &payload,
        )
        .unwrap();
        assert_eq!(output.level, RuntimeOutputLevel::Error);
        assert_eq!(
            output.message,
            "background mode Discord SetAssets failed: pipe closed."
        );
        assert_eq!(output.fatal_reason, None);
    }

    #[test]
    fn websocket_auth_failure_is_error_and_fatal() {
        let payload = json!({
            "status": "authFailure",
            "reason": "token expired"
        });

        let output =
            format_runtime_output_event(RuntimeOutputMode::Headless, "realtimeWsStatus", &payload)
                .unwrap();
        assert_eq!(output.level, RuntimeOutputLevel::Error);
        assert_eq!(output.message, "ws status: authFailure (token expired)");
        assert_eq!(output.fatal_reason.as_deref(), Some("token expired"));
    }
}
