use std::path::PathBuf;
use std::sync::Arc;

use vrcx_0_application::{ImageCache, OverlayActivityScope, OverlayActivitySurface, WebClient};
use vrcx_0_persistence::{storage::StorageService, DatabaseService};

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
            "vrcx-0-runtime-host-{name}-{}-{nonce}",
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

#[test]
fn backend_load_ignores_legacy_shared_wrist_filters() -> Result<(), Box<dyn std::error::Error>> {
    let dir = TestDir::new("overlay-activity-config");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
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
    let runtime = OverlayActivityRuntime::new();

    load_overlay_activity_filters(&config, &runtime);

    let filters = runtime.filters();
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
    let dir = TestDir::new("overlay-activity-three-keys");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
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
    let runtime = OverlayActivityRuntime::new();

    load_overlay_activity_filters(&config, &runtime);

    let filters = runtime.filters();
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
    let dir = TestDir::new("overlay-activity-webhook-key");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
    config.set_string(
        "webhookActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "on" } }
        }))?,
    )?;
    let runtime = OverlayActivityRuntime::new();

    load_overlay_activity_filters(&config, &runtime);

    let filters = runtime.filters();
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
    let dir = TestDir::new("overlay-activity-tts-seed-desktop");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
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
    let runtime = OverlayActivityRuntime::new();

    load_overlay_activity_filters(&config, &runtime);

    let filters = runtime.filters();
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
    let dir = TestDir::new("overlay-activity-tts-seed-vr");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let config = ConfigRepository::new(db);
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
    let runtime = OverlayActivityRuntime::new();

    load_overlay_activity_filters(&config, &runtime);

    assert_eq!(
        runtime
            .filters()
            .rule_for(OverlayActivitySurface::Tts, "invite")
            .scope,
        OverlayActivityScope::Friends
    );
    Ok(())
}

fn test_context(name: &str) -> (TestDir, RuntimeHostContext) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage = StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = Arc::new(
        WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let image_cache = Arc::new(
        ImageCache::new(dir.path.join("ImageCache"), web.image_fetcher().unwrap()).unwrap(),
    );
    let context = RuntimeHostContext::new(db, web, image_cache);
    (dir, context)
}

#[test]
fn prefetch_online_friend_avatars_is_a_no_op_without_active_session() {
    let (_dir, context) = test_context("prefetch-no-active-session");

    context.observe_runtime_event(
        "realtimeFriendProjection",
        &json!({
            "patches": [{
                "userId": "usr_friend",
                "stateBucket": "online",
                "patch": {}
            }]
        }),
    );
}

#[test]
fn prefetch_online_friend_avatars_ignores_non_online_buckets() {
    let (_dir, context) = test_context("prefetch-non-online-bucket");

    context.observe_runtime_event(
        "realtimeFriendProjection",
        &json!({
            "patches": [{
                "userId": "usr_friend",
                "stateBucket": "active",
                "patch": {}
            }]
        }),
    );
}

#[test]
fn prefetch_online_friend_avatars_skips_bulk_baseline_projections() {
    let (_dir, context) = test_context("prefetch-bulk-baseline");
    let patches = (0..64)
        .map(|index| {
            json!({
                "userId": format!("usr_friend_{index}"),
                "stateBucket": "online",
                "patch": {}
            })
        })
        .collect::<Vec<_>>();

    context.observe_runtime_event("realtimeFriendProjection", &json!({ "patches": patches }));
}
