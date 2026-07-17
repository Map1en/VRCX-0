use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, FixedOffset, NaiveDate, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Notify;
use vrcx_0_integrations::external_api::{self, ExternalApiScope};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::{config, DatabaseService};

use crate::background::sleep_until_due_or_stopped;
use crate::event_bus::RuntimeEventBus;
use crate::task_supervisor::TaskSupervisor;
use crate::updater_port::{
    UpdaterCheckRequest, UpdaterDownloadProgress, UpdaterMetadata, UpdaterPort,
    UpdaterProgressCallback,
};
use crate::web_client::WebClient;
use crate::{Error, Result, RuntimeBackgroundJobs};

const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/Map1en/VRCX-0/releases";
const APP_UPDATE_CHECK_JOB: &str = "appUpdateCheck";
const APP_UPDATE_CHECK_INTERVAL_SECONDS: u64 = 10_800;
const PREVIEW_LABELS: [&str; 2] = ["preview", "test"];
const TOKYO_UTC_OFFSET_SECONDS: i32 = 9 * 3600;
const MAX_MAJOR_VERSION: u32 = 99;
const MAX_MINOR_VERSION: u32 = 999;
const MAX_PATCH_VERSION: u32 = 999;
const CONFIG_AUTO_INSTALL_ON_STARTUP: &str = "autoInstallUpdatesOnStartup";
const CONFIG_AUTO_BACKGROUND_DOWNLOAD: &str = "autoBackgroundDownloadUpdates";

#[derive(Debug, Clone, Deserialize, Default)]
struct GitHubReleaseAsset {
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    browser_download_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct GitHubRelease {
    #[serde(default)]
    tag_name: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedReleaseVersion {
    major: u32,
    minor: u32,
    patch: u32,
    canonical_version: String,
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
    pub manifest_url: String,
    pub target: String,
    pub updater_type: String,
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
}

pub type AppUpdateTargetResolver = Arc<dyn Fn() -> Option<String> + Send + Sync>;

pub struct AppUpdateCheckContext<'a> {
    pub web: &'a WebClient,
    pub app_version: &'a str,
    pub build_label: &'a str,
    pub build_badge: &'a str,
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

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_numeric_component(component: &str, allow_zero: bool) -> Option<u32> {
    if component.is_empty() || !component.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if component.len() > 1 && component.starts_with('0') {
        return None;
    }
    let value: u32 = component.parse().ok()?;
    if !allow_zero && value == 0 {
        return None;
    }
    Some(value)
}

fn parse_release_version(version: &str) -> Option<ParsedReleaseVersion> {
    let trimmed = version.trim();
    let trimmed = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let mut parts = trimmed.split('.');
    let major_str = parts.next()?;
    let minor_str = parts.next()?;
    let patch_str = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let major = parse_numeric_component(major_str, false)?;
    let minor = parse_numeric_component(minor_str, true)?;
    let patch = parse_numeric_component(patch_str, true)?;
    if major > MAX_MAJOR_VERSION || minor > MAX_MINOR_VERSION || patch > MAX_PATCH_VERSION {
        return None;
    }
    Some(ParsedReleaseVersion {
        major,
        minor,
        patch,
        canonical_version: format!("{major}.{minor}.{patch}"),
    })
}

fn compare_release_versions(left: &str, right: &str) -> Ordering {
    match (parse_release_version(left), parse_release_version(right)) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some(left), Some(right)) => {
            (left.major, left.minor, left.patch).cmp(&(right.major, right.minor, right.patch))
        }
    }
}

fn is_release_newer_than_current(
    release: &AppUpdateReleaseSnapshot,
    current_version: &str,
) -> bool {
    compare_release_versions(&release.canonical_version, current_version) == Ordering::Greater
}

fn is_preview_build_label(build_label: &str) -> bool {
    PREVIEW_LABELS.contains(&build_label.trim().to_ascii_lowercase().as_str())
}

fn parse_preview_badge_timestamp_ms(build_badge: &str) -> Option<i64> {
    let badge = build_badge.trim();
    if !badge.is_ascii() {
        return None;
    }
    let prefix = badge.get(0..7)?;
    if !prefix.eq_ignore_ascii_case("preview") {
        return None;
    }
    let remainder = &badge[7..];
    let trimmed = remainder.trim_start();
    if trimmed.len() == remainder.len() || trimmed.len() != 13 {
        return None;
    }
    if trimmed.as_bytes()[8] != b'-' {
        return None;
    }
    let date_part = &trimmed[0..8];
    let time_part = &trimmed[9..13];
    if !date_part.bytes().all(|byte| byte.is_ascii_digit())
        || !time_part.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }

    let year: i32 = date_part[0..4].parse().ok()?;
    let month: u32 = date_part[4..6].parse().ok()?;
    let day: u32 = date_part[6..8].parse().ok()?;
    let hour: u32 = time_part[0..2].parse().ok()?;
    let minute: u32 = time_part[2..4].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }

    let tokyo_offset = FixedOffset::east_opt(TOKYO_UTC_OFFSET_SECONDS)?;
    let naive_date = NaiveDate::from_ymd_opt(year, month, day)?;
    let naive_datetime = naive_date.and_hms_opt(hour, minute, 0)?;
    let tokyo_datetime = tokyo_offset.from_local_datetime(&naive_datetime).single()?;
    Some(tokyo_datetime.timestamp_millis())
}

fn parse_preview_build_timestamp_ms(build_label: &str, build_badge: &str) -> Option<i64> {
    if !is_preview_build_label(build_label) {
        return None;
    }
    parse_preview_badge_timestamp_ms(build_badge)
}

fn is_stable_release_newer_than_preview_build(
    release: &AppUpdateReleaseSnapshot,
    preview_build_timestamp_ms: i64,
) -> bool {
    DateTime::parse_from_rfc3339(&release.published_at)
        .map(|published_at| published_at.timestamp_millis() > preview_build_timestamp_ms)
        .unwrap_or(false)
}

fn manifest_asset_name_for_target(target: &str) -> Option<&'static str> {
    if target.starts_with("windows-") {
        Some("latest_windows.json")
    } else if target.starts_with("linux-") || target.starts_with("macos-") {
        Some("latest_linux_and_macos.json")
    } else {
        None
    }
}

fn resolve_manifest_asset(assets: &[GitHubReleaseAsset], target: &str) -> Option<String> {
    let manifest_name = manifest_asset_name_for_target(target)?;
    assets
        .iter()
        .find(|asset| {
            asset.state.as_deref() == Some("uploaded")
                && asset.name.as_deref() == Some(manifest_name)
        })
        .and_then(|asset| asset.browser_download_url.clone())
        .filter(|url| !url.trim().is_empty())
}

fn normalize_release(
    release: &GitHubRelease,
    target: Option<&str>,
    require_installer_asset: bool,
) -> Option<AppUpdateReleaseSnapshot> {
    let tag_name = release.tag_name.clone().unwrap_or_default();
    let parsed = parse_release_version(&tag_name)?;
    let manifest = target.and_then(|target| {
        resolve_manifest_asset(&release.assets, target).map(|url| (url, target.to_string()))
    });
    if require_installer_asset && manifest.is_none() {
        return None;
    }
    let (manifest_url, resolved_target, updater_type) = match manifest {
        Some((url, target)) => (url, target, "tauri"),
        None => (String::new(), String::new(), "manual"),
    };
    let display_name = release
        .name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("VRCX-0 {}", parsed.canonical_version));

    Some(AppUpdateReleaseSnapshot {
        display_name,
        tag_name,
        html_url: release.html_url.clone().unwrap_or_default(),
        published_at: release.published_at.clone().unwrap_or_default(),
        body: release.body.clone().unwrap_or_default(),
        canonical_version: parsed.canonical_version.clone(),
        display_version: parsed.canonical_version,
        manifest_url,
        target: resolved_target,
        updater_type: updater_type.to_string(),
    })
}

fn version_sort_key(canonical_version: &str) -> (u32, u32, u32) {
    parse_release_version(canonical_version)
        .map(|parsed| (parsed.major, parsed.minor, parsed.patch))
        .unwrap_or_default()
}

async fn fetch_releases(web: &WebClient) -> Result<Vec<GitHubRelease>> {
    let mut headers = HashMap::new();
    headers.insert(
        "Accept".to_string(),
        "application/vnd.github+json".to_string(),
    );
    let input = external_api::github_releases_get_input(GITHUB_RELEASES_URL, headers);
    let response = web
        .execute_external_api(input, ExternalApiScope::UpdateRelease)
        .await?;
    if response.status != 200 {
        return Err(Error::Custom(format!(
            "GitHub release request failed ({}).",
            response.status
        )));
    }

    let value: Value = serde_json::from_str(&response.data)?;
    if let Some(message) = value.get("message").and_then(Value::as_str) {
        return Err(Error::Custom(message.to_string()));
    }
    let releases = match value {
        Value::Array(_) => serde_json::from_value::<Vec<GitHubRelease>>(value)?,
        other => vec![serde_json::from_value::<GitHubRelease>(other)?],
    };
    Ok(releases)
}

async fn fetch_latest_release(
    web: &WebClient,
    target: Option<&str>,
    require_installer_asset: bool,
) -> Result<Option<AppUpdateReleaseSnapshot>> {
    let releases = fetch_releases(web).await?;
    let mut normalized: Vec<AppUpdateReleaseSnapshot> = releases
        .iter()
        .filter(|release| !release.prerelease)
        .filter_map(|release| normalize_release(release, target, require_installer_asset))
        .collect();
    normalized.sort_by(|left, right| {
        version_sort_key(&right.canonical_version).cmp(&version_sort_key(&left.canonical_version))
    });
    Ok(normalized.into_iter().next())
}

async fn run_check_inner(context: &AppUpdateCheckContext<'_>) -> Result<CheckOutcome> {
    if let Some(preview_build_timestamp_ms) =
        parse_preview_build_timestamp_ms(context.build_label, context.build_badge)
    {
        let release = fetch_latest_release(context.web, context.target, false).await?;
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
        let release = fetch_latest_release(context.web, Some(target), true).await?;
        let Some(release) =
            release.filter(|release| is_release_newer_than_current(release, context.app_version))
        else {
            return Ok(no_update_outcome("No newer installable release was found."));
        };

        let manifest_check = context
            .port
            .check(UpdaterCheckRequest {
                manifest_url: release.manifest_url.clone(),
                target: target.to_string(),
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

    let release = fetch_latest_release(context.web, None, false).await?;
    Ok(
        match release.filter(|release| is_release_newer_than_current(release, context.app_version))
        {
            Some(release) => update_available_outcome(
                release,
                "A newer release is available; this platform does not support in-app installs.",
            ),
            None => no_update_outcome("No newer release was found."),
        },
    )
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DownloadPhase {
    Idle,
    Downloading,
    Downloaded,
    Installing,
    Error,
}

impl DownloadPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Downloading => "downloading",
            Self::Downloaded => "downloaded",
            Self::Installing => "installing",
            Self::Error => "error",
        }
    }
}

struct PendingDownload {
    version: String,
    metadata: UpdaterMetadata,
    handle: crate::updater_port::UpdaterInstallHandle,
}

struct DownloadState {
    phase: DownloadPhase,
    version: Option<String>,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: u32,
    error: Option<String>,
    pending: Option<PendingDownload>,
    queued: Option<AppUpdateReleaseSnapshot>,
}

impl DownloadState {
    fn idle() -> Self {
        Self {
            phase: DownloadPhase::Idle,
            version: None,
            downloaded_bytes: 0,
            total_bytes: 0,
            percent: 0,
            error: None,
            pending: None,
            queued: None,
        }
    }

    fn snapshot(&self) -> AppUpdateDownloadStatusSnapshot {
        AppUpdateDownloadStatusSnapshot {
            phase: self.phase.as_str().into(),
            version: self.version.clone(),
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
    pub phase: String,
    pub version: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u32,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateDownloadProgressPayload {
    pub version: String,
    pub phase: String,
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
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
    storage: Arc<StorageService>,
    event_bus: RuntimeEventBus,
    background_jobs: RuntimeBackgroundJobs,
    build: AppUpdateBuildInfo,
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

#[derive(Clone)]
pub struct AppUpdateRuntime {
    inner: Arc<AppUpdateRuntimeInner>,
}

impl AppUpdateRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        web: Arc<WebClient>,
        db: Arc<DatabaseService>,
        storage: Arc<StorageService>,
        event_bus: RuntimeEventBus,
        background_jobs: RuntimeBackgroundJobs,
        build: AppUpdateBuildInfo,
        target_resolver: AppUpdateTargetResolver,
        port: Arc<dyn UpdaterPort>,
        tasks: TaskSupervisor,
    ) -> Self {
        Self {
            inner: Arc::new(AppUpdateRuntimeInner {
                web,
                db,
                storage,
                event_bus,
                background_jobs,
                build,
                target_resolver,
                port,
                tasks,
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

    pub fn discard_pending(&self) {
        self.with_download_state(|state| *state = DownloadState::idle());
        self.inner.download_notify.notify_waiters();
    }

    pub async fn set_auto_background_download_preference(&self, enabled: bool) {
        if !enabled {
            self.discard_pending();
            return;
        }

        let snapshot = self.snapshot();
        if !snapshot.has_available_update {
            return;
        }
        let Some(release) = snapshot.release else {
            return;
        };
        if release.updater_type != "tauri" {
            return;
        }

        let runtime = self.clone();
        self.inner.tasks.spawn(async move {
            if let Err(error) = runtime.ensure_downloaded(&release).await {
                tracing::warn!(
                    error = %error,
                    "background download preference change download failed"
                );
            }
        });
    }

    pub async fn install(&self, version: &str) -> Result<UpdaterMetadata> {
        enum Action {
            UsePending(PendingDownload),
            Wait,
            NeedDownload,
        }

        loop {
            let notified = self.inner.download_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let action = self.with_download_state(|state| {
                if let Some(pending) = &state.pending {
                    if pending.version == version && state.phase == DownloadPhase::Downloaded {
                        state.phase = DownloadPhase::Installing;
                        return Action::UsePending(state.pending.take().expect("pending checked"));
                    }
                }
                if state.phase == DownloadPhase::Downloading
                    && state.version.as_deref() == Some(version)
                {
                    return Action::Wait;
                }
                Action::NeedDownload
            });

            match action {
                Action::UsePending(pending) => return self.finish_install(pending).await,
                Action::Wait => {
                    notified.await;
                }
                Action::NeedDownload => {
                    let release = self.release_for_version(version)?;
                    let status = self.ensure_downloaded(&release).await?;
                    if status.phase != DownloadPhase::Downloaded.as_str() {
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
                if release.canonical_version == version && release.updater_type == "tauri" =>
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
                    DownloadPhase::Downloading
                        if state.version.as_deref() == Some(version.as_str()) =>
                    {
                        StartAction::Wait
                    }
                    DownloadPhase::Downloading => {
                        state.queued = Some(release.clone());
                        StartAction::Early(state.snapshot())
                    }
                    _ => {
                        *state = DownloadState {
                            phase: DownloadPhase::Downloading,
                            version: Some(version.clone()),
                            downloaded_bytes: 0,
                            total_bytes: 0,
                            percent: 0,
                            error: None,
                            pending: None,
                            queued: None,
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

        let proxy = crate::proxy::load_proxy_url(&self.inner.storage);
        let request = UpdaterCheckRequest {
            manifest_url: release.manifest_url.clone(),
            target: release.target.clone(),
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
            state.phase == DownloadPhase::Downloading
                && state.version.as_deref() == Some(version.as_str())
        };
        let (snapshot, applied, error) = match download_result {
            Ok(outcome) => self.with_download_state(|state| {
                if !owns_download(state) {
                    return (state.snapshot(), false, None);
                }
                state.phase = DownloadPhase::Downloaded;
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
                state.phase = DownloadPhase::Error;
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
        let result = self.inner.port.install(handle).await;
        match result {
            Ok(()) => {
                self.with_download_state(|state| *state = DownloadState::idle());
                self.inner.download_notify.notify_waiters();
                self.inner.event_bus.emit(
                    "appUpdateInstalled",
                    AppUpdateInstalledPayload {
                        version,
                        metadata: metadata.clone(),
                    },
                );
                Ok(metadata)
            }
            Err(error) => {
                let snapshot = self.with_download_state(|state| {
                    state.version = Some(version.clone());
                    state.phase = DownloadPhase::Error;
                    state.error = Some(error.to_string());
                    state.snapshot()
                });
                self.inner.download_notify.notify_waiters();
                self.emit_download_progress_snapshot(&snapshot);
                Err(error)
            }
        }
    }

    fn apply_download_progress(&self, version: &str, event: UpdaterDownloadProgress) {
        let snapshot = self.with_download_state(|state| {
            if state.version.as_deref() != Some(version) {
                return None;
            }
            match event {
                UpdaterDownloadProgress::Started { content_length } => {
                    state.total_bytes = content_length.unwrap_or(0);
                    state.downloaded_bytes = 0;
                    state.percent = 0;
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
                }
                UpdaterDownloadProgress::Finished => {
                    state.percent = 100;
                }
            }
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
        self.inner.event_bus.emit(
            "appUpdateDownloadProgress",
            AppUpdateDownloadProgressPayload {
                version,
                phase: snapshot.phase.clone(),
                downloaded_bytes: snapshot.downloaded_bytes,
                total_bytes: snapshot.total_bytes,
                percent: snapshot.percent,
            },
        );
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
        if release.updater_type != "tauri" {
            return None;
        }
        let auto_install =
            config::get_bool(&self.inner.db, CONFIG_AUTO_INSTALL_ON_STARTUP, true).unwrap_or(true);
        if !auto_install {
            return None;
        }

        match self.ensure_downloaded(release).await {
            Ok(status) if status.phase == DownloadPhase::Downloaded.as_str() => {
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
        if release.updater_type != "tauri" {
            return;
        }
        let enabled = config::get_bool(&self.inner.db, CONFIG_AUTO_BACKGROUND_DOWNLOAD, false)
            .unwrap_or(false);
        if !enabled {
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
                "unavailable",
                "App update checks need a host task executor.",
            );
            return;
        }

        self.inner.background_jobs.register_job(
            APP_UPDATE_CHECK_JOB,
            "rust",
            Some(APP_UPDATE_CHECK_INTERVAL_SECONDS),
            "scheduled",
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
        self.inner
            .background_jobs
            .mark_running(APP_UPDATE_CHECK_JOB, "Checking for VRCX-0 updates.");

        let target = (self.inner.target_resolver)();
        let proxy = crate::proxy::load_proxy_url(&self.inner.storage);
        let context = AppUpdateCheckContext {
            web: &self.inner.web,
            app_version: &self.inner.build.app_version,
            build_label: &self.inner.build.build_label,
            build_badge: &self.inner.build.build_badge,
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
        self.inner
            .event_bus
            .emit("appUpdateStatus", snapshot.clone());

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

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str, state: &str, url: &str) -> GitHubReleaseAsset {
        GitHubReleaseAsset {
            state: Some(state.into()),
            name: Some(name.into()),
            browser_download_url: Some(url.into()),
        }
    }

    fn release(tag_name: &str, prerelease: bool, assets: Vec<GitHubReleaseAsset>) -> GitHubRelease {
        GitHubRelease {
            tag_name: Some(tag_name.into()),
            assets,
            html_url: Some("https://github.com/Map1en/VRCX-0/releases/tag/v1.2.3".into()),
            name: None,
            prerelease,
            published_at: Some("2026-07-16T12:00:00Z".into()),
            body: Some("Release notes.".into()),
        }
    }

    #[test]
    fn parses_valid_release_versions() {
        let parsed = parse_release_version("v1.2.3").expect("valid version parses");
        assert_eq!((parsed.major, parsed.minor, parsed.patch), (1, 2, 3));
        assert_eq!(parsed.canonical_version, "1.2.3");

        let parsed = parse_release_version("2.0.0").expect("valid version parses");
        assert_eq!((parsed.major, parsed.minor, parsed.patch), (2, 0, 0));
    }

    #[test]
    fn rejects_invalid_release_versions() {
        assert!(parse_release_version("").is_none());
        assert!(parse_release_version("1.2").is_none());
        assert!(parse_release_version("1.2.3.4").is_none());
        assert!(parse_release_version("01.2.3").is_none());
        assert!(parse_release_version("1.02.3").is_none());
        assert!(parse_release_version("0.1.0").is_none());
        assert!(parse_release_version("abc").is_none());
    }

    #[test]
    fn compares_release_versions_numerically() {
        assert_eq!(compare_release_versions("1.2.3", "1.2.3"), Ordering::Equal);
        assert_eq!(
            compare_release_versions("1.10.0", "1.9.0"),
            Ordering::Greater
        );
        assert_eq!(compare_release_versions("1.2.3", "1.2.4"), Ordering::Less);
        assert_eq!(compare_release_versions("bad", "1.0.0"), Ordering::Less);
        assert_eq!(compare_release_versions("1.0.0", "bad"), Ordering::Greater);
    }

    #[test]
    fn detects_preview_build_labels_case_insensitively() {
        assert!(is_preview_build_label("preview"));
        assert!(is_preview_build_label("Preview"));
        assert!(is_preview_build_label("test"));
        assert!(!is_preview_build_label("stable"));
        assert!(!is_preview_build_label("devkit"));
        assert!(!is_preview_build_label(""));
    }

    #[test]
    fn parses_preview_badge_timestamp_from_tokyo_local_time() {
        let timestamp_ms = parse_preview_badge_timestamp_ms("Preview 20260716-1230")
            .expect("valid preview badge parses");
        let expected = FixedOffset::east_opt(TOKYO_UTC_OFFSET_SECONDS)
            .unwrap()
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(2026, 7, 16)
                    .unwrap()
                    .and_hms_opt(12, 30, 0)
                    .unwrap(),
            )
            .single()
            .unwrap()
            .timestamp_millis();
        assert_eq!(timestamp_ms, expected);
    }

    #[test]
    fn rejects_malformed_preview_badges() {
        assert!(parse_preview_badge_timestamp_ms("Preview20260716-1230").is_none());
        assert!(parse_preview_badge_timestamp_ms("Preview 2026071-1230").is_none());
        assert!(parse_preview_badge_timestamp_ms("Preview 20261316-1230").is_none());
        assert!(parse_preview_badge_timestamp_ms("Preview 20260732-1230").is_none());
        assert!(parse_preview_badge_timestamp_ms("Preview 20260716-2460").is_none());
        assert!(parse_preview_badge_timestamp_ms("Stable 20260716-1230").is_none());
        assert!(parse_preview_badge_timestamp_ms("").is_none());
    }

    #[test]
    fn parse_preview_build_timestamp_requires_preview_label() {
        assert!(parse_preview_build_timestamp_ms("stable", "Preview 20260716-1230").is_none());
        assert!(parse_preview_build_timestamp_ms("preview", "Preview 20260716-1230").is_some());
    }

    #[test]
    fn normalize_release_requires_matching_installer_asset_when_required() {
        let release = release(
            "v1.2.3",
            false,
            vec![asset(
                "latest_windows.json",
                "uploaded",
                "https://github.com/Map1en/VRCX-0/releases/download/v1.2.3/latest_windows.json",
            )],
        );

        let normalized = normalize_release(&release, Some("windows-x86_64-stable"), true)
            .expect("release with matching asset normalizes");
        assert_eq!(normalized.updater_type, "tauri");
        assert_eq!(normalized.target, "windows-x86_64-stable");
        assert!(!normalized.manifest_url.is_empty());

        assert!(normalize_release(&release, Some("macos-aarch64-stable"), true).is_none());
        let notify_only = normalize_release(&release, Some("macos-aarch64-stable"), false)
            .expect("notify-only normalize succeeds without a matching asset");
        assert_eq!(notify_only.updater_type, "manual");
        assert!(notify_only.manifest_url.is_empty());
    }

    #[test]
    fn normalize_release_rejects_unparseable_tag_names() {
        let release = release("not-a-version", false, Vec::new());
        assert!(normalize_release(&release, None, false).is_none());
    }

    #[test]
    fn is_release_newer_than_current_compares_canonical_versions() {
        let newer = normalize_release(&release("v2.0.0", false, Vec::new()), None, false).unwrap();
        assert!(is_release_newer_than_current(&newer, "1.9.9"));
        assert!(!is_release_newer_than_current(&newer, "2.0.0"));
        assert!(!is_release_newer_than_current(&newer, "2.0.1"));
    }
}
