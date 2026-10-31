use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::{
    ActivityFilters, ActivityRouter, ActivityRule, ActivityScope, ActivitySurfaceFilters,
    NotificationSurface,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::activity::ActivityKind;

use super::NotificationConfig;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilterProfile {
    pub version: u32,
    pub types: BTreeMap<String, ActivityRule>,
}

impl ActivityFilterProfile {
    fn from_surface(surface: &ActivitySurfaceFilters) -> Self {
        Self {
            version: 1,
            types: surface.types.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationActivityFilterProfiles {
    pub wrist: ActivityFilterProfile,
    pub vr: ActivityFilterProfile,
    pub hmd: ActivityFilterProfile,
    pub desktop: ActivityFilterProfile,
    pub webhook: ActivityFilterProfile,
    pub tts: ActivityFilterProfile,
    pub widget: ActivityFilterProfile,
}

impl From<&ActivityFilters> for NotificationActivityFilterProfiles {
    fn from(filters: &ActivityFilters) -> Self {
        Self {
            wrist: ActivityFilterProfile::from_surface(&filters.wrist),
            vr: ActivityFilterProfile::from_surface(&filters.vr),
            hmd: ActivityFilterProfile::from_surface(&filters.hmd),
            desktop: ActivityFilterProfile::from_surface(&filters.desktop),
            webhook: ActivityFilterProfile::from_surface(&filters.webhook),
            tts: ActivityFilterProfile::from_surface(&filters.tts),
            widget: ActivityFilterProfile::from_surface(&filters.widget),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationActivityFilterSurface {
    Wrist,
    Vr,
    Hmd,
    Desktop,
    Webhook,
    Tts,
    Widget,
}

impl NotificationActivityFilterSurface {
    fn surface(self) -> NotificationSurface {
        match self {
            Self::Wrist => NotificationSurface::Wrist,
            Self::Vr => NotificationSurface::ExternalOverlay,
            Self::Hmd => NotificationSurface::Hmd,
            Self::Desktop => NotificationSurface::Desktop,
            Self::Webhook => NotificationSurface::Webhook,
            Self::Tts => NotificationSurface::Tts,
            Self::Widget => NotificationSurface::DesktopWidget,
        }
    }

    fn config_key(self) -> &'static str {
        match self {
            Self::Wrist => WRIST_FILTERS_CONFIG_KEY,
            Self::Vr => "vrNotificationActivityFilters",
            Self::Hmd => HMD_FILTERS_CONFIG_KEY,
            Self::Desktop => "desktopNotificationActivityFilters",
            Self::Webhook => "webhookActivityFilters",
            Self::Tts => TTS_FILTERS_CONFIG_KEY,
            Self::Widget => WIDGET_FILTERS_CONFIG_KEY,
        }
    }
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationActivityFiltersSetInput {
    pub surface: NotificationActivityFilterSurface,
    pub filters: ActivityFilterProfile,
}

const WRIST_FILTERS_CONFIG_KEY: &str = "overlayActivityFilters";
const HMD_FILTERS_CONFIG_KEY: &str = "hmdNotificationActivityFilters";
const TTS_FILTERS_CONFIG_KEY: &str = "ttsNotificationActivityFilters";
const WIDGET_FILTERS_CONFIG_KEY: &str = "desktopWidgetActivityFilters";

pub fn save_notification_activity_filters(
    config: &dyn NotificationConfig,
    input: NotificationActivityFiltersSetInput,
) -> Result<ActivityFilterProfile> {
    let normalized = ActivitySurfaceFilters::from_saved_types_json(
        &serde_json::to_value(&input.filters)?,
        input.surface.surface(),
    );
    let profile = ActivityFilterProfile::from_surface(&normalized);
    let stored = match input.surface {
        NotificationActivityFilterSurface::Wrist => {
            json!({ "version": 1, "wrist": { "types": &profile.types } })
        }
        _ => serde_json::to_value(&profile)?,
    };
    config.set_json(input.surface.config_key(), &stored)?;
    Ok(profile)
}

pub fn rename_local_favorite_group_in_activity_filters(
    config: &dyn NotificationConfig,
    group_name: &str,
    new_group_name: &str,
) -> Result<()> {
    let old_key = format!("local:{group_name}");
    let new_key = format!("local:{new_group_name}");
    for surface in [
        NotificationActivityFilterSurface::Wrist,
        NotificationActivityFilterSurface::Vr,
        NotificationActivityFilterSurface::Hmd,
        NotificationActivityFilterSurface::Desktop,
        NotificationActivityFilterSurface::Webhook,
        NotificationActivityFilterSurface::Tts,
        NotificationActivityFilterSurface::Widget,
    ] {
        let Some(raw) = config.get_raw(surface.config_key())? else {
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if rename_string_values(&mut value, &old_key, &new_key) {
            config.set_json(surface.config_key(), &value)?;
        }
    }
    Ok(())
}

fn rename_string_values(value: &mut Value, old: &str, new: &str) -> bool {
    match value {
        Value::String(text) if text == old => {
            *text = new.to_string();
            true
        }
        Value::Array(values) => values.iter_mut().fold(false, |changed, value| {
            rename_string_values(value, old, new) | changed
        }),
        Value::Object(fields) => fields.values_mut().fold(false, |changed, value| {
            rename_string_values(value, old, new) | changed
        }),
        _ => false,
    }
}

pub fn load_overlay_activity_filters(config: &dyn NotificationConfig) -> ActivityFilters {
    let mut alert_rules_saved = false;
    let mut filters = match config.get_raw(WRIST_FILTERS_CONFIG_KEY) {
        Ok(Some(raw)) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) if ActivityFilters::has_persisted_rules(&value) => {
                let legacy_hmd = value.get("hmd").is_some();
                alert_rules_saved = value.get("desktop").is_some() || value.get("vr").is_some();
                let filters = ActivityFilters::from_json(value);
                if legacy_hmd
                    && config
                        .get_raw(HMD_FILTERS_CONFIG_KEY)
                        .ok()
                        .flatten()
                        .is_none()
                {
                    persist_surface(config, HMD_FILTERS_CONFIG_KEY, &filters.hmd);
                }
                filters
            }
            Ok(_) => ActivityFilters::default(),
            Err(error) => {
                tracing::warn!("failed to parse overlay activity filters: {error}");
                ActivityFilters::default()
            }
        },
        Ok(None) => ActivityFilters::default(),
        Err(error) => {
            tracing::warn!("failed to load overlay activity filters: {error}");
            ActivityFilters::default()
        }
    };
    if let Some(desktop) = load_types_key_surface(
        config,
        "desktopNotificationActivityFilters",
        NotificationSurface::Desktop,
    ) {
        filters.desktop = desktop;
        alert_rules_saved = true;
    }
    if let Some(vr) = load_types_key_surface(
        config,
        "vrNotificationActivityFilters",
        NotificationSurface::ExternalOverlay,
    ) {
        filters.vr = vr;
        alert_rules_saved = true;
    }
    if let Some(hmd) =
        load_types_key_surface(config, HMD_FILTERS_CONFIG_KEY, NotificationSurface::Hmd)
    {
        filters.hmd = hmd;
    }
    if let Some(webhook) = load_types_key_surface(
        config,
        "webhookActivityFilters",
        NotificationSurface::Webhook,
    ) {
        filters.webhook = webhook;
    }
    if let Some(widget) = load_types_key_surface(
        config,
        WIDGET_FILTERS_CONFIG_KEY,
        NotificationSurface::DesktopWidget,
    ) {
        filters.widget = widget;
    }
    if let Some(tts) =
        load_types_key_surface(config, TTS_FILTERS_CONFIG_KEY, NotificationSurface::Tts)
    {
        filters.tts = tts;
    } else {
        if alert_rules_saved {
            filters.tts = tts_rules_from_alert_rules(&filters);
        }
        persist_surface(config, TTS_FILTERS_CONFIG_KEY, &filters.tts);
    }
    filters
}

pub fn reload_activity_router(activity_router: &ActivityRouter, config: &dyn NotificationConfig) {
    activity_router.set_filters(load_overlay_activity_filters(config));
    apply_location_notification_rules(activity_router, config);
}

fn apply_location_notification_rules(
    activity_router: &ActivityRouter,
    config: &dyn NotificationConfig,
) {
    activity_router.set_feed_hidden_users(
        load_feed_hidden_notification_user_ids(config),
        config
            .get_bool("feedHiddenUsersHideAll", false)
            .unwrap_or(false),
    );
    activity_router.set_hide_private_location_changes(
        config
            .get_bool("hidePrivateFromFeed", false)
            .unwrap_or(false),
    );
    activity_router.set_hide_video_errors(
        config
            .get_bool("hideVideoErrorNotifications", false)
            .unwrap_or(false),
    );
}

fn load_feed_hidden_notification_user_ids(config: &dyn NotificationConfig) -> HashSet<String> {
    if !config
        .get_bool("feedHiddenUsersHideNotifications", true)
        .unwrap_or(true)
    {
        return HashSet::new();
    }
    let Some(raw) = config.get_raw("feedHiddenUsers").ok().flatten() else {
        return HashSet::new();
    };
    let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(&raw) else {
        return HashSet::new();
    };
    entries
        .iter()
        .filter_map(|entry| match entry {
            Value::String(user_id) => Some(user_id.as_str()),
            Value::Object(fields) => fields.get("userId").and_then(Value::as_str),
            _ => None,
        })
        .map(str::trim)
        .filter(|user_id| !user_id.is_empty())
        .map(str::to_string)
        .collect()
}

fn tts_rules_from_alert_rules(filters: &ActivityFilters) -> ActivitySurfaceFilters {
    let mut seeded = filters.desktop.clone();
    let activity_types = filters
        .desktop
        .types
        .keys()
        .chain(filters.vr.types.keys())
        .collect::<BTreeSet<_>>();
    for (activity_type, kind) in activity_types
        .into_iter()
        .filter_map(|key| ActivityKind::from_key(key).map(|kind| (key, kind)))
    {
        let desktop_rule = filters.rule_for(NotificationSurface::Desktop, kind);
        if desktop_rule.scope == ActivityScope::Off {
            let vr_rule = filters.rule_for(NotificationSurface::ExternalOverlay, kind);
            if vr_rule.scope != ActivityScope::Off {
                seeded.types.insert(activity_type.clone(), vr_rule);
            }
        } else {
            seeded.types.insert(activity_type.clone(), desktop_rule);
        }
    }
    seeded
}

fn persist_surface(config: &dyn NotificationConfig, key: &str, surface: &ActivitySurfaceFilters) {
    let profile = ActivityFilterProfile::from_surface(surface);
    let result = serde_json::to_value(&profile)
        .map_err(vrcx_0_application_core::Error::from)
        .and_then(|value| config.set_json(key, &value));
    if let Err(error) = result {
        tracing::warn!("failed to persist seeded {key}: {error}");
    }
}

fn load_types_key_surface(
    config: &dyn NotificationConfig,
    key: &str,
    surface: NotificationSurface,
) -> Option<ActivitySurfaceFilters> {
    let raw = config.get_raw(key).ok().flatten()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    value
        .get("types")
        .is_some_and(Value::is_object)
        .then(|| ActivitySurfaceFilters::from_saved_types_json(&value, surface))
}

#[cfg(test)]
mod tests;
