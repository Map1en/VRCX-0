use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrcx_0_application_core::RuntimeOperationStatus;

use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use vrcx_0_application_core::sleep_until_due_or_stopped;
use vrcx_0_application_core::RuntimeEventBus;
use vrcx_0_application_core::TaskSupervisor;
use vrcx_0_application_core::{Error, Result, RuntimeBackgroundJobs};
use vrcx_0_application_core::{
    UpdaterCheckRequest, UpdaterDownloadProgress, UpdaterMetadata, UpdaterPort,
    UpdaterProgressCallback,
};
use vrcx_0_core::time::now_iso;

use super::ProfileConfigStore;

mod release;
#[cfg(test)]
mod tests;

use self::release::{
    compare_release_versions, is_release_newer_than_current,
    is_stable_release_newer_than_preview_build, normalize_release,
    parse_preview_build_timestamp_ms, release_channel_for_version,
};

const APP_UPDATE_CHECK_JOB: &str = "appUpdateCheck";

fn load_updater_proxy_url(config: &dyn ProfileConfigStore) -> Option<String> {
    let raw_enabled = config.storage_get(vrcx_0_application_core::PROXY_ENABLED_STORAGE_KEY);
    let raw_proxy_url = config
        .storage_get(vrcx_0_application_core::PROXY_STORAGE_KEY)
        .unwrap_or_default();
    vrcx_0_application_core::load_proxy_url(raw_enabled.as_deref(), &raw_proxy_url)
}
const APP_UPDATE_CHECK_INTERVAL_SECONDS: u64 = 10_800;
const APP_UPDATE_PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(500);
const CONFIG_AUTO_INSTALL_ON_STARTUP: &str = "autoInstallUpdatesOnStartup";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppUpdateDeliveryKind {
    Tauri,
    Manual,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppUpdateChannel {
    Stable,
    Beta,
}

#[derive(Clone, Debug, Default)]
pub struct AppUpdateCatalogAsset {
    pub state: Option<String>,
    pub name: Option<String>,
    pub browser_download_url: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct AppUpdateCatalogRelease {
    pub tag_name: Option<String>,
    pub assets: Vec<AppUpdateCatalogAsset>,
    pub html_url: Option<String>,
    pub name: Option<String>,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub body: Option<String>,
}

pub type AppUpdateReleaseCatalogFuture<'a> = BoxFuture<'a, Result<Vec<AppUpdateCatalogRelease>>>;

pub trait AppUpdateReleaseCatalogPort: Send + Sync {
    fn list_releases(&self) -> AppUpdateReleaseCatalogFuture<'_>;
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateReleaseSnapshot {
    pub display_name: String,
    pub tag_name: String,
    pub html_url: String,
    pub published_at: String,
    pub body: String,
    pub canonical_version: String,
    pub display_version: String,
    pub channel: AppUpdateChannel,
    pub manifest_url: String,
    pub target: String,
    pub updater_type: AppUpdateDeliveryKind,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatusSnapshot {
    pub has_available_update: bool,
    pub checked_at: String,
    pub detail: String,
    pub error: Option<String>,
    pub release: Option<AppUpdateReleaseSnapshot>,
    pub should_notify: bool,
}

impl AppUpdateStatusSnapshot {
    fn idle() -> Self {
        Self {
            has_available_update: false,
            checked_at: String::new(),
            detail: "App update check has not run yet.".into(),
            error: None,
            release: None,
            should_notify: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct AppUpdateBuildInfo {
    pub app_version: String,
    pub build_label: String,
    pub build_badge: String,
    pub update_check_disabled: bool,
}

pub type AppUpdateTargetResolver = Arc<dyn Fn() -> Option<String> + Send + Sync>;

pub struct AppUpdateCheckContext<'a> {
    pub(crate) release_catalog: &'a dyn AppUpdateReleaseCatalogPort,
    pub app_version: &'a str,
    pub build_label: &'a str,
    pub build_badge: &'a str,
    pub channel: AppUpdateChannel,
    pub target: Option<&'a str>,
    pub port: &'a Arc<dyn UpdaterPort>,
    pub proxy: Option<&'a str>,
}

struct CheckOutcome {
    has_available_update: bool,
    detail: String,
    release: Option<AppUpdateReleaseSnapshot>,
}

fn no_update_outcome(detail: impl Into<String>) -> CheckOutcome {
    CheckOutcome {
        has_available_update: false,
        detail: detail.into(),
        release: None,
    }
}

fn up_to_date_outcome(
    release: AppUpdateReleaseSnapshot,
    detail: impl Into<String>,
) -> CheckOutcome {
    CheckOutcome {
        has_available_update: false,
        detail: detail.into(),
        release: Some(release),
    }
}

fn update_available_outcome(
    release: AppUpdateReleaseSnapshot,
    detail: impl Into<String>,
) -> CheckOutcome {
    CheckOutcome {
        has_available_update: true,
        detail: detail.into(),
        release: Some(release),
    }
}

async fn fetch_latest_release(
    release_catalog: &dyn AppUpdateReleaseCatalogPort,
    channel: AppUpdateChannel,
    target: Option<&str>,
    require_installer_asset: bool,
) -> Result<Option<AppUpdateReleaseSnapshot>> {
    let releases = release_catalog.list_releases().await?;
    let mut normalized: Vec<AppUpdateReleaseSnapshot> = releases
        .iter()
        .filter_map(|release| normalize_release(release, target, require_installer_asset))
        .filter(|release| release.channel == channel)
        .collect();
    normalized.sort_by(|left, right| {
        compare_release_versions(&right.canonical_version, &left.canonical_version)
    });
    Ok(normalized.into_iter().next())
}

async fn run_check_inner(context: &AppUpdateCheckContext<'_>) -> Result<CheckOutcome> {
    if let Some(preview_build_timestamp_ms) =
        parse_preview_build_timestamp_ms(context.build_label, context.build_badge)
    {
        let release = fetch_latest_release(
            context.release_catalog,
            AppUpdateChannel::Stable,
            context.target,
            false,
        )
        .await?;
        return Ok(
            match release.filter(|release| {
                is_stable_release_newer_than_preview_build(release, preview_build_timestamp_ms)
            }) {
                Some(release) => update_available_outcome(
                    release,
                    "Preview build has a newer Stable release available.",
                ),
                None => no_update_outcome("No newer Stable release found for this preview build."),
            },
        );
    }

    if let Some(target) = context.target {
        let release =
            fetch_latest_release(context.release_catalog, context.channel, Some(target), true)
                .await?;
        let Some(release) = release else {
            return Ok(no_update_outcome("No newer installable release was found."));
        };
        if !is_release_newer_than_current(&release, context.app_version) {
            return Ok(up_to_date_outcome(
                release,
                "No newer installable release was found.",
            ));
        }

        let manifest_check = context
            .port
            .check(UpdaterCheckRequest {
                manifest_url: release.manifest_url.clone(),
                target: target.to_string(),
                current_version: context.app_version.to_string(),
                expected_version: release.canonical_version.clone(),
                allow_downgrades: false,
                proxy: context.proxy.map(str::to_string),
            })
            .await;
        return Ok(match manifest_check {
            Ok(Some(_)) => {
                update_available_outcome(release, "A newer installable release is available.")
            }
            Ok(None) => {
                no_update_outcome("Updater manifest did not confirm an installable update.")
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "updater manifest check failed; falling back to release comparison"
                );
                update_available_outcome(release, "A newer installable release is available.")
            }
        });
    }

    let release =
        fetch_latest_release(context.release_catalog, context.channel, None, false).await?;
    Ok(match release {
        Some(release) if is_release_newer_than_current(&release, context.app_version) => {
            update_available_outcome(
                release,
                "A newer release is available; this platform does not support in-app installs.",
            )
        }
        Some(release) => up_to_date_outcome(release, "No newer release was found."),
        None => no_update_outcome("No newer release was found."),
    })
}

async fn run_check(context: &AppUpdateCheckContext<'_>) -> AppUpdateStatusSnapshot {
    let checked_at = now_iso();
    match run_check_inner(context).await {
        Ok(outcome) => AppUpdateStatusSnapshot {
            has_available_update: outcome.has_available_update,
            checked_at,
            detail: outcome.detail,
            error: None,
            release: outcome.release,
            should_notify: false,
        },
        Err(error) => AppUpdateStatusSnapshot {
            has_available_update: false,
            checked_at,
            detail: String::new(),
            error: Some(error.to_string()),
            release: None,
            should_notify: false,
        },
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppUpdateDownloadPhase {
    Idle,
    Downloading,
    Downloaded,
    Installing,
    Error,
}

struct PendingDownload {
    version: String,
    metadata: UpdaterMetadata,
    handle: vrcx_0_application_core::UpdaterInstallHandle,
}

struct DownloadState {
    phase: AppUpdateDownloadPhase,
    version: Option<String>,
    started_at: Option<String>,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: u32,
    error: Option<String>,
    pending: Option<PendingDownload>,
    queued: Option<AppUpdateReleaseSnapshot>,
    last_progress_emitted_at: Option<Instant>,
}

impl DownloadState {
    fn idle() -> Self {
        Self {
            phase: AppUpdateDownloadPhase::Idle,
            version: None,
            started_at: None,
            downloaded_bytes: 0,
            total_bytes: 0,
            percent: 0,
            error: None,
            pending: None,
            queued: None,
            last_progress_emitted_at: None,
        }
    }

    fn snapshot(&self) -> AppUpdateDownloadStatusSnapshot {
        AppUpdateDownloadStatusSnapshot {
            phase: self.phase,
            version: self.version.clone(),
            started_at: self.started_at.clone(),
            downloaded_bytes: self.downloaded_bytes,
            total_bytes: self.total_bytes,
            percent: self.percent,
            error: self.error.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateDownloadStatusSnapshot {
    pub phase: AppUpdateDownloadPhase,
    pub version: Option<String>,
    pub started_at: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u32,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateDownloadProgressPayload {
    pub version: String,
    pub phase: AppUpdateDownloadPhase,
    pub started_at: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u32,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstalledPayload {
    pub version: String,
    pub metadata: UpdaterMetadata,
}

struct AppUpdateRuntimeInner {
    release_catalog: Arc<dyn AppUpdateReleaseCatalogPort>,
    config: Arc<dyn ProfileConfigStore>,
    event_bus: RuntimeEventBus,
    background_jobs: RuntimeBackgroundJobs,
    build: AppUpdateBuildInfo,
    channel: AppUpdateChannel,
    target_resolver: AppUpdateTargetResolver,
    port: Arc<dyn UpdaterPort>,
    tasks: TaskSupervisor,
    status: Mutex<AppUpdateStatusSnapshot>,
    download: Mutex<DownloadState>,
    download_notify: Notify,
    started: AtomicBool,
    first_check_done: AtomicBool,
    hydration_notified_version: Mutex<Option<String>>,
}

pub struct AppUpdateRuntimeDeps {
    pub release_catalog: Arc<dyn AppUpdateReleaseCatalogPort>,
    pub(crate) config: Arc<dyn ProfileConfigStore>,
    pub event_bus: RuntimeEventBus,
    pub background_jobs: RuntimeBackgroundJobs,
    pub build: AppUpdateBuildInfo,
    pub target_resolver: AppUpdateTargetResolver,
    pub port: Arc<dyn UpdaterPort>,
    pub tasks: TaskSupervisor,
}

impl AppUpdateRuntimeDeps {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        release_catalog: Arc<dyn AppUpdateReleaseCatalogPort>,
        config: Arc<dyn ProfileConfigStore>,
        event_bus: RuntimeEventBus,
        background_jobs: RuntimeBackgroundJobs,
        build: AppUpdateBuildInfo,
        target_resolver: AppUpdateTargetResolver,
        port: Arc<dyn UpdaterPort>,
        tasks: TaskSupervisor,
    ) -> Self {
        Self {
            release_catalog,
            config,
            event_bus,
            background_jobs,
            build,
            target_resolver,
            port,
            tasks,
        }
    }
}

#[derive(Clone)]
pub struct AppUpdateRuntime {
    inner: Arc<AppUpdateRuntimeInner>,
}

impl AppUpdateRuntime {
    pub fn new(deps: AppUpdateRuntimeDeps) -> Self {
        let channel = release_channel_for_version(&deps.build.app_version)
            .unwrap_or(AppUpdateChannel::Stable);
        Self {
            inner: Arc::new(AppUpdateRuntimeInner {
                release_catalog: deps.release_catalog,
                config: deps.config,
                event_bus: deps.event_bus,
                background_jobs: deps.background_jobs,
                build: deps.build,
                channel,
                target_resolver: deps.target_resolver,
                port: deps.port,
                tasks: deps.tasks,
                status: Mutex::new(AppUpdateStatusSnapshot::idle()),
                download: Mutex::new(DownloadState::idle()),
                download_notify: Notify::new(),
                started: AtomicBool::new(false),
                first_check_done: AtomicBool::new(false),
                hydration_notified_version: Mutex::new(None),
            }),
        }
    }

    pub fn snapshot(&self) -> AppUpdateStatusSnapshot {
        match self.inner.status.lock() {
            Ok(status) => status.clone(),
            Err(error) => {
                tracing::warn!("failed to lock app update status: {error}");
                AppUpdateStatusSnapshot::idle()
            }
        }
    }

    pub fn hydration_snapshot(&self) -> AppUpdateStatusSnapshot {
        let mut snapshot = self.snapshot();
        snapshot.should_notify = self.consume_hydration_notified_marker(snapshot.release.as_ref());
        snapshot
    }

    fn consume_hydration_notified_marker(
        &self,
        release: Option<&AppUpdateReleaseSnapshot>,
    ) -> bool {
        let Some(release) = release else {
            return false;
        };
        let mut marker = match self.inner.hydration_notified_version.lock() {
            Ok(marker) => marker,
            Err(poisoned) => poisoned.into_inner(),
        };
        if marker.as_deref() == Some(release.canonical_version.as_str()) {
            false
        } else {
            *marker = Some(release.canonical_version.clone());
            true
        }
    }

    pub fn download_status(&self) -> AppUpdateDownloadStatusSnapshot {
        self.with_download_state(|state| state.snapshot())
    }

    pub async fn check_now(&self) -> AppUpdateStatusSnapshot {
        self.run_check_cycle().await
    }

    pub async fn latest_release_for_channel(
        &self,
        channel: AppUpdateChannel,
    ) -> Result<Option<AppUpdateReleaseSnapshot>> {
        let target = (self.inner.target_resolver)();
        fetch_latest_release(
            self.inner.release_catalog.as_ref(),
            channel,
            target.as_deref(),
            false,
        )
        .await
    }

    pub async fn install(&self, version: &str) -> Result<UpdaterMetadata> {
        enum Action {
            UsePending(PendingDownload),
            Wait,
            NeedDownload,
        }

        let mut retried_invalid_artifact = false;
        loop {
            let notified = self.inner.download_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let action = self.with_download_state(|state| {
                if let Some(pending) = &state.pending {
                    if pending.version == version
                        && state.phase == AppUpdateDownloadPhase::Downloaded
                    {
                        state.phase = AppUpdateDownloadPhase::Installing;
                        return Action::UsePending(state.pending.take().expect("pending checked"));
                    }
                }
                if state.phase == AppUpdateDownloadPhase::Downloading
                    && state.version.as_deref() == Some(version)
                {
                    return Action::Wait;
                }
                Action::NeedDownload
            });

            match action {
                Action::UsePending(pending) => {
                    let pending_version = pending.version.clone();
                    match self.finish_install(pending).await {
                        Err(Error::UpdateArtifactInvalid(message)) if !retried_invalid_artifact => {
                            retried_invalid_artifact = true;
                            tracing::warn!(
                                version = pending_version,
                                error = %message,
                                "update artifact validation failed; downloading it once more"
                            );
                            self.with_download_state(|state| *state = DownloadState::idle());
                            self.inner.download_notify.notify_waiters();
                        }
                        Err(error) => {
                            self.record_install_error(&pending_version, &error);
                            return Err(error);
                        }
                        Ok(metadata) => return Ok(metadata),
                    }
                }
                Action::Wait => {
                    notified.await;
                }
                Action::NeedDownload => {
                    let release = self.release_for_version(version)?;
                    let status = self.ensure_downloaded(&release).await?;
                    if status.phase != AppUpdateDownloadPhase::Downloaded {
                        return Err(Error::Custom(
                            status
                                .error
                                .unwrap_or_else(|| "Update download failed.".into()),
                        ));
                    }
                }
            }
        }
    }

    fn release_for_version(&self, version: &str) -> Result<AppUpdateReleaseSnapshot> {
        match self.snapshot().release {
            Some(release)
                if release.canonical_version == version
                    && release.updater_type == AppUpdateDeliveryKind::Tauri =>
            {
                Ok(release)
            }
            _ => Err(Error::Custom("no-pending-update".into())),
        }
    }

    fn with_download_state<R>(&self, f: impl FnOnce(&mut DownloadState) -> R) -> R {
        match self.inner.download.lock() {
            Ok(mut state) => f(&mut state),
            Err(poisoned) => {
                tracing::warn!("app update download state mutex poisoned; recovering");
                let mut state = poisoned.into_inner();
                *state = DownloadState::idle();
                f(&mut state)
            }
        }
    }

    async fn ensure_downloaded(
        &self,
        release: &AppUpdateReleaseSnapshot,
    ) -> Result<AppUpdateDownloadStatusSnapshot> {
        let version = release.canonical_version.clone();
        enum StartAction {
            Early(AppUpdateDownloadStatusSnapshot),
            Wait,
            Start,
        }

        loop {
            let notified = self.inner.download_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let action = self.with_download_state(|state| {
                if let Some(pending) = &state.pending {
                    if pending.version == version {
                        return StartAction::Early(state.snapshot());
                    }
                }
                match state.phase {
                    AppUpdateDownloadPhase::Installing => StartAction::Early(state.snapshot()),
                    AppUpdateDownloadPhase::Downloading
                        if state.version.as_deref() == Some(version.as_str()) =>
                    {
                        StartAction::Wait
                    }
                    AppUpdateDownloadPhase::Downloading => {
                        state.queued = Some(release.clone());
                        StartAction::Early(state.snapshot())
                    }
                    _ => {
                        *state = DownloadState {
                            phase: AppUpdateDownloadPhase::Downloading,
                            version: Some(version.clone()),
                            started_at: Some(now_iso()),
                            downloaded_bytes: 0,
                            total_bytes: 0,
                            percent: 0,
                            error: None,
                            pending: None,
                            queued: None,
                            last_progress_emitted_at: None,
                        };
                        StartAction::Start
                    }
                }
            });

            match action {
                StartAction::Early(snapshot) => return Ok(snapshot),
                StartAction::Wait => notified.await,
                StartAction::Start => break,
            }
        }

        let proxy = load_updater_proxy_url(self.inner.config.as_ref());
        let request = UpdaterCheckRequest {
            manifest_url: release.manifest_url.clone(),
            target: release.target.clone(),
            current_version: self.inner.build.app_version.clone(),
            expected_version: release.canonical_version.clone(),
            allow_downgrades: false,
            proxy,
        };
        let progress_runtime = self.clone();
        let progress_version = version.clone();
        let on_progress: UpdaterProgressCallback = Arc::new(move |event| {
            progress_runtime.apply_download_progress(&progress_version, event);
        });
        let download_result = self.inner.port.download(request, on_progress).await;

        let owns_download = |state: &DownloadState| {
            state.phase == AppUpdateDownloadPhase::Downloading
                && state.version.as_deref() == Some(version.as_str())
        };
        let (snapshot, applied, error) = match download_result {
            Ok(outcome) => self.with_download_state(|state| {
                if !owns_download(state) {
                    return (state.snapshot(), false, None);
                }
                state.phase = AppUpdateDownloadPhase::Downloaded;
                let total = state.total_bytes.max(state.downloaded_bytes);
                state.total_bytes = total;
                state.downloaded_bytes = total;
                state.percent = 100;
                state.error = None;
                state.pending = Some(PendingDownload {
                    version: version.clone(),
                    metadata: outcome.metadata,
                    handle: outcome.handle,
                });
                (state.snapshot(), true, None)
            }),
            Err(error) => self.with_download_state(|state| {
                if !owns_download(state) {
                    return (state.snapshot(), false, Some(error));
                }
                state.phase = AppUpdateDownloadPhase::Error;
                state.error = Some(error.to_string());
                (state.snapshot(), true, Some(error))
            }),
        };
        self.inner.download_notify.notify_waiters();
        if applied {
            self.emit_download_progress_snapshot(&snapshot);
        }
        self.maybe_run_queued_download();

        match error {
            Some(error) => Err(error),
            None => Ok(snapshot),
        }
    }

    async fn finish_install(&self, pending: PendingDownload) -> Result<UpdaterMetadata> {
        let PendingDownload {
            version,
            metadata,
            handle,
        } = pending;
        self.inner.port.install(handle).await?;
        self.with_download_state(|state| *state = DownloadState::idle());
        self.inner.download_notify.notify_waiters();
        self.inner.event_bus.emit(AppUpdateInstalledPayload {
            version,
            metadata: metadata.clone(),
        });
        Ok(metadata)
    }

    fn record_install_error(&self, version: &str, error: &Error) {
        let snapshot = self.with_download_state(|state| {
            state.version = Some(version.to_string());
            state.phase = AppUpdateDownloadPhase::Error;
            state.error = Some(error.to_string());
            state.snapshot()
        });
        self.inner.download_notify.notify_waiters();
        self.emit_download_progress_snapshot(&snapshot);
    }

    fn apply_download_progress(&self, version: &str, event: UpdaterDownloadProgress) {
        self.apply_download_progress_at(version, event, Instant::now());
    }

    fn apply_download_progress_at(
        &self,
        version: &str,
        event: UpdaterDownloadProgress,
        now: Instant,
    ) {
        let snapshot = self.with_download_state(|state| {
            if state.version.as_deref() != Some(version) {
                return None;
            }
            let should_emit = match event {
                UpdaterDownloadProgress::Started { content_length } => {
                    state.total_bytes = content_length.unwrap_or(0);
                    state.downloaded_bytes = 0;
                    state.percent = 0;
                    true
                }
                UpdaterDownloadProgress::Progress { chunk_length } => {
                    state.downloaded_bytes =
                        state.downloaded_bytes.saturating_add(chunk_length as u64);
                    state.percent = if state.total_bytes > 0 {
                        ((state.downloaded_bytes as f64 / state.total_bytes as f64) * 100.0)
                            .min(100.0) as u32
                    } else {
                        0
                    };
                    state
                        .last_progress_emitted_at
                        .is_none_or(|last_emitted_at| {
                            now.saturating_duration_since(last_emitted_at)
                                >= APP_UPDATE_PROGRESS_EMIT_INTERVAL
                        })
                }
                UpdaterDownloadProgress::Finished => {
                    state.percent = 100;
                    true
                }
            };
            if !should_emit {
                return None;
            }
            state.last_progress_emitted_at = Some(now);
            Some(state.snapshot())
        });
        if let Some(snapshot) = snapshot {
            self.emit_download_progress_snapshot(&snapshot);
        }
    }

    fn emit_download_progress_snapshot(&self, snapshot: &AppUpdateDownloadStatusSnapshot) {
        let Some(version) = snapshot.version.clone() else {
            return;
        };
        self.inner.event_bus.emit(AppUpdateDownloadProgressPayload {
            version,
            phase: snapshot.phase,
            started_at: snapshot.started_at.clone(),
            downloaded_bytes: snapshot.downloaded_bytes,
            total_bytes: snapshot.total_bytes,
            percent: snapshot.percent,
        });
    }

    fn maybe_run_queued_download(&self) {
        let queued = self.with_download_state(|state| state.queued.take());
        if let Some(release) = queued {
            let runtime = self.clone();
            self.inner.tasks.spawn(async move {
                if let Err(error) = runtime.ensure_downloaded(&release).await {
                    tracing::warn!(error = %error, "queued app update download failed");
                }
            });
        }
    }

    async fn maybe_auto_install_on_startup(
        &self,
        snapshot: &AppUpdateStatusSnapshot,
    ) -> Option<UpdaterMetadata> {
        if !snapshot.has_available_update {
            return None;
        }
        let release = snapshot.release.as_ref()?;
        if release.updater_type != AppUpdateDeliveryKind::Tauri {
            return None;
        }
        let auto_install = self
            .inner
            .config
            .get_bool(CONFIG_AUTO_INSTALL_ON_STARTUP, true)
            .unwrap_or(true);
        if !auto_install {
            return None;
        }

        match self.ensure_downloaded(release).await {
            Ok(status) if status.phase == AppUpdateDownloadPhase::Downloaded => {
                match self.install(&release.canonical_version).await {
                    Ok(metadata) => Some(metadata),
                    Err(error) => {
                        tracing::warn!(error = %error, "auto-install-on-startup install failed");
                        None
                    }
                }
            }
            Ok(_) => None,
            Err(error) => {
                tracing::warn!(error = %error, "auto-install-on-startup download failed");
                None
            }
        }
    }

    fn maybe_auto_background_download(&self, snapshot: &AppUpdateStatusSnapshot) {
        if !snapshot.has_available_update {
            return;
        }
        let Some(release) = snapshot.release.clone() else {
            return;
        };
        if release.updater_type != AppUpdateDeliveryKind::Tauri {
            return;
        }
        let runtime = self.clone();
        self.inner.tasks.spawn(async move {
            if let Err(error) = runtime.ensure_downloaded(&release).await {
                tracing::warn!(error = %error, "auto-background-download failed");
            }
        });
    }

    pub fn start_loop(&self, tasks: TaskSupervisor) {
        if self.inner.started.swap(true, AtomicOrdering::AcqRel) {
            return;
        }

        if !tasks.has_executor() {
            self.inner.background_jobs.register_job(
                APP_UPDATE_CHECK_JOB,
                "rust",
                Some(APP_UPDATE_CHECK_INTERVAL_SECONDS),
                RuntimeOperationStatus::Unavailable,
                "App update checks need a host task executor.",
            );
            return;
        }

        self.inner.background_jobs.register_job(
            APP_UPDATE_CHECK_JOB,
            "rust",
            Some(APP_UPDATE_CHECK_INTERVAL_SECONDS),
            RuntimeOperationStatus::Scheduled,
            "App update checks are scheduled and executed by the Rust runtime.",
        );

        let runtime = self.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            loop {
                if stop_token.is_stop_requested() {
                    return;
                }
                runtime.run_check_cycle().await;
                if !sleep_until_due_or_stopped(
                    Duration::from_secs(APP_UPDATE_CHECK_INTERVAL_SECONDS),
                    &stop_token,
                )
                .await
                {
                    return;
                }
            }
        });
    }

    async fn run_check_cycle(&self) -> AppUpdateStatusSnapshot {
        if self.inner.build.update_check_disabled {
            return self.snapshot();
        }
        self.inner
            .background_jobs
            .mark_running(APP_UPDATE_CHECK_JOB, "Checking for VRCX-0 updates.");

        let target = (self.inner.target_resolver)();
        let proxy = load_updater_proxy_url(self.inner.config.as_ref());
        let context = AppUpdateCheckContext {
            release_catalog: self.inner.release_catalog.as_ref(),
            app_version: &self.inner.build.app_version,
            build_label: &self.inner.build.build_label,
            build_badge: &self.inner.build.build_badge,
            channel: self.inner.channel,
            target: target.as_deref(),
            port: &self.inner.port,
            proxy: proxy.as_deref(),
        };
        let previous_release_version = self
            .snapshot()
            .release
            .map(|release| release.canonical_version);
        let mut snapshot = run_check(&context).await;

        let is_first_check = !self
            .inner
            .first_check_done
            .swap(true, AtomicOrdering::AcqRel);
        if is_first_check {
            if let Some(installed) = self.maybe_auto_install_on_startup(&snapshot).await {
                snapshot.has_available_update = false;
                snapshot.detail = format!(
                    "Installed VRCX-0 {} automatically on startup.",
                    installed.version
                );
            }
        }
        if snapshot.has_available_update {
            self.maybe_auto_background_download(&snapshot);
        }

        snapshot.should_notify = match &snapshot.release {
            Some(release) if snapshot.has_available_update => {
                Some(release.canonical_version.clone()) != previous_release_version
            }
            _ => false,
        };

        match self.inner.status.lock() {
            Ok(mut status) => *status = snapshot.clone(),
            Err(error) => tracing::warn!("failed to lock app update status: {error}"),
        }
        self.inner.event_bus.emit(snapshot.clone());

        match &snapshot.error {
            Some(error) => self
                .inner
                .background_jobs
                .mark_failed(APP_UPDATE_CHECK_JOB, error.clone()),
            None => self
                .inner
                .background_jobs
                .mark_completed(APP_UPDATE_CHECK_JOB, snapshot.detail.clone()),
        }
        self.inner.background_jobs.mark_scheduled(
            APP_UPDATE_CHECK_JOB,
            "Next app update check is scheduled.",
            APP_UPDATE_CHECK_INTERVAL_SECONDS,
        );

        snapshot
    }
}
