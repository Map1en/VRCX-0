use std::{collections::HashMap, sync::Mutex};

use super::*;
use crate::{ActivityScope, ActivitySurfaceFilters, NotificationSurface};
use serde_json::{json, Value};
use vrcx_0_contracts::activity::ActivityKind;

#[derive(Default)]
struct TestConfig {
    values: Mutex<HashMap<String, String>>,
}

impl TestConfig {
    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()> {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn get_json(&self, key: &str, fallback: Value) -> vrcx_0_application_core::Result<Value> {
        self.get_raw(key)?
            .map(|raw| serde_json::from_str(&raw).map_err(Into::into))
            .unwrap_or(Ok(fallback))
    }
}

impl NotificationConfig for TestConfig {
    fn get_raw(&self, key: &str) -> vrcx_0_application_core::Result<Option<String>> {
        Ok(self.values.lock().unwrap().get(key).cloned())
    }

    fn get_bool(&self, key: &str, default_value: bool) -> vrcx_0_application_core::Result<bool> {
        Ok(self
            .get_raw(key)?
            .and_then(|value| value.parse().ok())
            .unwrap_or(default_value))
    }

    fn get_string(
        &self,
        key: &str,
        default_value: &str,
    ) -> vrcx_0_application_core::Result<String> {
        Ok(self
            .get_raw(key)?
            .unwrap_or_else(|| default_value.to_string()))
    }

    fn set_json(&self, key: &str, value: &Value) -> vrcx_0_application_core::Result<()> {
        self.set_string(key, &serde_json::to_string(value)?)
    }
}

fn test_config(_name: &str) -> std::result::Result<((), TestConfig), Box<dyn std::error::Error>> {
    Ok(((), TestConfig::default()))
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

#[test]
fn renaming_a_local_friend_group_rewrites_its_key_in_every_saved_surface(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-local-group-rename")?;
    let selected = |keys: Value| json!({ "scope": "selectedFavorites", "favoriteGroupKeys": keys });
    config.set_string(
        "overlayActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "wrist": { "types": { "Online": selected(json!(["group_0", "local:Close"])) } }
        }))?,
    )?;
    config.set_string(
        "desktopNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "Online": selected(json!(["local:Close"])) }
        }))?,
    )?;
    config.set_string(
        "ttsNotificationActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "types": { "Online": selected(json!(["local:Closer"])) }
        }))?,
    )?;

    rename_local_favorite_group_in_activity_filters(&config, "Close", "Inner")?;

    let keys =
        |key: &str, path: &[&str]| -> std::result::Result<Value, Box<dyn std::error::Error>> {
            let mut value = config.get_json(key, json!({}))?;
            for segment in path {
                value = value[*segment].take();
            }
            Ok(value["Online"]["favoriteGroupKeys"].take())
        };
    assert_eq!(
        keys("overlayActivityFilters", &["wrist", "types"])?,
        json!(["group_0", "local:Inner"])
    );
    assert_eq!(
        keys("desktopNotificationActivityFilters", &["types"])?,
        json!(["local:Inner"])
    );
    assert_eq!(
        keys("ttsNotificationActivityFilters", &["types"])?,
        json!(["local:Closer"])
    );
    assert!(config.get_raw("vrNotificationActivityFilters")?.is_none());
    Ok(())
}

#[test]
fn backend_save_normalizes_only_the_requested_surface(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("overlay-activity-save-surface")?;
    config.set_string("desktopNotificationActivityFilters", "desktop-before")?;
    let filters = ActivityFilterProfile {
        version: 9,
        types: [
            (
                "future.activity".to_string(),
                crate::ActivityRule {
                    scope: ActivityScope::On,
                    favorite_group_keys: crate::ActivityFavoriteGroupKeys::All,
                },
            ),
            (
                "invite".to_string(),
                crate::ActivityRule {
                    scope: ActivityScope::EveryoneInInstance,
                    favorite_group_keys: crate::ActivityFavoriteGroupKeys::All,
                },
            ),
        ]
        .into(),
    };

    let saved = save_notification_activity_filters(
        &config,
        NotificationActivityFiltersSetInput {
            surface: NotificationSurface::Webhook,
            filters,
        },
    )?;

    assert_eq!(saved.version, 1);
    assert!(!saved.types.contains_key("future.activity"));
    assert_eq!(saved.types["invite"].scope, ActivityScope::Off);
    assert_eq!(saved.types["GPS"].scope, ActivityScope::Off);
    assert_eq!(
        config.get_string("desktopNotificationActivityFilters", "")?,
        "desktop-before"
    );
    let stored = config.get_json("webhookActivityFilters", json!({}))?;
    assert_eq!(stored["types"]["invite"]["scope"], "off");
    Ok(())
}

#[test]
fn hmd_rules_live_only_under_their_own_key() -> std::result::Result<(), Box<dyn std::error::Error>>
{
    let (_dir, config) = test_config("overlay-activity-hmd-key")?;
    config.set_string(
        "overlayActivityFilters",
        &serde_json::to_string(&json!({
            "version": 1,
            "wrist": { "types": { "invite": { "scope": "on" } } },
            "hmd": { "types": { "invite": { "scope": "off" } } }
        }))?,
    )?;

    let filters = load_overlay_activity_filters(&config);
    assert_eq!(
        filters
            .rule_for(NotificationSurface::Hmd, ActivityKind::Invite)
            .scope,
        ActivityScope::Off
    );
    let seeded = config.get_json("hmdNotificationActivityFilters", json!({}))?;
    assert_eq!(seeded["types"]["invite"]["scope"], "off");

    save_notification_activity_filters(
        &config,
        NotificationActivityFiltersSetInput {
            surface: NotificationSurface::Wrist,
            filters: ActivityFilterProfile {
                version: 1,
                types: BTreeMap::new(),
            },
        },
    )?;
    let wrist = config.get_json("overlayActivityFilters", json!({}))?;
    assert!(wrist.get("hmd").is_none());
    assert_eq!(wrist["wrist"]["types"]["invite"]["scope"], "friends");
    Ok(())
}

#[test]
fn feed_hidden_notification_users_load_from_the_feed_list_unless_the_switch_is_off(
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_dir, config) = test_config("feed-hidden-users")?;
    config.set_string(
        "feedHiddenUsers",
        &serde_json::to_string(&json!([" usr_a ", { "userId": "usr_b" }, ""]))?,
    )?;
    assert_eq!(
        load_feed_hidden_notification_user_ids(&config),
        HashSet::from(["usr_a".to_string(), "usr_b".to_string()])
    );

    config.set_string("feedHiddenUsersHideNotifications", "false")?;
    assert!(load_feed_hidden_notification_user_ids(&config).is_empty());
    Ok(())
}
