use super::*;
use crate::{ActivityScope, ActivitySurfaceFilters, NotificationSurface};
use serde_json::json;
use vrcx_0_application_core::{ConfigStore, MemoryConfigStore};
use vrcx_0_contracts::activity::ActivityKind;

fn test_config(
    _name: &str,
) -> std::result::Result<((), MemoryConfigStore), Box<dyn std::error::Error>> {
    Ok(((), MemoryConfigStore::default()))
}

#[test]
fn backend_load_reads_three_independent_surface_keys(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
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
            .rule_for(NotificationSurface::Wrist, ActivityKind::Invite)
            .scope,
        ActivityScope::On
    );
    assert_eq!(
        filters
            .rule_for(NotificationSurface::Desktop, ActivityKind::Invite)
            .scope,
        ActivityScope::AllFavorites
    );
    assert_eq!(
        filters
            .rule_for(NotificationSurface::ExternalOverlay, ActivityKind::Invite)
            .scope,
        ActivityScope::Off
    );
    Ok(())
}

#[test]
fn backend_load_reads_webhook_surface_key() -> std::result::Result<(), Box<dyn std::error::Error>> {
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
            .rule_for(NotificationSurface::Webhook, ActivityKind::Invite)
            .scope,
        ActivityScope::On
    );
    Ok(())
}

#[test]
fn backend_load_reads_desktop_widget_key_with_its_own_defaults(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-widget-key")?;
    config.set_string(
        "desktopWidgetActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "invite": { "scope": "off" } }
        }))?,
    )?;
    let filters = load_overlay_activity_filters(&config);
    let scope = |surface, activity_type| filters.rule_for(surface, activity_type).scope;

    assert_eq!(
        scope(NotificationSurface::DesktopWidget, ActivityKind::Invite),
        ActivityScope::Off
    );
    assert_eq!(
        scope(NotificationSurface::DesktopWidget, ActivityKind::Gps),
        ActivityScope::AllFavorites
    );
    assert_eq!(
        scope(NotificationSurface::Wrist, ActivityKind::Invite),
        ActivityScope::Friends
    );
    Ok(())
}

#[test]
fn types_missing_from_a_saved_surface_take_that_surface_defaults(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-missing-types")?;
    let only_invite = serde_json::to_string(&json!({
        "version": 1,
        "types": { "invite": { "scope": "on" } }
    }))?;
    for key in [
        "webhookActivityFilters",
        "hmdNotificationActivityFilters",
        "ttsNotificationActivityFilters",
    ] {
        config.set_string(key, &only_invite)?;
    }
    let filters = load_overlay_activity_filters(&config);
    let scope = |surface, activity_type| filters.rule_for(surface, activity_type).scope;

    assert_eq!(
        scope(NotificationSurface::Webhook, ActivityKind::Online),
        ActivityScope::Off
    );
    assert_eq!(
        scope(NotificationSurface::Hmd, ActivityKind::Online),
        ActivityScope::AllFavorites
    );
    assert_eq!(
        scope(NotificationSurface::Tts, ActivityKind::Online),
        ActivityScope::Off
    );
    Ok(())
}

#[test]
fn backend_load_persists_tts_defaults_when_no_alert_rules_were_saved(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-tts-defaults")?;
    let filters = load_overlay_activity_filters(&config);

    assert_eq!(
        filters
            .rule_for(NotificationSurface::Tts, ActivityKind::Online)
            .scope,
        ActivityScope::Off
    );
    let saved = config.get_json("ttsNotificationActivityFilters", json!({}))?;
    assert_eq!(saved["types"]["Online"]["scope"], "off");
    Ok(())
}

#[test]
fn backend_load_seeds_tts_filters_from_desktop_once(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
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
            .rule_for(NotificationSurface::Tts, ActivityKind::Invite)
            .scope,
        ActivityScope::AllFavorites
    );
    let saved = config.get_json("ttsNotificationActivityFilters", json!({}))?;
    let saved = ActivitySurfaceFilters::from_saved_types_json(&saved, NotificationSurface::Tts);
    assert_eq!(
        saved.types.get("invite").unwrap().scope,
        ActivityScope::AllFavorites
    );
    Ok(())
}

#[test]
fn backend_load_seeds_tts_filters_from_vr_when_desktop_is_off(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
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
            .rule_for(NotificationSurface::Tts, ActivityKind::Invite)
            .scope,
        ActivityScope::Friends
    );
    Ok(())
}
