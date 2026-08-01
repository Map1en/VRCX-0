use std::path::Path;
use std::time::Duration;

use chrono::{DateTime, Datelike, Local, TimeZone, Timelike, Utc};
use serde_json::Value;
use vrcx_0_core::json::text_of;
use vrcx_0_persistence::{config as config_store, DatabaseService};

use super::{
    BackgroundImageCustomSource, BackgroundImageCustomSourceKind, BackgroundImageMode,
    BackgroundImageProviderId, BackgroundImageRotationInterval, BackgroundImageSnapshot,
    KEY_COMMUNITY_THEME_CSS_SNAPSHOT, KEY_COMMUNITY_THEME_ENABLED,
    KEY_COMMUNITY_THEME_INSTALLED_THEMES, KEY_COMMUNITY_THEME_INSTALL_METADATA,
};
use crate::{Error, Result};

const SNAPSHOT_TTL_HOURS: i64 = 24;
const ROTATION_BOUNDARY_GRACE_SECONDS: u32 = 2;

pub(super) fn community_theme_appearance_active(db: &DatabaseService) -> Result<bool> {
    if !config_store::get_bool(db, KEY_COMMUNITY_THEME_ENABLED, false)? {
        return Ok(false);
    }
    let records = config_store::get_json(db, KEY_COMMUNITY_THEME_INSTALLED_THEMES, Value::Null)?;
    if records
        .as_array()
        .is_some_and(|records| !records.is_empty())
    {
        return Ok(true);
    }
    let metadata = config_store::get_json(db, KEY_COMMUNITY_THEME_INSTALL_METADATA, Value::Null)?;
    if !text_of(metadata.get("themeId")).trim().is_empty() {
        return Ok(true);
    }
    Ok(
        !config_store::get_string(db, KEY_COMMUNITY_THEME_CSS_SNAPSHOT, "")?
            .trim()
            .is_empty(),
    )
}

pub(super) fn ensure_provider_status(status: i32) -> Result<()> {
    if status == 429 {
        return Err(Error::Custom(
            "Background Image provider rate limit reached.".into(),
        ));
    }
    if !(200..300).contains(&status) {
        return Err(Error::Custom(format!(
            "Failed to load Background Image provider: {status}"
        )));
    }
    Ok(())
}

pub(super) fn mode_as_str(mode: BackgroundImageMode) -> &'static str {
    match mode {
        BackgroundImageMode::Off => "off",
        BackgroundImageMode::Daily => "daily",
        BackgroundImageMode::Custom => "custom",
    }
}

pub(super) fn normalize_mode(value: &str) -> BackgroundImageMode {
    match value.trim() {
        "daily" => BackgroundImageMode::Daily,
        "custom" => BackgroundImageMode::Custom,
        _ => BackgroundImageMode::Off,
    }
}

pub(super) fn normalize_provider_snapshot(
    value: Option<&Value>,
    expected_provider: BackgroundImageProviderId,
) -> Option<BackgroundImageSnapshot> {
    let value = value?;
    if !value.is_object() {
        return None;
    }
    let provider_id = BackgroundImageProviderId::from_config(&text_of(value.get("providerId")));
    if provider_id != expected_provider {
        return None;
    }
    let image_url = text_of(value.get("imageUrl")).trim().to_string();
    if image_url.is_empty() {
        return None;
    }
    let resolved_for_key = {
        let key = text_of(value.get("resolvedForKey"));
        if key.is_empty() {
            text_of(value.get("resolvedForDate"))
        } else {
            key
        }
    };

    Some(BackgroundImageSnapshot {
        mode: BackgroundImageMode::Daily,
        provider_id: Some(provider_id),
        source_kind: None,
        image_url,
        image_path: None,
        image_count: None,
        title: text_of(value.get("title")),
        author: text_of(value.get("author")),
        license: text_of(value.get("license")),
        source: text_of(value.get("source")),
        resolved_at: text_of(value.get("resolvedAt")),
        resolved_for_key,
    })
}

pub(super) fn is_snapshot_fresh(snapshot: Option<&BackgroundImageSnapshot>) -> bool {
    let Some(snapshot) = snapshot else {
        return false;
    };
    if snapshot.provider_id.is_none() || snapshot.resolved_at.is_empty() {
        return false;
    }
    let Ok(resolved_at) = DateTime::parse_from_rfc3339(&snapshot.resolved_at) else {
        return false;
    };
    let age = Utc::now().signed_duration_since(resolved_at.with_timezone(&Utc));
    age >= chrono::Duration::zero() && age < chrono::Duration::hours(SNAPSHOT_TTL_HOURS)
}

pub(super) fn unique_paths(paths: &[String]) -> Vec<String> {
    let mut seen = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !seen.iter().any(|existing: &String| existing == trimmed) {
            seen.push(trimmed.to_string());
        }
    }
    seen
}

pub(super) fn normalize_custom_source_struct(
    source: BackgroundImageCustomSource,
) -> Option<BackgroundImageCustomSource> {
    let paths = unique_paths(&source.paths);
    let folder_path = source.folder_path.trim().to_string();
    match source.kind {
        BackgroundImageCustomSourceKind::Folder if folder_path.is_empty() => None,
        BackgroundImageCustomSourceKind::Files if paths.is_empty() => None,
        BackgroundImageCustomSourceKind::Folder => Some(BackgroundImageCustomSource {
            kind: BackgroundImageCustomSourceKind::Folder,
            paths: Vec::new(),
            folder_path,
            rotation_interval: source.rotation_interval,
        }),
        BackgroundImageCustomSourceKind::Files => Some(BackgroundImageCustomSource {
            kind: BackgroundImageCustomSourceKind::Files,
            paths,
            folder_path: String::new(),
            rotation_interval: source.rotation_interval,
        }),
    }
}

pub(super) fn normalize_custom_source(value: &Value) -> Option<BackgroundImageCustomSource> {
    if !value.is_object() {
        return None;
    }
    let kind = if text_of(value.get("kind")) == "folder" {
        BackgroundImageCustomSourceKind::Folder
    } else {
        BackgroundImageCustomSourceKind::Files
    };
    let paths: Vec<String> = value
        .get("paths")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .map(|entry| text_of(Some(entry)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rotation_interval = if text_of(value.get("rotationInterval")) == "hourly" {
        BackgroundImageRotationInterval::Hourly
    } else {
        BackgroundImageRotationInterval::Daily
    };

    normalize_custom_source_struct(BackgroundImageCustomSource {
        kind,
        paths,
        folder_path: text_of(value.get("folderPath")),
        rotation_interval,
    })
}

pub(super) fn files_source(
    paths: Vec<String>,
    rotation_interval: BackgroundImageRotationInterval,
) -> BackgroundImageCustomSource {
    BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Files,
        paths: unique_paths(&paths),
        folder_path: String::new(),
        rotation_interval,
    }
}

pub(super) fn folder_source(
    folder_path: String,
    rotation_interval: BackgroundImageRotationInterval,
) -> BackgroundImageCustomSource {
    BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Folder,
        paths: Vec::new(),
        folder_path: folder_path.trim().to_string(),
        rotation_interval,
    }
}

fn path_key(path: &str) -> String {
    path.trim().to_lowercase()
}

pub(super) fn assert_selected_files_available(
    source: &BackgroundImageCustomSource,
    files: &[String],
) -> Result<()> {
    if source.kind != BackgroundImageCustomSourceKind::Files {
        return Ok(());
    }
    let available: Vec<String> = files.iter().map(|file| path_key(file)).collect();
    if source
        .paths
        .iter()
        .any(|path| !available.contains(&path_key(path)))
    {
        return Err(Error::Custom(
            "A selected background image is no longer available.".into(),
        ));
    }
    Ok(())
}

pub(super) fn assert_previous_image_available(
    source: &BackgroundImageCustomSource,
    files: &[String],
    previous: Option<&BackgroundImageSnapshot>,
) -> Result<()> {
    let Some(previous) = previous else {
        return Ok(());
    };
    let Some(image_path) = previous.image_path.as_deref().filter(|p| !p.is_empty()) else {
        return Ok(());
    };
    if previous.mode != BackgroundImageMode::Custom || previous.source_kind != Some(source.kind) {
        return Ok(());
    }
    if !files
        .iter()
        .any(|file| path_key(file) == path_key(image_path))
    {
        return Err(Error::Custom(
            "The current background image is no longer available.".into(),
        ));
    }
    Ok(())
}

pub(super) fn source_hash_key(source: &BackgroundImageCustomSource) -> String {
    match source.kind {
        BackgroundImageCustomSourceKind::Folder => format!("folder:{}", source.folder_path),
        BackgroundImageCustomSourceKind::Files => format!("files:{}", source.paths.join("|")),
    }
}

pub(super) fn stable_hash(value: &str) -> u32 {
    let mut hash: u32 = 2166136261;
    for unit in value.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

pub(super) fn projection_update_is_current(
    current_operation: u64,
    operation: u64,
    current_revision: u64,
    expected_revision: Option<u64>,
) -> bool {
    current_operation == operation
        && expected_revision.is_none_or(|revision| current_revision == revision)
}

pub(super) fn file_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

pub(super) fn current_utc_date_key() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

pub(super) fn rotation_key(
    interval: BackgroundImageRotationInterval,
    now: DateTime<Local>,
) -> String {
    match interval {
        BackgroundImageRotationInterval::Hourly => now.format("%Y-%m-%dT%H").to_string(),
        BackgroundImageRotationInterval::Daily => now.format("%Y-%m-%d").to_string(),
    }
}

pub(super) fn duration_until_next_rotation(
    interval: BackgroundImageRotationInterval,
    now: DateTime<Local>,
) -> Duration {
    let next = match interval {
        BackgroundImageRotationInterval::Hourly => {
            let base = now + chrono::Duration::hours(1);
            Local
                .with_ymd_and_hms(
                    base.year(),
                    base.month(),
                    base.day(),
                    base.hour(),
                    0,
                    ROTATION_BOUNDARY_GRACE_SECONDS,
                )
                .earliest()
        }
        BackgroundImageRotationInterval::Daily => {
            let base = now + chrono::Duration::days(1);
            Local
                .with_ymd_and_hms(
                    base.year(),
                    base.month(),
                    base.day(),
                    0,
                    0,
                    ROTATION_BOUNDARY_GRACE_SECONDS,
                )
                .earliest()
        }
    };
    let millis = next
        .map(|next| (next - now).num_milliseconds())
        .unwrap_or(3_600_000)
        .max(1_000);
    Duration::from_millis(millis as u64)
}
