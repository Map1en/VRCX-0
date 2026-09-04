use std::cmp::Ordering;

use chrono::{DateTime, FixedOffset, NaiveDate, TimeZone};
use semver::Version;

use super::{
    AppUpdateCatalogAsset, AppUpdateCatalogRelease, AppUpdateChannel, AppUpdateDeliveryKind,
    AppUpdateReleaseSnapshot,
};

const PREVIEW_LABELS: [&str; 2] = ["preview", "test"];
pub(super) const TOKYO_UTC_OFFSET_SECONDS: i32 = 9 * 3600;
const MAX_MAJOR_VERSION: u32 = 99;
const MAX_MINOR_VERSION: u32 = 999;
const MAX_PATCH_VERSION: u32 = 999;
const MAX_BETA_VERSION: u64 = 999_999;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ParsedReleaseVersion {
    pub(super) channel: AppUpdateChannel,
    pub(super) canonical_version: String,
    version: Version,
}

fn has_supported_beta_prerelease(version: &Version) -> bool {
    let mut identifiers = version.pre.as_str().split('.');
    if identifiers.next() != Some("beta") {
        return false;
    }
    let Some(number) = identifiers.next().and_then(|value| value.parse().ok()) else {
        return false;
    };
    if identifiers.next().is_some() {
        return false;
    }
    (1..=MAX_BETA_VERSION).contains(&number)
}

pub(super) fn parse_release_version(version: &str) -> Option<ParsedReleaseVersion> {
    let trimmed = version.trim();
    let trimmed = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let version = Version::parse(trimmed).ok()?;
    if version.major == 0
        || version.major > u64::from(MAX_MAJOR_VERSION)
        || version.minor > u64::from(MAX_MINOR_VERSION)
        || version.patch > u64::from(MAX_PATCH_VERSION)
        || !version.build.is_empty()
    {
        return None;
    }
    let channel = if version.pre.is_empty() {
        AppUpdateChannel::Stable
    } else if has_supported_beta_prerelease(&version) {
        AppUpdateChannel::Beta
    } else {
        return None;
    };
    Some(ParsedReleaseVersion {
        channel,
        canonical_version: version.to_string(),
        version,
    })
}

pub(super) fn release_channel_for_version(version: &str) -> Option<AppUpdateChannel> {
    parse_release_version(version).map(|parsed| parsed.channel)
}

pub(super) fn compare_release_versions(left: &str, right: &str) -> Ordering {
    match (parse_release_version(left), parse_release_version(right)) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some(left), Some(right)) => left.version.cmp(&right.version),
    }
}

pub(super) fn is_release_newer_than_current(
    release: &AppUpdateReleaseSnapshot,
    current_version: &str,
) -> bool {
    compare_release_versions(&release.canonical_version, current_version) == Ordering::Greater
}

pub(super) fn is_preview_build_label(build_label: &str) -> bool {
    PREVIEW_LABELS.contains(&build_label.trim().to_ascii_lowercase().as_str())
}

pub(super) fn parse_preview_badge_timestamp_ms(build_badge: &str) -> Option<i64> {
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

pub(super) fn parse_preview_build_timestamp_ms(
    build_label: &str,
    build_badge: &str,
) -> Option<i64> {
    if !is_preview_build_label(build_label) {
        return None;
    }
    parse_preview_badge_timestamp_ms(build_badge)
}

pub(super) fn is_stable_release_newer_than_preview_build(
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

fn resolve_manifest_asset(assets: &[AppUpdateCatalogAsset], target: &str) -> Option<String> {
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

pub(super) fn normalize_release(
    release: &AppUpdateCatalogRelease,
    target: Option<&str>,
    require_installer_asset: bool,
) -> Option<AppUpdateReleaseSnapshot> {
    let tag_name = release.tag_name.clone().unwrap_or_default();
    let parsed = parse_release_version(&tag_name)?;
    if release.prerelease != (parsed.channel == AppUpdateChannel::Beta) {
        return None;
    }
    let manifest = target.and_then(|target| {
        resolve_manifest_asset(&release.assets, target).map(|url| (url, target.to_string()))
    });
    if require_installer_asset && manifest.is_none() {
        return None;
    }
    let (manifest_url, resolved_target, updater_type) = match manifest {
        Some((url, target)) => (url, target, AppUpdateDeliveryKind::Tauri),
        None => (String::new(), String::new(), AppUpdateDeliveryKind::Manual),
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
        channel: parsed.channel,
        manifest_url,
        target: resolved_target,
        updater_type,
    })
}
