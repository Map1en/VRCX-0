use futures_util::future::BoxFuture;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use chrono::{Datelike, Local, Timelike};
use uuid::Uuid;
use vrcx_0_application_core::{BackendRuntime, BackendRuntimeMode, TaskStopToken, TaskSupervisor};
use vrcx_0_contracts::telemetry::{
    AssistantHealthPayload, ClientErrorPayload, ConfigSnapshotPayload, PageHealthPayload,
    TelemetryConfigSnapshot, TelemetryContext, TelemetryRuntimeMode, ToolUsagePayload,
};

use super::accumulator::{TelemetryAccumulator, MAX_DETAILS_PER_PAYLOAD};
use super::event::TelemetryClientEvent;
use super::scale::{db_size_bucket, row_bucket, TelemetryDatabaseScale};

const TELEMETRY_INSTALL_ID_CONFIG_KEY: &str = "telemetryInstallId";
const TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY: &str = "telemetryBasicInfoReportedVersion";
const TELEMETRY_CONFIG_REPORTED_VERSION_CONFIG_KEY: &str = "telemetryConfigReportedVersion";
const TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY: &str = "telemetryClientErrorCursor";
const ANONYMOUS_USAGE_TELEMETRY_CONFIG_KEY: &str = "anonymousUsageTelemetry";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30 * 60);
const LOOP_SLEEP: Duration = Duration::from_secs(1);
const SHUTDOWN_FLUSH_TIMEOUT: Duration = Duration::from_secs(1);
const SEND_RETRY_BACKOFF: Duration = Duration::from_secs(60);
const MAX_FEEDBACK_LENGTH: usize = 2000;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackPayload<'a> {
    install_id: &'a str,
    app_version: &'a str,
    content: &'a str,
}

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum FeedbackSubmitError {
    #[error("feedback content is empty")]
    EmptyContent,
    #[error("feedback content is too long")]
    ContentTooLong,
    #[error("telemetry is disabled")]
    Disabled,
    #[error("feedback request failed")]
    RequestFailed,
}

pub type TelemetryPostFuture<'a> = BoxFuture<'a, std::result::Result<(), String>>;

pub trait TelemetryTransport: Send + Sync {
    fn is_enabled(&self) -> bool;
    fn post<'a>(&'a self, path: &'a str, payload: serde_json::Value) -> TelemetryPostFuture<'a>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TelemetryClientErrorInput {
    pub ts_iso: String,
    pub app_version: Option<String>,
    pub source: String,
    pub fingerprint_message: String,
    pub telemetry_message: String,
}

pub trait TelemetryEnvironment: Send + Sync {
    fn get_bool(&self, key: &str, default_value: bool) -> vrcx_0_application_core::Result<bool>;
    fn get_string(&self, key: &str, default_value: &str)
        -> vrcx_0_application_core::Result<String>;
    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()>;
    fn drain_client_errors(
        &self,
        since: Option<&str>,
        limit: usize,
    ) -> Vec<TelemetryClientErrorInput>;
    fn platform(&self) -> String;
    fn arch(&self) -> String;
    fn system_locale(&self) -> Option<String>;
    fn timezone(&self) -> Option<String>;
    fn system_theme_category(&self) -> String;
    fn database_scale(&self) -> TelemetryDatabaseScale;
}

#[derive(Clone)]
pub struct TelemetryRuntime {
    inner: Arc<TelemetryRuntimeInner>,
}

pub struct TelemetryRuntimeDeps {
    pub environment: Arc<dyn TelemetryEnvironment>,
    pub transport: Arc<dyn TelemetryTransport>,
    pub tasks: TaskSupervisor,
    pub backend_runtime: BackendRuntime,
    pub app_version: String,
}

struct TelemetryRuntimeInner {
    environment: Arc<dyn TelemetryEnvironment>,
    transport: Arc<dyn TelemetryTransport>,
    tasks: TaskSupervisor,
    backend_runtime: BackendRuntime,
    app_version: String,
    state: Mutex<TelemetryState>,
    flush_lock: tokio::sync::Mutex<()>,
    running: AtomicBool,
    shutdown_requested: AtomicBool,
    shutdown_flushed: AtomicBool,
}

#[derive(Default)]
struct TelemetryState {
    session: Option<TelemetrySession>,
    session_start_sent: bool,
    session_start_attempted_at: Option<Instant>,
    config_snapshot_sent: bool,
    config_snapshot_attempted_at: Option<Instant>,
    last_heartbeat_at: Option<Instant>,
    pending_error_cursor: Option<String>,
    acc: TelemetryAccumulator,
}

#[derive(Clone)]
struct TelemetrySession {
    install_id: String,
    session_id: String,
    is_new_install: bool,
}

impl TelemetryRuntime {
    pub fn new(deps: TelemetryRuntimeDeps) -> Self {
        Self {
            inner: Arc::new(TelemetryRuntimeInner {
                environment: deps.environment,
                transport: deps.transport,
                tasks: deps.tasks,
                backend_runtime: deps.backend_runtime,
                app_version: normalize_app_version(&deps.app_version),
                state: Mutex::new(TelemetryState::default()),
                flush_lock: tokio::sync::Mutex::new(()),
                running: AtomicBool::new(false),
                shutdown_requested: AtomicBool::new(false),
                shutdown_flushed: AtomicBool::new(false),
            }),
        }
    }

    pub fn start(&self) {
        if self.inner.running.swap(true, Ordering::AcqRel) {
            return;
        }
        self.inner
            .shutdown_requested
            .store(false, Ordering::Release);
        self.inner.shutdown_flushed.store(false, Ordering::Release);
        let runtime = self.clone();
        self.inner
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                runtime.run_loop(stop_token).await;
            });
    }

    pub fn record_event(&self, event: TelemetryClientEvent) {
        if !self.usage_enabled() {
            return;
        }
        match self.inner.state.lock() {
            Ok(mut state) => state.acc.record(event),
            Err(error) => tracing::debug!("failed to lock telemetry accumulator: {error}"),
        }
    }

    pub async fn shutdown_flush(&self) {
        self.inner.shutdown_requested.store(true, Ordering::Release);
        if self.inner.shutdown_flushed.swap(true, Ordering::AcqRel) {
            return;
        }
        if tokio::time::timeout(SHUTDOWN_FLUSH_TIMEOUT, self.flush_shutdown_inner())
            .await
            .is_err()
        {
            self.inner.shutdown_flushed.store(false, Ordering::Release);
        }
    }

    pub async fn submit_feedback(&self, content: &str) -> Result<(), FeedbackSubmitError> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Err(FeedbackSubmitError::EmptyContent);
        }
        if trimmed.chars().count() > MAX_FEEDBACK_LENGTH {
            return Err(FeedbackSubmitError::ContentTooLong);
        }
        if !self.inner.transport.is_enabled() {
            return Err(FeedbackSubmitError::Disabled);
        }
        let Some(session) = self.ensure_session() else {
            return Err(FeedbackSubmitError::RequestFailed);
        };
        let payload = FeedbackPayload {
            install_id: &session.install_id,
            app_version: &self.inner.app_version,
            content: trimmed,
        };
        if self
            .post_debug("/api/v1/telemetry/feedback", &payload, "feedback")
            .await
        {
            Ok(())
        } else {
            Err(FeedbackSubmitError::RequestFailed)
        }
    }

    pub async fn flush_pending_rust_errors(&self) {
        if !self.inner.transport.is_enabled() || !self.usage_enabled() {
            return;
        }
        let Some(session) = self.ensure_session() else {
            return;
        };
        let _flush_guard = self.inner.flush_lock.lock().await;
        self.drain_rust_errors();
        self.flush_client_errors_locked(&session).await;
    }

    async fn run_loop(&self, stop_token: TaskStopToken) {
        loop {
            if stop_token.is_stop_requested() {
                self.shutdown_flush().await;
                self.inner.running.store(false, Ordering::Release);
                return;
            }
            self.tick().await;
            tokio::time::sleep(LOOP_SLEEP).await;
        }
    }

    async fn tick(&self) {
        if !self.inner.transport.is_enabled() {
            return;
        }
        let Some(session) = self.ensure_session() else {
            return;
        };
        self.ensure_session_start(&session).await;
        self.send_config_snapshot_once(&session).await;
        self.send_heartbeat_if_due(&session).await;
    }

    async fn flush_shutdown_inner(&self) {
        if !self.inner.transport.is_enabled() || !self.usage_enabled() {
            return;
        }
        let Some(session) = self.ensure_session() else {
            return;
        };
        let _flush_guard = self.inner.flush_lock.lock().await;
        self.drain_rust_errors();
        let context = self.context(&session, Some(true));
        self.post_debug(
            "/api/v1/telemetry/session/heartbeat",
            &context,
            "shutdown heartbeat",
        )
        .await;
        self.flush_collectors_locked(&session).await;
    }

    fn ensure_session(&self) -> Option<TelemetrySession> {
        let mut state = self.inner.state.lock().ok()?;
        if let Some(session) = &state.session {
            return Some(session.clone());
        }
        let raw = self
            .inner
            .environment
            .get_string(TELEMETRY_INSTALL_ID_CONFIG_KEY, "")
            .unwrap_or_default();
        let trimmed = raw.trim();
        let (install_id, is_new_install) = if trimmed.is_empty() {
            let install_id = Uuid::new_v4().to_string();
            if let Err(error) = self
                .inner
                .environment
                .set_string(TELEMETRY_INSTALL_ID_CONFIG_KEY, &install_id)
            {
                tracing::debug!("failed to persist telemetry install id: {error}");
                return None;
            }
            (install_id, true)
        } else {
            (trimmed.to_string(), false)
        };
        let session = TelemetrySession {
            install_id,
            session_id: Uuid::new_v4().to_string(),
            is_new_install,
        };
        state.session = Some(session.clone());
        Some(session)
    }

    async fn ensure_session_start(&self, session: &TelemetrySession) {
        if self.session_start_sent() {
            return;
        }
        let now = Instant::now();
        {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            if !attempt_due(state.session_start_attempted_at, now) {
                return;
            }
            state.session_start_attempted_at = Some(now);
        }
        let usage_enabled = self.usage_enabled();
        if !usage_enabled && !self.should_report_basic_session_start(session) {
            return;
        }
        let context = if usage_enabled {
            self.context(session, None)
        } else {
            self.basic_context(session)
        };
        if self
            .post_debug("/api/v1/telemetry/session/start", &context, "session start")
            .await
        {
            self.mark_session_start_sent();
            if let Err(error) = self.inner.environment.set_string(
                TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY,
                &self.inner.app_version,
            ) {
                tracing::debug!("failed to mark telemetry basic version: {error}");
            }
        }
    }

    async fn send_config_snapshot_once(&self, session: &TelemetrySession) {
        if self.config_snapshot_sent() {
            return;
        }
        let now = Instant::now();
        {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            if !attempt_due(state.config_snapshot_attempted_at, now) {
                return;
            }
            state.config_snapshot_attempted_at = Some(now);
        }
        if !self.usage_enabled() {
            return;
        }
        let reported = self
            .inner
            .environment
            .get_string(TELEMETRY_CONFIG_REPORTED_VERSION_CONFIG_KEY, "")
            .unwrap_or_default();
        if reported.trim() == self.inner.app_version {
            self.mark_config_snapshot_sent();
            return;
        }
        let payload = ConfigSnapshotPayload {
            context: self.context(session, None),
            config: self.config_snapshot(),
        };
        if self
            .post_debug("/api/v1/telemetry/config", &payload, "config snapshot")
            .await
        {
            self.mark_config_snapshot_sent();
            if let Err(error) = self.inner.environment.set_string(
                TELEMETRY_CONFIG_REPORTED_VERSION_CONFIG_KEY,
                &self.inner.app_version,
            ) {
                tracing::debug!("failed to mark telemetry config version: {error}");
            }
        }
    }

    async fn send_heartbeat_if_due(&self, session: &TelemetrySession) {
        let now = Instant::now();
        {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            if state.last_heartbeat_at.is_none() {
                state.last_heartbeat_at = Some(now);
                return;
            }
            if !is_heartbeat_due(state.last_heartbeat_at, now) {
                return;
            }
            state.last_heartbeat_at = Some(now);
        }
        if !self.usage_enabled() {
            return;
        }
        let _flush_guard = self.inner.flush_lock.lock().await;
        if self.inner.shutdown_requested.load(Ordering::Acquire) {
            return;
        }
        self.drain_rust_errors();
        let context = self.context(session, None);
        self.post_debug("/api/v1/telemetry/session/heartbeat", &context, "heartbeat")
            .await;
        self.flush_collectors_locked(session).await;
    }

    async fn flush_collectors_locked(&self, session: &TelemetrySession) {
        let (routes, tools, assistant_health) = {
            let Ok(state) = self.inner.state.lock() else {
                return;
            };
            (
                state.acc.route_snapshot(),
                state.acc.tool_snapshot(),
                state.acc.assistant_health_snapshot(),
            )
        };
        let context = self.context(session, None);
        if let Some(routes) = routes {
            let payload = PageHealthPayload {
                context: context.clone(),
                routes: routes.entries,
            };
            if self
                .post_debug("/api/v1/telemetry/page-health", &payload, "page health")
                .await
            {
                if let Ok(mut state) = self.inner.state.lock() {
                    state.acc.mark_routes_sent(routes.revision);
                }
            }
        }
        if let Some(tools) = tools {
            let payload = ToolUsagePayload {
                context: context.clone(),
                tools: tools.entries,
            };
            if self
                .post_debug("/api/v1/telemetry/tool-usage", &payload, "tool usage")
                .await
            {
                if let Ok(mut state) = self.inner.state.lock() {
                    state.acc.mark_tools_sent(tools.revision);
                }
            }
        }
        if let Some(assistant_health) = assistant_health {
            let payload = AssistantHealthPayload {
                context: context.clone(),
                tool_errors: assistant_health.entry.tool_errors,
                turn_errors: assistant_health.entry.turn_errors,
                details: assistant_health.entry.details,
            };
            if self
                .post_debug(
                    "/api/v1/telemetry/assistant-health",
                    &payload,
                    "assistant health",
                )
                .await
            {
                if let Ok(mut state) = self.inner.state.lock() {
                    state
                        .acc
                        .mark_assistant_health_sent(assistant_health.revision);
                }
            }
        }
        self.flush_client_errors_locked(session).await;
    }

    async fn flush_client_errors_locked(&self, session: &TelemetrySession) {
        let client_errors = {
            let Ok(state) = self.inner.state.lock() else {
                return;
            };
            state
                .acc
                .client_error_snapshot()
                .map(|snapshot| (snapshot, state.pending_error_cursor.clone()))
        };
        if let Some((client_errors, error_cursor)) = client_errors {
            let context = self.context(session, None);
            for chunk in client_errors.entries.chunks(MAX_DETAILS_PER_PAYLOAD) {
                let payload = ClientErrorPayload {
                    context: context.clone(),
                    errors: chunk.to_vec(),
                };
                if !self
                    .post_debug("/api/v1/telemetry/client-error", &payload, "client error")
                    .await
                {
                    return;
                }
            }
            if !self.commit_error_cursor(error_cursor.as_deref()) {
                return;
            }
            if let Ok(mut state) = self.inner.state.lock() {
                state.acc.mark_client_errors_sent(client_errors.revision);
            }
        }
    }

    async fn post_debug<T>(&self, path: &str, payload: &T, label: &str) -> bool
    where
        T: serde::Serialize + ?Sized,
    {
        let Ok(payload) = serde_json::to_value(payload) else {
            return false;
        };
        match self.inner.transport.post(path, payload).await {
            Ok(()) => true,
            Err(error) => {
                tracing::debug!(error = %error, "telemetry {label} send failed");
                false
            }
        }
    }

    fn context(&self, session: &TelemetrySession, session_ended: Option<bool>) -> TelemetryContext {
        let now = Local::now();
        TelemetryContext {
            install_id: session.install_id.clone(),
            session_id: session.session_id.clone(),
            app_version: self.inner.app_version.clone(),
            platform: self.inner.environment.platform(),
            arch: self.inner.environment.arch(),
            locale: self.locale(),
            timezone: self
                .inner
                .environment
                .timezone()
                .unwrap_or_else(|| "unknown".into()),
            mode: runtime_mode(self.inner.backend_runtime.snapshot().mode),
            local_weekday: local_weekday_number(now.weekday()),
            local_hour: now.hour(),
            session_ended,
        }
    }

    fn basic_context(&self, session: &TelemetrySession) -> TelemetryContext {
        TelemetryContext {
            mode: TelemetryRuntimeMode::Foreground,
            ..self.context(session, None)
        }
    }

    fn config_snapshot(&self) -> TelemetryConfigSnapshot {
        let scale = self.inner.environment.database_scale();
        TelemetryConfigSnapshot {
            background_mode_enabled: self.config_bool("backgroundModeEnabled", false),
            wrist_overlay_enabled: self.config_bool("wristOverlayEnabled", false),
            ovrt_wrist_notifications: self.config_bool("ovrtWristNotifications", false),
            hmd_notifications_enabled: self.config_bool("hmdNotificationsEnabled", false),
            webhook_enabled: self.config_bool("webhookEnabled", false),
            auto_state_change_enabled: has_enabled_rules(
                &self.config_string("presenceAutomationContextRules", "[]"),
            ),
            auto_accept_invite_requests: normalize_enum_value(
                &self.config_string("autoAcceptInviteRequests", "Off"),
            ),
            avatar_auto_cleanup: normalize_enum_value(
                &self.config_string("avatarAutoCleanup", "Off"),
            ),
            theme_mode: self.theme_category(),
            db_size_bucket: db_size_bucket(scale.db_bytes),
            feed_rows_bucket: row_bucket(scale.feed_rows),
            gamelog_rows_bucket: row_bucket(scale.gamelog_rows),
            friend_log_rows_bucket: row_bucket(scale.friend_log_rows),
        }
    }

    fn drain_rust_errors(&self) {
        let since = self.current_error_cursor();
        let entries = self
            .inner
            .environment
            .drain_client_errors(since.as_deref(), 100);
        let mut pending_cursor = since;
        let Ok(mut state) = self.inner.state.lock() else {
            return;
        };
        for entry in entries {
            if pending_cursor
                .as_deref()
                .is_some_and(|cursor| entry.ts_iso.as_str() <= cursor)
            {
                continue;
            }
            pending_cursor = Some(latest_iso(pending_cursor, entry.ts_iso.clone()));
            let Some(app_version) = entry.app_version.as_deref().map(str::trim) else {
                continue;
            };
            if app_version.is_empty() {
                continue;
            }
            state.acc.record_rust_error(
                &entry.source,
                app_version,
                &entry.fingerprint_message,
                &entry.telemetry_message,
            );
        }
        state.pending_error_cursor = pending_cursor;
    }

    fn current_error_cursor(&self) -> Option<String> {
        if let Ok(state) = self.inner.state.lock() {
            if state.pending_error_cursor.is_some() {
                return state.pending_error_cursor.clone();
            }
        }
        self.inner
            .environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn commit_error_cursor(&self, cursor: Option<&str>) -> bool {
        let Some(cursor) = cursor else {
            return true;
        };
        if let Err(error) = self
            .inner
            .environment
            .set_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, cursor)
        {
            tracing::debug!("failed to advance telemetry client error cursor: {error}");
            return false;
        }
        if let Ok(mut state) = self.inner.state.lock() {
            clear_committed_error_cursor(&mut state.pending_error_cursor, cursor);
        }
        true
    }

    fn locale(&self) -> String {
        let app_language = self.config_string("appLanguage", "");
        if !app_language.trim().is_empty() {
            return normalize_locale(&app_language);
        }
        self.inner
            .environment
            .system_locale()
            .map(|locale| normalize_locale(&locale))
            .filter(|locale| !locale.trim().is_empty())
            .unwrap_or_else(|| "unknown".into())
    }

    fn theme_category(&self) -> String {
        if self.config_bool("VRCX_communityThemeEnabled", false) {
            return "community".into();
        }
        let background_image_enabled = self.config_bool("VRCX_backgroundImageEnabled", false)
            || self.config_bool("VRCX_officialBackgroundEnabled", false);
        if background_image_enabled {
            let mode = self
                .config_string("VRCX_backgroundImageMode", "daily")
                .trim()
                .to_ascii_lowercase();
            return if mode == "custom" {
                "background_custom".into()
            } else {
                "background_image".into()
            };
        }
        let theme_mode = self
            .config_string("ThemeMode", "system")
            .trim()
            .to_ascii_lowercase()
            .to_string();
        let system_theme = self.inner.environment.system_theme_category();
        theme_mode_category(&theme_mode, &system_theme).into()
    }

    fn config_bool(&self, key: &str, default_value: bool) -> bool {
        self.inner
            .environment
            .get_bool(key, default_value)
            .unwrap_or(default_value)
    }

    fn config_string(&self, key: &str, default_value: &str) -> String {
        self.inner
            .environment
            .get_string(key, default_value)
            .unwrap_or_else(|_| default_value.to_string())
    }

    fn usage_enabled(&self) -> bool {
        self.inner
            .environment
            .get_bool(ANONYMOUS_USAGE_TELEMETRY_CONFIG_KEY, true)
            .unwrap_or(false)
    }

    fn should_report_basic_session_start(&self, session: &TelemetrySession) -> bool {
        if session.is_new_install {
            return true;
        }
        self.inner
            .environment
            .get_string(TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY, "")
            .map(|version| version.trim() != self.inner.app_version)
            .unwrap_or(true)
    }

    fn session_start_sent(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.session_start_sent)
            .unwrap_or(false)
    }

    fn mark_session_start_sent(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.session_start_sent = true;
        }
    }

    fn config_snapshot_sent(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.config_snapshot_sent)
            .unwrap_or(false)
    }

    fn mark_config_snapshot_sent(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.config_snapshot_sent = true;
        }
    }
}

fn runtime_mode(mode: BackendRuntimeMode) -> TelemetryRuntimeMode {
    match mode {
        BackendRuntimeMode::Foreground => TelemetryRuntimeMode::Foreground,
        BackendRuntimeMode::Background => TelemetryRuntimeMode::Background,
        BackendRuntimeMode::Headless => TelemetryRuntimeMode::Headless,
    }
}

fn is_heartbeat_due(last: Option<Instant>, now: Instant) -> bool {
    last.is_some_and(|last| now.duration_since(last) >= HEARTBEAT_INTERVAL)
}

fn attempt_due(last_attempt: Option<Instant>, now: Instant) -> bool {
    last_attempt.is_none_or(|last| now.duration_since(last) >= SEND_RETRY_BACKOFF)
}

fn local_weekday_number(weekday: chrono::Weekday) -> u32 {
    weekday.num_days_from_sunday()
}

fn has_enabled_rules(raw_rules: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw_rules)
        .ok()
        .as_ref()
        .and_then(serde_json::Value::as_array)
        .is_some_and(|rules| {
            rules
                .iter()
                .any(|rule| rule.get("enabled").and_then(serde_json::Value::as_bool) != Some(false))
        })
}

fn normalize_enum_value(value: &str) -> String {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .take(32)
        .collect::<String>();
    let normalized = normalized.trim_matches('_');
    if normalized.is_empty() {
        "unknown".into()
    } else {
        normalized.to_string()
    }
}

fn normalize_locale(value: &str) -> String {
    value.trim().replace('_', "-")
}

fn theme_mode_category(value: &str, system_theme: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "dark" | "midnight" => "dark",
        "light" => "light",
        "system" => match system_theme.trim() {
            "dark" => "dark",
            "light" => "light",
            _ => "light",
        },
        _ => "unknown",
    }
}

fn normalize_app_version(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "unknown".into()
    } else {
        value.to_string()
    }
}

fn latest_iso(left: Option<String>, right: String) -> String {
    match left {
        Some(left) if left > right => left,
        _ => right,
    }
}

fn clear_committed_error_cursor(pending: &mut Option<String>, committed: &str) {
    if pending.as_deref() == Some(committed) {
        *pending = None;
    }
}

#[cfg(test)]
mod tests;
