use std::collections::BTreeSet;

use serde_json::Value;
use vrcx_0_application_activity::{
    OverlayActivityFilters, OverlayActivityScope, OverlayActivitySurface,
    OverlayActivitySurfaceFilters,
};
use vrcx_0_persistence::config::ConfigRepository;

pub fn load_overlay_activity_filters(config: &ConfigRepository) -> OverlayActivityFilters {
    let mut filters = match config.get_raw("overlayActivityFilters") {
        Ok(Some(raw)) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) if OverlayActivityFilters::has_persisted_rules(&value) => {
                OverlayActivityFilters::from_json(value)
            }
            Ok(_) => OverlayActivityFilters::default(),
            Err(error) => {
                tracing::warn!("failed to parse overlay activity filters: {error}");
                OverlayActivityFilters::default()
            }
        },
        Ok(None) => OverlayActivityFilters::default(),
        Err(error) => {
            tracing::warn!("failed to load overlay activity filters: {error}");
            OverlayActivityFilters::default()
        }
    };
    if let Some(desktop) = load_types_key_surface(config, "desktopNotificationActivityFilters") {
        filters.desktop = desktop;
    }
    if let Some(vr) = load_types_key_surface(config, "vrNotificationActivityFilters") {
        filters.vr = vr;
    }
    if let Some(hmd) = load_types_key_surface(config, "hmdNotificationActivityFilters") {
        filters.hmd = hmd;
    }
    if let Some(webhook) = load_types_key_surface(config, "webhookActivityFilters") {
        filters.webhook = webhook;
    }
    if let Some(tts) = load_types_key_surface(config, "ttsNotificationActivityFilters") {
        filters.tts = tts;
    } else {
        filters.tts = seed_tts_notification_activity_filters(config, &filters);
    }
    filters
}

fn seed_tts_notification_activity_filters(
    config: &ConfigRepository,
    filters: &OverlayActivityFilters,
) -> OverlayActivitySurfaceFilters {
    let mut seeded = filters.desktop.clone();
    let activity_types = filters
        .desktop
        .types
        .keys()
        .chain(filters.vr.types.keys())
        .collect::<BTreeSet<_>>();
    for activity_type in activity_types {
        let desktop_rule = filters.rule_for(OverlayActivitySurface::Desktop, activity_type);
        if desktop_rule.scope == OverlayActivityScope::Off {
            let vr_rule = filters.rule_for(OverlayActivitySurface::Vr, activity_type);
            if vr_rule.scope != OverlayActivityScope::Off {
                seeded.types.insert(activity_type.clone(), vr_rule);
            }
        } else {
            seeded.types.insert(activity_type.clone(), desktop_rule);
        }
    }
    if let Ok(value) = serde_json::to_value(&seeded) {
        if let Err(error) = config.set_json("ttsNotificationActivityFilters", &value) {
            tracing::warn!("failed to persist seeded TTS activity filters: {error}");
        }
    }
    seeded
}

fn load_types_key_surface(
    config: &ConfigRepository,
    key: &str,
) -> Option<OverlayActivitySurfaceFilters> {
    let raw = config.get_raw(key).ok().flatten()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    value
        .get("types")
        .is_some_and(Value::is_object)
        .then(|| OverlayActivitySurfaceFilters::from_types_json(&value))
}

#[cfg(test)]
mod tests;
