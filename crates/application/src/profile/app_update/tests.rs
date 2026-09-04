use std::cmp::Ordering;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{FixedOffset, NaiveDate, TimeZone};
use vrcx_0_application_core::{
    Error, RuntimeBackgroundJobs, RuntimeEventBus, TaskSupervisor, UpdaterCheckRequest,
    UpdaterDownloadOutcome, UpdaterDownloadProgress, UpdaterInstallHandle, UpdaterMetadata,
    UpdaterPort, UpdaterProgressCallback,
};

use super::release::{
    compare_release_versions, is_preview_build_label, is_release_newer_than_current,
    normalize_release, parse_preview_badge_timestamp_ms, parse_preview_build_timestamp_ms,
    parse_release_version, TOKYO_UTC_OFFSET_SECONDS,
};
use super::{
    run_check_inner, up_to_date_outcome, AppUpdateBuildInfo, AppUpdateCatalogAsset,
    AppUpdateCatalogRelease, AppUpdateChannel, AppUpdateCheckContext, AppUpdateDeliveryKind,
    AppUpdateDownloadPhase, AppUpdateReleaseCatalogFuture, AppUpdateReleaseCatalogPort,
    AppUpdateReleaseSnapshot, AppUpdateRuntime, AppUpdateRuntimeDeps, AppUpdateStatusSnapshot,
    DownloadState,
};
use crate::profile::test_support::MemoryProfileConfigStore;

const TEST_UPDATE_VERSION: &str = "2.15.0";

#[derive(Clone, Copy)]
enum InstallOutcome {
    Success,
    ArtifactInvalid,
    OtherError,
}

struct MockUpdaterPort {
    check_count: AtomicUsize,
    download_count: AtomicUsize,
    install_count: AtomicUsize,
    install_outcomes: Mutex<VecDeque<InstallOutcome>>,
}

impl MockUpdaterPort {
    fn new(install_outcomes: impl IntoIterator<Item = InstallOutcome>) -> Self {
        Self {
            check_count: AtomicUsize::new(0),
            download_count: AtomicUsize::new(0),
            install_count: AtomicUsize::new(0),
            install_outcomes: Mutex::new(install_outcomes.into_iter().collect()),
        }
    }
}

#[async_trait]
impl UpdaterPort for MockUpdaterPort {
    async fn check(
        &self,
        _request: UpdaterCheckRequest,
    ) -> vrcx_0_application_core::Result<Option<UpdaterMetadata>> {
        self.check_count.fetch_add(1, AtomicOrdering::Relaxed);
        Ok(None)
    }

    async fn download(
        &self,
        _request: UpdaterCheckRequest,
        on_progress: UpdaterProgressCallback,
    ) -> vrcx_0_application_core::Result<UpdaterDownloadOutcome> {
        self.download_count.fetch_add(1, AtomicOrdering::Relaxed);
        on_progress(UpdaterDownloadProgress::Started {
            content_length: Some(10),
        });
        on_progress(UpdaterDownloadProgress::Progress { chunk_length: 10 });
        on_progress(UpdaterDownloadProgress::Finished);
        Ok(UpdaterDownloadOutcome {
            metadata: updater_metadata(),
            handle: UpdaterInstallHandle(Box::new(())),
        })
    }

    async fn install(&self, _handle: UpdaterInstallHandle) -> vrcx_0_application_core::Result<()> {
        self.install_count.fetch_add(1, AtomicOrdering::Relaxed);
        match self
            .install_outcomes
            .lock()
            .expect("lock install outcomes")
            .pop_front()
            .unwrap_or(InstallOutcome::Success)
        {
            InstallOutcome::Success => Ok(()),
            InstallOutcome::ArtifactInvalid => Err(Error::UpdateArtifactInvalid(
                "checksum mismatch in test artifact".into(),
            )),
            InstallOutcome::OtherError => Err(Error::Custom("installer failed".into())),
        }
    }
}

struct AppUpdateTestContext {
    runtime: AppUpdateRuntime,
    port: Arc<MockUpdaterPort>,
    event_bus: RuntimeEventBus,
}

#[derive(Default)]
struct TestAppUpdateReleaseCatalog {
    releases: Vec<AppUpdateCatalogRelease>,
}

impl AppUpdateReleaseCatalogPort for TestAppUpdateReleaseCatalog {
    fn list_releases(&self) -> AppUpdateReleaseCatalogFuture<'_> {
        let releases = self.releases.clone();
        Box::pin(async move { Ok(releases) })
    }
}

fn updater_metadata() -> UpdaterMetadata {
    UpdaterMetadata {
        current_version: "2.14.0".into(),
        version: TEST_UPDATE_VERSION.into(),
        date: None,
        body: None,
    }
}

fn update_release_snapshot() -> AppUpdateReleaseSnapshot {
    AppUpdateReleaseSnapshot {
        display_name: "VRCX-0 2.15.0".into(),
        tag_name: "v2.15.0".into(),
        html_url: "https://example.test/releases/v2.15.0".into(),
        published_at: "2026-07-18T00:00:00Z".into(),
        body: String::new(),
        canonical_version: TEST_UPDATE_VERSION.into(),
        display_version: TEST_UPDATE_VERSION.into(),
        channel: AppUpdateChannel::Stable,
        manifest_url: "https://example.test/latest.json".into(),
        target: "windows-x86_64-stable".into(),
        updater_type: AppUpdateDeliveryKind::Tauri,
    }
}

#[test]
fn up_to_date_outcome_keeps_the_checked_release() {
    let outcome = up_to_date_outcome(update_release_snapshot(), "No newer release was found.");

    assert!(!outcome.has_available_update);
    assert_eq!(
        outcome
            .release
            .expect("checked release remains available")
            .canonical_version,
        TEST_UPDATE_VERSION
    );
}

fn app_update_test_context(
    install_outcomes: impl IntoIterator<Item = InstallOutcome>,
) -> AppUpdateTestContext {
    app_update_test_context_with_update_check(install_outcomes, false)
}

fn app_update_test_context_with_update_check(
    install_outcomes: impl IntoIterator<Item = InstallOutcome>,
    update_check_disabled: bool,
) -> AppUpdateTestContext {
    let config = Arc::new(MemoryProfileConfigStore::default());
    let event_bus = RuntimeEventBus::new();
    let port = Arc::new(MockUpdaterPort::new(install_outcomes));
    let updater_port: Arc<dyn UpdaterPort> = port.clone();
    let runtime = AppUpdateRuntime::new(AppUpdateRuntimeDeps {
        release_catalog: Arc::new(TestAppUpdateReleaseCatalog::default()),
        config,
        event_bus: event_bus.clone(),
        background_jobs: RuntimeBackgroundJobs::new(),
        build: AppUpdateBuildInfo {
            app_version: "2.14.0".into(),
            build_label: "stable".into(),
            build_badge: String::new(),
            update_check_disabled,
        },
        target_resolver: Arc::new(|| Some("windows-x86_64-stable".into())),
        port: updater_port,
        tasks: TaskSupervisor::new(),
    });
    if !update_check_disabled {
        *runtime.inner.status.lock().expect("lock update status") = AppUpdateStatusSnapshot {
            has_available_update: true,
            checked_at: "2026-07-18T00:00:00.000Z".into(),
            detail: "Update available.".into(),
            error: None,
            release: Some(update_release_snapshot()),
            should_notify: true,
        };
    }

    AppUpdateTestContext {
        runtime,
        port,
        event_bus,
    }
}

#[tokio::test]
async fn update_check_uses_semantic_release_catalog_without_a_web_client() {
    let release_catalog = TestAppUpdateReleaseCatalog {
        releases: vec![release("v2.15.0", false, Vec::new())],
    };
    let updater: Arc<dyn UpdaterPort> = Arc::new(MockUpdaterPort::new([]));
    let context = AppUpdateCheckContext {
        release_catalog: &release_catalog,
        app_version: "2.14.0",
        build_label: "stable",
        build_badge: "",
        channel: AppUpdateChannel::Stable,
        target: None,
        port: &updater,
        proxy: None,
    };

    let outcome = run_check_inner(&context).await.unwrap();

    assert!(outcome.has_available_update);
    assert_eq!(
        outcome.release.unwrap().canonical_version,
        TEST_UPDATE_VERSION
    );
}

#[tokio::test]
async fn beta_update_check_ignores_stable_releases() {
    let release_catalog = TestAppUpdateReleaseCatalog {
        releases: vec![
            release("v2.16.0", false, Vec::new()),
            release("v2.15.0-beta.2", true, Vec::new()),
        ],
    };
    let updater: Arc<dyn UpdaterPort> = Arc::new(MockUpdaterPort::new([]));
    let context = AppUpdateCheckContext {
        release_catalog: &release_catalog,
        app_version: "2.15.0-beta.1",
        build_label: "stable",
        build_badge: "",
        channel: AppUpdateChannel::Beta,
        target: None,
        port: &updater,
        proxy: None,
    };

    let outcome = run_check_inner(&context).await.unwrap();

    assert!(outcome.has_available_update);
    assert_eq!(outcome.release.unwrap().canonical_version, "2.15.0-beta.2");
}

#[tokio::test]
async fn stable_update_check_ignores_beta_releases() {
    let release_catalog = TestAppUpdateReleaseCatalog {
        releases: vec![
            release("v3.0.0-beta.1", true, Vec::new()),
            release("v2.15.0", false, Vec::new()),
        ],
    };
    let updater: Arc<dyn UpdaterPort> = Arc::new(MockUpdaterPort::new([]));
    let context = AppUpdateCheckContext {
        release_catalog: &release_catalog,
        app_version: "2.14.0",
        build_label: "stable",
        build_badge: "",
        channel: AppUpdateChannel::Stable,
        target: None,
        port: &updater,
        proxy: None,
    };

    let outcome = run_check_inner(&context).await.unwrap();

    assert_eq!(
        outcome.release.unwrap().canonical_version,
        TEST_UPDATE_VERSION
    );
}

#[tokio::test]
async fn disabled_build_skips_update_check() {
    let context = app_update_test_context_with_update_check([], true);

    let snapshot = context.runtime.check_now().await;

    assert!(!snapshot.has_available_update);
    assert_eq!(context.port.check_count.load(AtomicOrdering::Relaxed), 0);
    assert_eq!(context.port.download_count.load(AtomicOrdering::Relaxed), 0);
}

fn error_progress_event_count(event_bus: &RuntimeEventBus) -> usize {
    event_bus
        .take_events_for_test()
        .into_iter()
        .filter(|event| {
            event.name == "appUpdateDownloadProgress"
                && event
                    .payload
                    .get("phase")
                    .and_then(serde_json::Value::as_str)
                    == Some("error")
        })
        .count()
}

#[test]
fn download_progress_coalesces_chunk_bursts_and_keeps_boundaries() {
    let context = app_update_test_context([]);
    context.runtime.with_download_state(|state| {
        *state = DownloadState {
            phase: AppUpdateDownloadPhase::Downloading,
            version: Some(TEST_UPDATE_VERSION.into()),
            started_at: Some("2026-07-18T00:00:00.000Z".into()),
            downloaded_bytes: 0,
            total_bytes: 0,
            percent: 0,
            error: None,
            pending: None,
            queued: None,
            last_progress_emitted_at: None,
        };
    });
    let started_at = Instant::now();

    context.runtime.apply_download_progress_at(
        TEST_UPDATE_VERSION,
        UpdaterDownloadProgress::Started {
            content_length: Some(101),
        },
        started_at,
    );
    for _ in 0..100 {
        context.runtime.apply_download_progress_at(
            TEST_UPDATE_VERSION,
            UpdaterDownloadProgress::Progress { chunk_length: 1 },
            started_at + Duration::from_millis(1),
        );
    }
    context.runtime.apply_download_progress_at(
        TEST_UPDATE_VERSION,
        UpdaterDownloadProgress::Progress { chunk_length: 1 },
        started_at + super::APP_UPDATE_PROGRESS_EMIT_INTERVAL,
    );
    context.runtime.apply_download_progress_at(
        TEST_UPDATE_VERSION,
        UpdaterDownloadProgress::Finished,
        started_at + super::APP_UPDATE_PROGRESS_EMIT_INTERVAL,
    );

    let progress_events = context
        .event_bus
        .take_events_for_test()
        .into_iter()
        .filter(|event| event.name == "appUpdateDownloadProgress")
        .collect::<Vec<_>>();
    assert_eq!(progress_events.len(), 3);
    assert_eq!(context.runtime.download_status().downloaded_bytes, 101);
    assert_eq!(context.runtime.download_status().percent, 100);
}

fn asset(name: &str, state: &str, url: &str) -> AppUpdateCatalogAsset {
    AppUpdateCatalogAsset {
        state: Some(state.into()),
        name: Some(name.into()),
        browser_download_url: Some(url.into()),
    }
}

fn release(
    tag_name: &str,
    prerelease: bool,
    assets: Vec<AppUpdateCatalogAsset>,
) -> AppUpdateCatalogRelease {
    AppUpdateCatalogRelease {
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
    assert_eq!(parsed.canonical_version, "1.2.3");
    assert_eq!(parsed.channel, AppUpdateChannel::Stable);

    let parsed = parse_release_version("2.0.0").expect("valid version parses");
    assert_eq!(parsed.canonical_version, "2.0.0");

    let parsed = parse_release_version("v2.1.0-beta.12").expect("valid beta parses");
    assert_eq!(parsed.channel, AppUpdateChannel::Beta);
    assert_eq!(parsed.canonical_version, "2.1.0-beta.12");
}

#[test]
fn rejects_invalid_release_versions() {
    assert!(parse_release_version("").is_none());
    assert!(parse_release_version("1.2").is_none());
    assert!(parse_release_version("1.2.3.4").is_none());
    assert!(parse_release_version("01.2.3").is_none());
    assert!(parse_release_version("1.02.3").is_none());
    assert!(parse_release_version("0.1.0").is_none());
    assert!(parse_release_version("1.2.3-beta.0").is_none());
    assert!(parse_release_version("1.2.3-beta.1000000").is_none());
    assert!(parse_release_version("1.2.3-alpha.1").is_none());
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
    assert_eq!(
        compare_release_versions("1.2.3-beta.10", "1.2.3-beta.2"),
        Ordering::Greater
    );
    assert_eq!(
        compare_release_versions("1.2.3", "1.2.3-beta.10"),
        Ordering::Greater
    );
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
    assert_eq!(normalized.updater_type, AppUpdateDeliveryKind::Tauri);
    assert_eq!(normalized.target, "windows-x86_64-stable");
    assert!(!normalized.manifest_url.is_empty());

    assert!(normalize_release(&release, Some("macos-aarch64-stable"), true).is_none());
    let notify_only = normalize_release(&release, Some("macos-aarch64-stable"), false)
        .expect("notify-only normalize succeeds without a matching asset");
    assert_eq!(notify_only.updater_type, AppUpdateDeliveryKind::Manual);
    assert!(notify_only.manifest_url.is_empty());
}

#[test]
fn normalize_release_rejects_unparseable_tag_names() {
    let release = release("not-a-version", false, Vec::new());
    assert!(normalize_release(&release, None, false).is_none());
}

#[test]
fn normalize_release_requires_github_prerelease_state_to_match_the_channel() {
    assert!(normalize_release(&release("v1.2.3-beta.1", false, Vec::new()), None, false).is_none());
    assert!(normalize_release(&release("v1.2.3", true, Vec::new()), None, false).is_none());

    let beta = normalize_release(&release("v1.2.3-beta.1", true, Vec::new()), None, false)
        .expect("matching beta release normalizes");
    assert_eq!(beta.channel, AppUpdateChannel::Beta);
}

#[test]
fn is_release_newer_than_current_compares_canonical_versions() {
    let newer = normalize_release(&release("v2.0.0", false, Vec::new()), None, false).unwrap();
    assert!(is_release_newer_than_current(&newer, "1.9.9"));
    assert!(!is_release_newer_than_current(&newer, "2.0.0"));
    assert!(!is_release_newer_than_current(&newer, "2.0.1"));
}

#[tokio::test]
async fn install_redownloads_once_after_an_invalid_artifact_without_flashing_error() {
    let context =
        app_update_test_context([InstallOutcome::ArtifactInvalid, InstallOutcome::Success]);

    let metadata = context
        .runtime
        .install(TEST_UPDATE_VERSION)
        .await
        .expect("second artifact installs");

    assert_eq!(metadata.version, TEST_UPDATE_VERSION);
    assert_eq!(context.port.download_count.load(AtomicOrdering::Relaxed), 2);
    assert_eq!(context.port.install_count.load(AtomicOrdering::Relaxed), 2);
    assert_eq!(error_progress_event_count(&context.event_bus), 0);
}

#[tokio::test]
async fn install_reports_an_error_when_the_retried_artifact_is_still_invalid() {
    let context = app_update_test_context([
        InstallOutcome::ArtifactInvalid,
        InstallOutcome::ArtifactInvalid,
    ]);

    assert!(matches!(
        context.runtime.install(TEST_UPDATE_VERSION).await,
        Err(Error::UpdateArtifactInvalid(_))
    ));
    assert_eq!(context.port.download_count.load(AtomicOrdering::Relaxed), 2);
    assert_eq!(context.port.install_count.load(AtomicOrdering::Relaxed), 2);
    assert_eq!(error_progress_event_count(&context.event_bus), 1);
}

#[tokio::test]
async fn install_does_not_redownload_after_an_installer_error() {
    let context = app_update_test_context([InstallOutcome::OtherError]);

    assert!(matches!(
        context.runtime.install(TEST_UPDATE_VERSION).await,
        Err(Error::Custom(message)) if message == "installer failed"
    ));
    assert_eq!(context.port.download_count.load(AtomicOrdering::Relaxed), 1);
    assert_eq!(context.port.install_count.load(AtomicOrdering::Relaxed), 1);
    assert_eq!(error_progress_event_count(&context.event_bus), 1);
}

#[tokio::test]
async fn background_download_is_forced_without_a_saved_preference() {
    let context = app_update_test_context([]);

    context
        .runtime
        .maybe_auto_background_download(&context.runtime.snapshot());

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if context.runtime.download_status().phase == AppUpdateDownloadPhase::Downloaded {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("forced background download starts");
}

#[tokio::test]
async fn background_download_does_not_replace_an_installing_flight() {
    let context = app_update_test_context([]);
    context.runtime.with_download_state(|state| {
        *state = DownloadState {
            phase: AppUpdateDownloadPhase::Installing,
            version: Some(TEST_UPDATE_VERSION.into()),
            started_at: Some("2026-07-18T00:00:00.000Z".into()),
            downloaded_bytes: 10,
            total_bytes: 10,
            percent: 100,
            error: None,
            pending: None,
            queued: None,
            last_progress_emitted_at: None,
        };
    });

    let status = context
        .runtime
        .ensure_downloaded(&update_release_snapshot())
        .await
        .expect("installing snapshot is returned");

    assert_eq!(status.phase, AppUpdateDownloadPhase::Installing);
    assert_eq!(context.port.download_count.load(AtomicOrdering::Relaxed), 0);
}
