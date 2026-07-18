use std::cmp::Ordering;

use chrono::{FixedOffset, NaiveDate, TimeZone};

use super::release::{
    compare_release_versions, is_preview_build_label, is_release_newer_than_current,
    normalize_release, parse_preview_badge_timestamp_ms, parse_preview_build_timestamp_ms,
    parse_release_version, GitHubRelease, GitHubReleaseAsset, TOKYO_UTC_OFFSET_SECONDS,
};

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
