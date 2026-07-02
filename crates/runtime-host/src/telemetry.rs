use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use chrono::{Datelike, Local, Timelike};
use serde::Deserialize;
use uuid::Uuid;
use vrcx_0_application::{
    BackendRuntime, BackendRuntimeMode, HostSessionRuntime, TaskStopToken, TaskSupervisor,
};
use vrcx_0_host::{
    error_log::drain_client_error_log,
    host_capabilities::{current_arch, current_platform},
    system_theme::current_system_theme_category,
};
use vrcx_0_integrations::telemetry::{
    build_error_detail, resolve_endpoint, AssistantHealthPayload, AssistantUsagePayload,
    ClientErrorPayload, ConfigSnapshotPayload, PageHealthPayload, RouteUsageEntry, TelemetryClient,
    TelemetryConfigSnapshot, TelemetryContext, TelemetryErrorDetail, TelemetryRuntimeMode,
    ViewModeUsageEntry, ViewModeUsagePayload, VrchatLifecyclePayload,
};
use vrcx_0_persistence::config::ConfigRepository;

const TELEMETRY_INSTALL_ID_CONFIG_KEY: &str = "telemetryInstallId";
const TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY: &str = "telemetryBasicInfoReportedVersion";
const TELEMETRY_CONFIG_REPORTED_VERSION_CONFIG_KEY: &str = "telemetryConfigReportedVersion";
const TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY: &str = "telemetryClientErrorCursor";
const ANONYMOUS_USAGE_TELEMETRY_CONFIG_KEY: &str = "anonymousUsageTelemetry";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30 * 60);
const VRCHAT_CHECK_INTERVAL: Duration = Duration::from_secs(5);
const LOOP_SLEEP: Duration = Duration::from_secs(1);
const SHUTDOWN_FLUSH_TIMEOUT: Duration = Duration::from_secs(3);
const SEND_RETRY_BACKOFF: Duration = Duration::from_secs(60);
const MAX_DIMENSION_KEYS: usize = 16;
const MAX_ROUTE_KEYS: usize = 64;
const MAX_VALUE_LENGTH: usize = 64;
const MAX_DETAILS_PER_CHANNEL: usize = 64;
const MAX_DETAILS_PER_PAYLOAD: usize = 20;
const MAX_COUNT: u32 = 100_000;

#[derive(Clone)]
pub struct TelemetryRuntime {
    inner: Arc<TelemetryRuntimeInner>,
}

pub struct TelemetryRuntimeDeps {
    pub config: ConfigRepository,
    pub session: HostSessionRuntime,
    pub tasks: TaskSupervisor,
    pub backend_runtime: BackendRuntime,
    pub app_version: String,
    pub app_data: PathBuf,
}

struct TelemetryRuntimeInner {
    config: ConfigRepository,
    session: HostSessionRuntime,
    tasks: TaskSupervisor,
    backend_runtime: BackendRuntime,
    client: TelemetryClient,
    app_version: String,
    app_data: PathBuf,
    state: Mutex<TelemetryState>,
    running: AtomicBool,
    shutdown_flushed: AtomicBool,
}

#[derive(Default)]
struct TelemetryState {
    session: Option<TelemetrySession>,
    session_start_sent: bool,
    session_start_attempted_at: Option<Instant>,
    config_snapshot_sent: bool,
    config_snapshot_attempted_at: Option<Instant>,
    view_modes_seeded: bool,
    last_heartbeat_at: Option<Instant>,
    last_vrchat_check_at: Option<Instant>,
    last_vrchat_running: Option<bool>,
    pending_error_cursor: Option<String>,
    acc: TelemetryAccumulator,
}

#[derive(Clone)]
struct TelemetrySession {
    install_id: String,
    session_id: String,
    is_new_install: bool,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TelemetryClientEvent {
    PageVisit {
        route: String,
    },
    RouteError {
        error_class: String,
        name: Option<String>,
        summary: Option<String>,
    },
    ViewModeSwitch {
        dimension: String,
        value: String,
    },
    AssistantOpen,
    AssistantApiKeyConfigured,
    AssistantToolError {
        source: Option<String>,
        summary: Option<String>,
    },
    AssistantTurnError {
        code: String,
        summary: Option<String>,
    },
}

#[derive(Default)]
pub struct TelemetryAccumulator {
    current_route: Option<String>,
    view_modes: HashMap<String, ViewModeUsage>,
    routes: HashMap<String, RouteUsage>,
    assistant: AssistantHealthAccumulator,
    assistant_usage: AssistantUsageEntry,
    client_errors: DetailAccumulator,
}

#[derive(Default)]
struct ViewModeUsage {
    used: BTreeSet<String>,
    switches: u32,
}

#[derive(Default)]
struct RouteUsage {
    visits: u32,
    load_fail: u32,
    render_crash: u32,
    details: DetailAccumulator,
}

#[derive(Default)]
struct AssistantHealthAccumulator {
    tool_errors: u32,
    turn_errors: u32,
    details: DetailAccumulator,
}

#[derive(Default)]
struct AssistantUsageEntry {
    opens: u32,
    api_key_configured: bool,
}

#[derive(Default)]
struct DetailAccumulator {
    details: HashMap<String, TelemetryErrorDetail>,
}

#[derive(Default)]
pub struct AssistantHealthEntry {
    pub tool_errors: u32,
    pub turn_errors: u32,
    pub details: Option<Vec<TelemetryErrorDetail>>,
}

impl TelemetryRuntime {
    pub fn new(deps: TelemetryRuntimeDeps) -> Self {
        Self {
            inner: Arc::new(TelemetryRuntimeInner {
                config: deps.config,
                session: deps.session,
                tasks: deps.tasks,
                backend_runtime: deps.backend_runtime,
                client: TelemetryClient::new(resolve_endpoint()),
                app_version: normalize_app_version(&deps.app_version),
                app_data: deps.app_data,
                state: Mutex::new(TelemetryState::default()),
                running: AtomicBool::new(false),
                shutdown_flushed: AtomicBool::new(false),
            }),
        }
    }

    pub fn start(&self) {
        if self.inner.running.swap(true, Ordering::AcqRel) {
            return;
        }
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
        if self.inner.shutdown_flushed.swap(true, Ordering::AcqRel) {
            return;
        }
        let _ = tokio::time::timeout(SHUTDOWN_FLUSH_TIMEOUT, self.flush_shutdown_inner()).await;
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
        if !self.inner.client.is_enabled() {
            return;
        }
        let Some(session) = self.ensure_session() else {
            return;
        };
        self.ensure_session_start(&session).await;
        self.seed_view_modes_once();
        self.send_config_snapshot_once(&session).await;
        self.send_vrchat_if_changed(&session).await;
        self.send_heartbeat_if_due(&session).await;
    }

    async fn flush_shutdown_inner(&self) {
        if !self.inner.client.is_enabled() || !self.usage_enabled() {
            return;
        }
        let Some(session) = self.ensure_session() else {
            return;
        };
        self.drain_rust_errors();
        let context = self.context(&session, Some(true));
        self.post_debug(
            "/api/v1/telemetry/session/heartbeat",
            &context,
            "shutdown heartbeat",
        )
        .await;
        self.flush_collectors(&session).await;
    }

    fn ensure_session(&self) -> Option<TelemetrySession> {
        let mut state = self.inner.state.lock().ok()?;
        if let Some(session) = &state.session {
            return Some(session.clone());
        }
        let raw = self
            .inner
            .config
            .get_string(TELEMETRY_INSTALL_ID_CONFIG_KEY, "")
            .unwrap_or_default();
        let trimmed = raw.trim();
        let (install_id, is_new_install) = if trimmed.is_empty() {
            let install_id = Uuid::new_v4().to_string();
            if let Err(error) = self
                .inner
                .config
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
            if let Err(error) = self.inner.config.set_string(
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
            .config
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
            if let Err(error) = self.inner.config.set_string(
                TELEMETRY_CONFIG_REPORTED_VERSION_CONFIG_KEY,
                &self.inner.app_version,
            ) {
                tracing::debug!("failed to mark telemetry config version: {error}");
            }
        }
    }

    async fn send_vrchat_if_changed(&self, session: &TelemetrySession) {
        let now = Instant::now();
        {
            let Ok(state) = self.inner.state.lock() else {
                return;
            };
            if state
                .last_vrchat_check_at
                .is_some_and(|last| now.duration_since(last) < VRCHAT_CHECK_INTERVAL)
            {
                return;
            }
        }
        let running = self.inner.session.snapshot().is_game_running;
        let should_send = {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            state.last_vrchat_check_at = Some(now);
            let changed = should_send_vrchat_lifecycle(state.last_vrchat_running, running);
            state.last_vrchat_running = Some(running);
            changed
        };
        if !should_send {
            return;
        }
        if !self.usage_enabled() {
            return;
        }
        let payload = VrchatLifecyclePayload {
            context: self.context(session, None),
            state: if running { "started" } else { "stopped" }.into(),
        };
        self.post_debug("/api/v1/telemetry/vrchat", &payload, "vrchat lifecycle")
            .await;
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
        self.drain_rust_errors();
        let context = self.context(session, None);
        self.post_debug("/api/v1/telemetry/session/heartbeat", &context, "heartbeat")
            .await;
        self.flush_collectors(session).await;
    }

    async fn flush_collectors(&self, session: &TelemetrySession) {
        let (view_modes, routes, assistant_health, assistant_usage, client_errors) = {
            let Ok(state) = self.inner.state.lock() else {
                return;
            };
            (
                state.acc.view_mode_entries(),
                state.acc.route_entries(),
                state.acc.assistant_health_entry(),
                state.acc.assistant_usage_entry(),
                state.acc.client_error_entries(),
            )
        };
        let context = self.context(session, None);
        if !view_modes.is_empty() {
            let payload = ViewModeUsagePayload {
                context: context.clone(),
                modes: view_modes,
            };
            self.post_debug("/api/v1/telemetry/view-mode", &payload, "view mode")
                .await;
        }
        if !routes.is_empty() {
            let payload = PageHealthPayload {
                context: context.clone(),
                routes,
            };
            self.post_debug("/api/v1/telemetry/page-health", &payload, "page health")
                .await;
        }
        if let Some(assistant_health) = assistant_health {
            let payload = AssistantHealthPayload {
                context: context.clone(),
                tool_errors: assistant_health.tool_errors,
                turn_errors: assistant_health.turn_errors,
                details: assistant_health.details,
            };
            self.post_debug(
                "/api/v1/telemetry/assistant-health",
                &payload,
                "assistant health",
            )
            .await;
        }
        if let Some(assistant_usage) = assistant_usage {
            let payload = AssistantUsagePayload {
                context: context.clone(),
                opens: assistant_usage.opens,
                api_key_configured: assistant_usage.api_key_configured.then_some(true),
            };
            self.post_debug(
                "/api/v1/telemetry/assistant-usage",
                &payload,
                "assistant usage",
            )
            .await;
        }
        if !client_errors.is_empty() {
            for chunk in client_errors.chunks(MAX_DETAILS_PER_PAYLOAD) {
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
            self.advance_pending_error_cursor();
        }
    }

    async fn post_debug<T>(&self, path: &str, payload: &T, label: &str) -> bool
    where
        T: serde::Serialize + ?Sized,
    {
        match self.inner.client.post(path, payload).await {
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
            platform: current_platform().to_string(),
            arch: current_arch().to_string(),
            locale: self.locale(),
            timezone: iana_time_zone::get_timezone().unwrap_or_else(|_| "unknown".into()),
            mode: runtime_mode(self.inner.backend_runtime.snapshot().mode),
            vrchat_running: self.inner.session.snapshot().is_game_running,
            local_weekday: local_weekday_number(now.weekday()),
            local_hour: now.hour(),
            session_ended,
        }
    }

    fn basic_context(&self, session: &TelemetrySession) -> TelemetryContext {
        TelemetryContext {
            mode: TelemetryRuntimeMode::Foreground,
            vrchat_running: false,
            ..self.context(session, None)
        }
    }

    fn config_snapshot(&self) -> TelemetryConfigSnapshot {
        TelemetryConfigSnapshot {
            background_mode_enabled: self.config_bool("backgroundModeEnabled", false),
            wrist_overlay_enabled: self.config_bool("wristOverlayEnabled", false),
            xs_notifications: self.config_bool("xsNotifications", true),
            ovrt_hud_notifications: self.config_bool("ovrtHudNotifications", true),
            ovrt_wrist_notifications: self.config_bool("ovrtWristNotifications", false),
            discord_active: self.config_bool("discordActive", false),
            mcp_server_enabled: self.config_bool("mcpServerEnabled", false),
            webhook_enabled: self.config_bool("webhookEnabled", false),
            auto_state_change_enabled: self.config_bool("autoStateChangeEnabled", false),
            auto_accept_invite_requests: normalize_enum_value(
                &self.config_string("autoAcceptInviteRequests", "Off"),
            ),
            avatar_auto_cleanup: normalize_enum_value(
                &self.config_string("avatarAutoCleanup", "Off"),
            ),
            theme_mode: self.theme_category(),
        }
    }

    fn seed_view_modes_once(&self) {
        let mut state = match self.inner.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::debug!("failed to lock telemetry state for view-mode seed: {error}");
                return;
            }
        };
        if state.view_modes_seeded {
            return;
        }
        for (dimension, key, default_value, allowed) in view_mode_dimensions() {
            let raw = self.config_string(key, default_value);
            let value = normalize_allowed_view_mode(&raw, allowed).unwrap_or(default_value);
            state.acc.seed_view_mode(dimension, value);
        }
        state.view_modes_seeded = true;
    }

    fn drain_rust_errors(&self) {
        let since = self.current_error_cursor();
        let entries = drain_client_error_log(&self.inner.app_data, since.as_deref(), 100);
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
            state
                .acc
                .record_rust_error(&entry.source, app_version, &entry.message);
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
            .config
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn advance_pending_error_cursor(&self) {
        let cursor = match self.inner.state.lock() {
            Ok(mut state) => state.pending_error_cursor.take(),
            Err(error) => {
                tracing::debug!("failed to lock telemetry state for cursor advance: {error}");
                None
            }
        };
        if let Some(cursor) = cursor {
            if let Err(error) = self
                .inner
                .config
                .set_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, &cursor)
            {
                tracing::debug!("failed to advance telemetry client error cursor: {error}");
            }
        }
    }

    fn locale(&self) -> String {
        let app_language = self.config_string("appLanguage", "");
        if !app_language.trim().is_empty() {
            return normalize_locale(&app_language);
        }
        sys_locale::get_locale()
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
        theme_mode_category(&theme_mode, current_system_theme_category()).into()
    }

    fn config_bool(&self, key: &str, default_value: bool) -> bool {
        self.inner
            .config
            .get_bool(key, default_value)
            .unwrap_or(default_value)
    }

    fn config_string(&self, key: &str, default_value: &str) -> String {
        self.inner
            .config
            .get_string(key, default_value)
            .unwrap_or_else(|_| default_value.to_string())
    }

    fn usage_enabled(&self) -> bool {
        self.config_bool(ANONYMOUS_USAGE_TELEMETRY_CONFIG_KEY, true)
    }

    fn should_report_basic_session_start(&self, session: &TelemetrySession) -> bool {
        if session.is_new_install {
            return true;
        }
        self.inner
            .config
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

impl TelemetryAccumulator {
    pub fn record(&mut self, event: TelemetryClientEvent) {
        match event {
            TelemetryClientEvent::PageVisit { route } => self.record_page_visit(route),
            TelemetryClientEvent::RouteError {
                error_class,
                name,
                summary,
            } => self.record_route_error(error_class, name, summary),
            TelemetryClientEvent::ViewModeSwitch { dimension, value } => {
                self.record_view_mode_switch(dimension, value)
            }
            TelemetryClientEvent::AssistantOpen => {
                self.assistant_usage.opens = increment(self.assistant_usage.opens);
            }
            TelemetryClientEvent::AssistantApiKeyConfigured => {
                self.assistant_usage.api_key_configured = true;
            }
            TelemetryClientEvent::AssistantToolError { source, summary } => {
                self.assistant.tool_errors = increment(self.assistant.tool_errors);
                self.assistant.details.record(build_error_detail(
                    "tool_error",
                    source.as_deref(),
                    None,
                    None,
                    summary.as_deref(),
                    None,
                ));
            }
            TelemetryClientEvent::AssistantTurnError { code, summary } => {
                if code == "cancelled" {
                    return;
                }
                self.assistant.turn_errors = increment(self.assistant.turn_errors);
                self.assistant.details.record(build_error_detail(
                    "turn_error",
                    None,
                    Some(code.as_str()),
                    None,
                    summary.as_deref(),
                    None,
                ));
            }
        }
    }

    pub fn record_rust_error(&mut self, source: &str, app_version: &str, message: &str) {
        let kind = match source {
            "rust:panic" => "panic",
            "rust:tracing" => "rust_error",
            _ => return,
        };
        let detail = build_error_detail(
            kind,
            Some(source),
            None,
            None,
            Some(message),
            Some(app_version),
        );
        self.client_errors.record(detail);
    }

    pub fn route_entries(&self) -> Vec<RouteUsageEntry> {
        let mut entries = self
            .routes
            .iter()
            .map(|(route, usage)| RouteUsageEntry {
                route: route.clone(),
                visits: usage.visits,
                load_fail: (usage.load_fail > 0).then_some(usage.load_fail),
                render_crash: (usage.render_crash > 0).then_some(usage.render_crash),
                details: usage.details.serialize(),
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.route.cmp(&right.route));
        entries
    }

    pub fn assistant_health_entry(&self) -> Option<AssistantHealthEntry> {
        if self.assistant.tool_errors == 0 && self.assistant.turn_errors == 0 {
            return None;
        }
        Some(AssistantHealthEntry {
            tool_errors: self.assistant.tool_errors,
            turn_errors: self.assistant.turn_errors,
            details: self.assistant.details.serialize(),
        })
    }

    pub fn client_error_entries(&self) -> Vec<TelemetryErrorDetail> {
        self.client_errors
            .serialize_with_limit(self.client_errors.details.len())
            .unwrap_or_default()
    }

    fn assistant_usage_entry(&self) -> Option<AssistantUsageEntry> {
        if self.assistant_usage.opens == 0 && !self.assistant_usage.api_key_configured {
            return None;
        }
        Some(AssistantUsageEntry {
            opens: self.assistant_usage.opens,
            api_key_configured: self.assistant_usage.api_key_configured,
        })
    }

    fn view_mode_entries(&self) -> Vec<ViewModeUsageEntry> {
        let mut entries = self
            .view_modes
            .iter()
            .filter(|(_, usage)| !usage.used.is_empty())
            .map(|(dimension, usage)| ViewModeUsageEntry {
                dimension: dimension.clone(),
                used: usage.used.iter().cloned().collect(),
                switches: usage.switches,
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.dimension.cmp(&right.dimension));
        entries
    }

    fn record_page_visit(&mut self, route: String) {
        let Some(route) = sanitize_dimension_value(route) else {
            self.current_route = None;
            return;
        };
        self.current_route = Some(route.clone());
        let Some(usage) = ensure_entry(&mut self.routes, route, MAX_ROUTE_KEYS) else {
            return;
        };
        usage.visits = increment(usage.visits);
    }

    fn record_route_error(
        &mut self,
        error_class: String,
        name: Option<String>,
        summary: Option<String>,
    ) {
        let Some(route) = self.current_route.clone() else {
            return;
        };
        let Some(usage) = self.routes.get_mut(&route) else {
            return;
        };
        match error_class.as_str() {
            "load_fail" => usage.load_fail = increment(usage.load_fail),
            "render_crash" => usage.render_crash = increment(usage.render_crash),
            _ => return,
        }
        usage.details.record(build_error_detail(
            &error_class,
            None,
            None,
            name.as_deref(),
            summary.as_deref(),
            None,
        ));
    }

    fn record_view_mode_switch(&mut self, dimension: String, value: String) {
        let Some(dimension) = sanitize_dimension_value(dimension) else {
            return;
        };
        let Some(value) = sanitize_dimension_value(value) else {
            return;
        };
        let Some(usage) = ensure_entry(&mut self.view_modes, dimension, MAX_DIMENSION_KEYS) else {
            return;
        };
        usage.used.insert(value);
        usage.switches = increment(usage.switches);
    }

    fn seed_view_mode(&mut self, dimension: &str, value: &str) {
        let Some(usage) = ensure_entry(
            &mut self.view_modes,
            dimension.to_string(),
            MAX_DIMENSION_KEYS,
        ) else {
            return;
        };
        usage.used.insert(value.to_string());
    }
}

impl DetailAccumulator {
    fn record(&mut self, detail: TelemetryErrorDetail) {
        let key = detail_key(&detail);
        if !self.details.contains_key(&key) && self.details.len() >= MAX_DETAILS_PER_CHANNEL {
            tracing::debug!("telemetry detail cap reached; dropping detail");
            return;
        }
        match self.details.get_mut(&key) {
            Some(existing) => existing.count = increment(existing.count),
            None => {
                self.details.insert(key, detail);
            }
        }
    }

    fn serialize(&self) -> Option<Vec<TelemetryErrorDetail>> {
        self.serialize_with_limit(MAX_DETAILS_PER_PAYLOAD)
    }

    fn serialize_with_limit(&self, limit: usize) -> Option<Vec<TelemetryErrorDetail>> {
        if self.details.is_empty() {
            return None;
        }
        let mut details = self.details.values().cloned().collect::<Vec<_>>();
        details.sort_by(|left, right| {
            right
                .count
                .cmp(&left.count)
                .then_with(|| left.signature.cmp(&right.signature))
        });
        details.truncate(limit);
        Some(details)
    }
}

fn runtime_mode(mode: BackendRuntimeMode) -> TelemetryRuntimeMode {
    match mode {
        BackendRuntimeMode::Foreground => TelemetryRuntimeMode::Foreground,
        BackendRuntimeMode::Background => TelemetryRuntimeMode::Background,
        BackendRuntimeMode::Headless => TelemetryRuntimeMode::Headless,
    }
}

fn should_send_vrchat_lifecycle(previous: Option<bool>, running: bool) -> bool {
    match previous {
        Some(previous) => previous != running,
        None => running,
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

fn normalize_allowed_view_mode<'a>(value: &str, allowed: &'a [&'a str]) -> Option<&'a str> {
    let normalized = value.trim().to_ascii_lowercase();
    allowed
        .iter()
        .copied()
        .find(|candidate| *candidate == normalized)
}

fn view_mode_dimensions() -> [(
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
); 4] {
    [
        (
            "gameLogViewMode",
            "gameLogViewMode",
            "sessions",
            &["sessions", "table"],
        ),
        (
            "myAvatarsViewMode",
            "MyAvatarsViewMode",
            "grid",
            &["grid", "table"],
        ),
        (
            "feedViewMode",
            "feedViewMode",
            "table",
            &["table", "columns"],
        ),
        (
            "feedTimeDisplayMode",
            "feedTimeDisplayMode",
            "relative",
            &["relative", "exact"],
        ),
    ]
}

fn ensure_entry<T: Default>(
    map: &mut HashMap<String, T>,
    key: String,
    cap: usize,
) -> Option<&mut T> {
    if !map.contains_key(&key) && map.len() >= cap {
        tracing::debug!("telemetry dimension cap reached; dropping {key}");
        return None;
    }
    Some(map.entry(key).or_default())
}

fn sanitize_dimension_value(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.chars().take(MAX_VALUE_LENGTH).collect())
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

fn theme_mode_category(value: &str, system_theme: Option<&str>) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "dark" | "midnight" => "dark",
        "light" => "light",
        "system" => match system_theme {
            Some("dark") => "dark",
            Some("light") => "light",
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

fn detail_key(detail: &TelemetryErrorDetail) -> String {
    match detail.app_version.as_deref() {
        Some(app_version) if !app_version.is_empty() => {
            format!("{app_version}:{}", detail.signature)
        }
        _ => detail.signature.clone(),
    }
}

fn increment(value: u32) -> u32 {
    value.saturating_add(1).min(MAX_COUNT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Weekday;

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
    fn vrchat_lifecycle_skips_initial_stopped_baseline() {
        assert!(!should_send_vrchat_lifecycle(None, false));
        assert!(should_send_vrchat_lifecycle(None, true));
        assert!(should_send_vrchat_lifecycle(Some(true), false));
        assert!(should_send_vrchat_lifecycle(Some(false), true));
        assert!(!should_send_vrchat_lifecycle(Some(false), false));
    }

    fn instant_past_epoch_safe(headroom: Duration) -> Instant {
        Instant::now() + headroom
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
        assert_eq!(theme_mode_category("dark", None), "dark");
        assert_eq!(theme_mode_category("midnight", None), "dark");
        assert_eq!(theme_mode_category("light", None), "light");
        assert_eq!(theme_mode_category("system", Some("dark")), "dark");
        assert_eq!(theme_mode_category("system", Some("light")), "light");
        assert_eq!(theme_mode_category("system", None), "light");
        assert_eq!(theme_mode_category("other", None), "unknown");
    }

    #[test]
    fn helpers_normalize_config_and_dimension_values() {
        assert_eq!(normalize_enum_value(" On Demand "), "on_demand");
        assert_eq!(normalize_enum_value(""), "unknown");
        assert_eq!(normalize_locale("zh_CN"), "zh-CN");
        assert_eq!(normalize_app_version(""), "unknown");
        assert_eq!(
            normalize_allowed_view_mode(" TABLE ", &["sessions", "table"]),
            Some("table")
        );
        assert_eq!(
            normalize_allowed_view_mode("cards", &["sessions", "table"]),
            None
        );
    }

    #[test]
    fn accumulator_caps_routes_and_error_details() {
        let mut acc = TelemetryAccumulator::default();
        for index in 0..70 {
            acc.record(TelemetryClientEvent::PageVisit {
                route: format!("route_{index}"),
            });
        }
        assert_eq!(acc.route_entries().len(), MAX_ROUTE_KEYS);

        let mut detail_acc = TelemetryAccumulator::default();
        detail_acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
        });
        for index in 0..70 {
            detail_acc.record(TelemetryClientEvent::RouteError {
                error_class: "render_crash".into(),
                name: Some("TypeError".into()),
                summary: Some(format!("failure {index}")),
            });
        }
        let routes = detail_acc.route_entries();
        let details = routes[0]
            .details
            .as_ref()
            .expect("details should be serialized");
        assert_eq!(details.len(), MAX_DETAILS_PER_PAYLOAD);
    }
}
