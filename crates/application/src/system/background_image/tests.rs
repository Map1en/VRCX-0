use std::time::Duration;

use chrono::{Local, TimeZone, Utc};
use serde_json::json;

use super::*;

fn files_custom_source(paths: &[&str]) -> BackgroundImageCustomSource {
    BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Files,
        paths: paths.iter().map(|p| p.to_string()).collect(),
        folder_path: String::new(),
        rotation_interval: BackgroundImageRotationInterval::Daily,
    }
}

#[test]
fn stable_hash_matches_frontend_fnv1a() {
    assert_eq!(stable_hash(""), 2166136261);
    assert_eq!(stable_hash("a"), 0xe40c292c);
    assert_eq!(stable_hash("files:C:\\img\\a.png:2026-07-30"), {
        let mut hash: u32 = 2166136261;
        for unit in "files:C:\\img\\a.png:2026-07-30".encode_utf16() {
            hash ^= unit as u32;
            hash = hash.wrapping_mul(16777619);
        }
        hash
    });
}

#[test]
fn custom_source_normalization_drops_empty_sources() {
    assert!(normalize_custom_source_struct(files_custom_source(&[])).is_none());
    assert!(normalize_custom_source_struct(BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Folder,
        paths: Vec::new(),
        folder_path: "  ".into(),
        rotation_interval: BackgroundImageRotationInterval::Daily,
    })
    .is_none());
    let normalized =
        normalize_custom_source_struct(files_custom_source(&["a.png", " a.png ", "", "b.png"]))
            .unwrap();
    assert_eq!(normalized.paths, vec!["a.png", "b.png"]);
}

#[test]
fn custom_source_wire_normalization_matches_config_shape() {
    let value = json!({
        "kind": "folder",
        "paths": ["ignored.png"],
        "folderPath": " C:\\wallpapers ",
        "rotationInterval": "hourly"
    });
    let source = normalize_custom_source(&value).unwrap();
    assert_eq!(source.kind, BackgroundImageCustomSourceKind::Folder);
    assert!(source.paths.is_empty());
    assert_eq!(source.folder_path, "C:\\wallpapers");
    assert_eq!(
        source.rotation_interval,
        BackgroundImageRotationInterval::Hourly
    );
}

#[test]
fn provider_snapshot_normalization_accepts_legacy_resolved_for_date() {
    let value = json!({
        "providerId": "nasa-epic",
        "imageUrl": "https://epic.gsfc.nasa.gov/a.jpg",
        "resolvedAt": "2026-07-30T00:00:00.000Z",
        "resolvedForDate": "2026-07-30"
    });
    let snapshot =
        normalize_provider_snapshot(Some(&value), BackgroundImageProviderId::NasaEpic).unwrap();
    assert_eq!(snapshot.resolved_for_key, "2026-07-30");
    assert!(
        normalize_provider_snapshot(Some(&value), BackgroundImageProviderId::NasaApodSafe)
            .is_none()
    );
}

#[test]
fn snapshot_freshness_uses_24h_ttl() {
    let mut snapshot = BackgroundImageSnapshot {
        mode: BackgroundImageMode::Daily,
        provider_id: Some(BackgroundImageProviderId::NasaEpic),
        source_kind: None,
        image_url: "https://example.com/a.jpg".into(),
        image_path: None,
        image_count: None,
        title: String::new(),
        author: String::new(),
        license: String::new(),
        source: String::new(),
        resolved_at: (Utc::now() - chrono::Duration::hours(23)).to_rfc3339(),
        resolved_for_key: "2026-07-30".into(),
    };
    assert!(is_snapshot_fresh(Some(&snapshot)));
    snapshot.resolved_at = (Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
    assert!(!is_snapshot_fresh(Some(&snapshot)));
    snapshot.resolved_at = String::new();
    assert!(!is_snapshot_fresh(Some(&snapshot)));
    assert!(!is_snapshot_fresh(None));
}

#[test]
fn rotation_boundary_aligns_to_next_hour_and_day() {
    let now = Local.with_ymd_and_hms(2026, 7, 30, 10, 15, 30).unwrap();
    let hourly = duration_until_next_rotation(BackgroundImageRotationInterval::Hourly, now);
    assert_eq!(hourly, Duration::from_millis((44 * 60 + 32) * 1000));
    let daily = duration_until_next_rotation(BackgroundImageRotationInterval::Daily, now);
    assert_eq!(
        daily,
        Duration::from_millis(((13 * 60 + 44) * 60 + 32) * 1000)
    );
}

#[test]
fn rotation_key_uses_local_date_and_hour() {
    let now = Local.with_ymd_and_hms(2026, 7, 30, 9, 5, 0).unwrap();
    assert_eq!(
        rotation_key(BackgroundImageRotationInterval::Daily, now),
        "2026-07-30"
    );
    assert_eq!(
        rotation_key(BackgroundImageRotationInterval::Hourly, now),
        "2026-07-30T09"
    );
}

#[test]
fn selected_files_assertions_detect_missing_paths() {
    let source = files_custom_source(&["C:\\img\\A.png", "C:\\img\\b.png"]);
    let files = vec!["c:\\img\\a.png".to_string(), "C:\\img\\b.png".to_string()];
    assert!(assert_selected_files_available(&source, &files).is_ok());
    assert!(assert_selected_files_available(&source, &files[..1].to_vec()).is_err());
}

#[test]
fn automatic_refresh_cannot_overwrite_a_user_operation() {
    assert!(!projection_update_is_current(2, 1, 4, Some(4)));
    assert!(!projection_update_is_current(2, 2, 5, Some(4)));
    assert!(projection_update_is_current(2, 2, 4, Some(4)));
    assert!(projection_update_is_current(2, 2, 5, None));
}
