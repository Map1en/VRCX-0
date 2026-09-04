use super::*;

use chrono::Weekday;
use std::{collections::HashMap, sync::atomic::AtomicUsize};

#[derive(Default)]
struct FakeEnvironment {
    values: Mutex<HashMap<String, String>>,
    errors: Mutex<Vec<TelemetryClientErrorInput>>,
    unavailable: AtomicBool,
    scale: Mutex<TelemetryDatabaseScale>,
}

impl FakeEnvironment {
    fn set(&self, key: &str, value: &str) {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
    }
}

impl TelemetryEnvironment for FakeEnvironment {
    fn get_bool(&self, key: &str, default_value: bool) -> vrcx_0_application_core::Result<bool> {
        if self.unavailable.load(Ordering::Acquire) {
            return Err(vrcx_0_application_core::Error::Database(
                "unavailable".into(),
            ));
        }
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .and_then(|value| value.parse().ok())
            .unwrap_or(default_value))
    }

    fn get_string(
        &self,
        key: &str,
        default_value: &str,
    ) -> vrcx_0_application_core::Result<String> {
        if self.unavailable.load(Ordering::Acquire) {
            return Err(vrcx_0_application_core::Error::Database(
                "unavailable".into(),
            ));
        }
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or_else(|| default_value.to_string()))
    }

    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()> {
        self.set(key, value);
        Ok(())
    }

    fn drain_client_errors(
        &self,
        since: Option<&str>,
        limit: usize,
    ) -> Vec<TelemetryClientErrorInput> {
        self.errors
            .lock()
            .unwrap()
            .iter()
            .filter(|entry| since.is_none_or(|since| entry.ts_iso.as_str() > since))
            .take(limit)
            .cloned()
            .collect()
    }

    fn platform(&self) -> String {
        "windows".into()
    }

    fn arch(&self) -> String {
        "x86_64".into()
    }

    fn system_locale(&self) -> Option<String> {
        Some("en-US".into())
    }

    fn timezone(&self) -> Option<String> {
        Some("UTC".into())
    }

    fn database_scale(&self) -> TelemetryDatabaseScale {
        *self.scale.lock().unwrap()
    }

    fn system_theme_category(&self) -> String {
        "dark".into()
    }
}

struct FakeTransport {
    attempts: AtomicUsize,
    fail_attempt: Option<usize>,
    payloads: Mutex<Vec<(String, serde_json::Value)>>,
}

impl FakeTransport {
    fn new(fail_attempt: Option<usize>) -> Self {
        Self {
            attempts: AtomicUsize::new(0),
            fail_attempt,
            payloads: Mutex::new(Vec::new()),
        }
    }
}

impl TelemetryTransport for FakeTransport {
    fn is_enabled(&self) -> bool {
        true
    }

    fn post<'a>(&'a self, path: &'a str, payload: serde_json::Value) -> TelemetryPostFuture<'a> {
        Box::pin(async move {
            self.payloads
                .lock()
                .unwrap()
                .push((path.to_string(), payload));
            let attempt = self.attempts.fetch_add(1, Ordering::SeqCst) + 1;
            if self.fail_attempt == Some(attempt) {
                Err("rejected".into())
            } else {
                Ok(())
            }
        })
    }
}

fn runtime(environment: Arc<FakeEnvironment>, transport: Arc<FakeTransport>) -> TelemetryRuntime {
    runtime_with_version(environment, transport, "2.2.0")
}

fn runtime_with_version(
    environment: Arc<FakeEnvironment>,
    transport: Arc<FakeTransport>,
    app_version: &str,
) -> TelemetryRuntime {
    TelemetryRuntime::new(TelemetryRuntimeDeps {
        environment,
        transport,
        tasks: TaskSupervisor::new(),
        backend_runtime: BackendRuntime::new(vrcx_0_application_core::RuntimeHostProfile::Desktop),
        app_version: app_version.into(),
    })
}

fn instant_past_epoch_safe(headroom: Duration) -> Instant {
    Instant::now() + headroom
}

#[test]
fn local_weekday_uses_sunday_zero() {
    assert_eq!(local_weekday_number(Weekday::Sun), 0);
    assert_eq!(local_weekday_number(Weekday::Mon), 1);
    assert_eq!(local_weekday_number(Weekday::Sat), 6);
}

#[test]
fn runtime_mode_maps_all_backend_modes() {
    assert_eq!(
        runtime_mode(BackendRuntimeMode::Foreground),
        TelemetryRuntimeMode::Foreground
    );
    assert_eq!(
        runtime_mode(BackendRuntimeMode::Background),
        TelemetryRuntimeMode::Background
    );
    assert_eq!(
        runtime_mode(BackendRuntimeMode::Headless),
        TelemetryRuntimeMode::Headless
    );
}

#[test]
fn send_attempts_back_off_between_retries() {
    let now = instant_past_epoch_safe(SEND_RETRY_BACKOFF);
    assert!(attempt_due(None, now));
    assert!(!attempt_due(Some(now), now));
    assert!(!attempt_due(
        Some(now - SEND_RETRY_BACKOFF + Duration::from_secs(1)),
        now
    ));
    assert!(attempt_due(Some(now - SEND_RETRY_BACKOFF), now));
}

#[test]
fn heartbeat_waits_for_interval_after_initial_baseline() {
    let now = instant_past_epoch_safe(HEARTBEAT_INTERVAL);
    assert!(!is_heartbeat_due(None, now));
    assert!(!is_heartbeat_due(Some(now), now));
    assert!(!is_heartbeat_due(
        Some(now - HEARTBEAT_INTERVAL + Duration::from_secs(1)),
        now
    ));
    assert!(is_heartbeat_due(Some(now - HEARTBEAT_INTERVAL), now));
}

#[test]
fn theme_mode_category_resolves_system_without_unknown() {
    assert_eq!(theme_mode_category("dark", ""), "dark");
    assert_eq!(theme_mode_category("midnight", ""), "dark");
    assert_eq!(theme_mode_category("light", ""), "light");
    assert_eq!(theme_mode_category("system", "dark"), "dark");
    assert_eq!(theme_mode_category("system", "light"), "light");
    assert_eq!(theme_mode_category("system", ""), "light");
    assert_eq!(theme_mode_category("other", ""), "unknown");
}

#[test]
fn helpers_normalize_config_and_dimension_values() {
    assert_eq!(normalize_enum_value(" On Demand "), "on_demand");
    assert_eq!(normalize_enum_value(""), "unknown");
    assert_eq!(normalize_locale("zh_CN"), "zh-CN");
    assert_eq!(normalize_app_version(""), "unknown");
}

#[tokio::test]
async fn feedback_includes_the_full_beta_app_version() {
    let environment = Arc::new(FakeEnvironment::default());
    let transport = Arc::new(FakeTransport::new(None));
    let runtime = runtime_with_version(environment, transport.clone(), "2.3.0-beta.12");

    runtime.submit_feedback("Beta feedback").await.unwrap();

    let payloads = transport.payloads.lock().unwrap();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].0, "/api/v1/telemetry/feedback");
    assert_eq!(payloads[0].1["appVersion"], "2.3.0-beta.12");
}

#[test]
fn cursor_acknowledgement_only_clears_the_matching_snapshot() {
    let mut pending = Some("2026-07-13T10:00:00Z".to_string());
    clear_committed_error_cursor(&mut pending, "2026-07-13T09:00:00Z");
    assert_eq!(pending.as_deref(), Some("2026-07-13T10:00:00Z"));
    clear_committed_error_cursor(&mut pending, "2026-07-13T10:00:00Z");
    assert!(pending.is_none());
}

#[tokio::test]
async fn client_error_flush_retries_before_advancing_versioned_log_cursor() {
    let environment = Arc::new(FakeEnvironment::default());
    environment.set(
        TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY,
        "2026-06-30T00:00:00.000Z",
    );
    *environment.errors.lock().unwrap() = (1..=21)
        .map(|day| TelemetryClientErrorInput {
            ts_iso: format!("2026-07-{day:02}T00:00:00.000Z"),
            app_version: Some(if day == 1 { "2.0.0" } else { "2.1.0" }.into()),
            source: "rust:tracing".into(),
            fingerprint_message: format!("release failure {day}"),
            telemetry_message: format!("release failure {day}"),
        })
        .collect();
    let transport = Arc::new(FakeTransport::new(Some(2)));
    let runtime = runtime(environment.clone(), transport.clone());
    let session = TelemetrySession {
        install_id: "install".into(),
        session_id: "session".into(),
        is_new_install: false,
    };

    runtime.drain_rust_errors();
    runtime.flush_collectors_locked(&session).await;
    assert_eq!(
        environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .unwrap(),
        "2026-06-30T00:00:00.000Z"
    );
    assert_eq!(transport.attempts.load(Ordering::SeqCst), 2);

    runtime.flush_collectors_locked(&session).await;
    assert_eq!(transport.attempts.load(Ordering::SeqCst), 4);
    assert_eq!(
        environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .unwrap(),
        "2026-07-21T00:00:00.000Z"
    );
    assert!(runtime
        .inner
        .state
        .lock()
        .unwrap()
        .pending_error_cursor
        .is_none());
}

#[tokio::test]
async fn immediate_rust_error_flush_only_sends_sanitized_client_errors() {
    let environment = Arc::new(FakeEnvironment::default());
    environment
        .errors
        .lock()
        .unwrap()
        .push(TelemetryClientErrorInput {
            ts_iso: "2026-07-01T00:00:00.000Z".into(),
            app_version: Some("2.2.0-beta.3".into()),
            source: "rust:tracing".into(),
            fingerprint_message:
                "database upgrade failed: C:\\Users\\alice\\AppData\\secret.sqlite3".into(),
            telemetry_message: "database upgrade failed: C:\\Users\\alice\\AppData\\secret.sqlite3"
                .into(),
        });
    let transport = Arc::new(FakeTransport::new(None));
    let runtime = runtime(environment.clone(), transport.clone());

    runtime.flush_pending_rust_errors().await;

    let payloads = transport.payloads.lock().unwrap();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].0, "/api/v1/telemetry/client-error");
    let encoded = payloads[0].1.to_string();
    assert!(encoded.contains("database upgrade failed"));
    assert!(encoded.contains("2.2.0-beta.3"));
    assert!(!encoded.contains("alice"));
    assert!(!encoded.contains("secret.sqlite3"));
    assert_eq!(
        environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .unwrap(),
        "2026-07-01T00:00:00.000Z"
    );
}

#[tokio::test]
async fn immediate_rust_error_flush_fails_closed_when_consent_is_unavailable() {
    let environment = Arc::new(FakeEnvironment::default());
    environment.unavailable.store(true, Ordering::Release);
    let transport = Arc::new(FakeTransport::new(None));
    let runtime = runtime(environment, transport.clone());

    runtime.flush_pending_rust_errors().await;

    assert_eq!(transport.attempts.load(Ordering::SeqCst), 0);
}
