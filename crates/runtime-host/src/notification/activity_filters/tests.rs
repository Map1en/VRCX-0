use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use vrcx_0_application_activity::{
    OverlayActivityScope, OverlayActivitySurface, OverlayActivitySurfaceFilters,
};
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-runtime-host-filters-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_config(name: &str) -> Result<(TestDir, ConfigRepository), Box<dyn std::error::Error>> {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    Ok((dir, ConfigRepository::new(db)))
}

#[test]
fn backend_load_ignores_legacy_shared_wrist_filters() -> Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-config")?;
    config.set_json(
        "sharedFeedFilters",
        &json!({
            "noty": {
                "Online": "Off"
            },
            "wrist": {
                "invite": "VIP",
                "friendRequest": "Off"
            }
        }),
    )?;
    let filters = load_overlay_activity_filters(&config);
    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Wrist, "invite")
            .scope,
        OverlayActivityScope::Friends
    );
    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Wrist, "friendRequest")
            .scope,
        OverlayActivityScope::On
    );
    assert_eq!(
        config.get_json("sharedFeedFilters", json!({}))?,
        json!({
            "noty": {
                "Online": "Off"
            },
            "wrist": {
                "invite": "VIP",
                "friendRequest": "Off"
            }
        })
    );
    assert_eq!(config.get_raw("overlayActivityFilters")?, None);
    Ok(())
}

#[test]
fn backend_load_reads_three_independent_surface_keys() -> Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-three-keys")?;
    config.set_string(
        "overlayActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "wrist": { "types": { "invite": { "scope": "on" } } }
        }))?,
    )?;
    config.set_string(
        "desktopNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "allFavorites" } }
        }))?,
    )?;
    config.set_string(
        "vrNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "off" } }
        }))?,
    )?;
    let filters = load_overlay_activity_filters(&config);
    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Wrist, "invite")
            .scope,
        OverlayActivityScope::On
    );
    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Desktop, "invite")
            .scope,
        OverlayActivityScope::AllFavorites
    );
    assert_eq!(
        filters.rule_for(OverlayActivitySurface::Vr, "invite").scope,
        OverlayActivityScope::Off
    );
    Ok(())
}

#[test]
fn backend_load_reads_webhook_surface_key() -> Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-webhook-key")?;
    config.set_string(
        "webhookActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "on" } }
        }))?,
    )?;
    let filters = load_overlay_activity_filters(&config);
    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Webhook, "invite")
            .scope,
        OverlayActivityScope::On
    );
    Ok(())
}

#[test]
fn backend_load_seeds_tts_filters_from_desktop_once() -> Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-tts-seed-desktop")?;
    config.set_string(
        "desktopNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "allFavorites" } }
        }))?,
    )?;
    config.set_string(
        "vrNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "off" } }
        }))?,
    )?;
    let filters = load_overlay_activity_filters(&config);
    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Tts, "invite")
            .scope,
        OverlayActivityScope::AllFavorites
    );
    let saved = config.get_json("ttsNotificationActivityFilters", json!({}))?;
    let saved = OverlayActivitySurfaceFilters::from_types_json(&saved);
    assert_eq!(
        saved.types.get("invite").unwrap().scope,
        OverlayActivityScope::AllFavorites
    );
    Ok(())
}

#[test]
fn backend_load_seeds_tts_filters_from_vr_when_desktop_is_off(
) -> Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-tts-seed-vr")?;
    config.set_string(
        "desktopNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "off" } }
        }))?,
    )?;
    config.set_string(
        "vrNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "friends" } }
        }))?,
    )?;
    let filters = load_overlay_activity_filters(&config);

    assert_eq!(
        filters
            .rule_for(OverlayActivitySurface::Tts, "invite")
            .scope,
        OverlayActivityScope::Friends
    );
    Ok(())
}
