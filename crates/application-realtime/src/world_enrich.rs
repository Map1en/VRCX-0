use serde_json::Value;
pub(crate) use vrcx_0_core::location::is_meaningful_world_name;
use vrcx_0_core::location::{format_display_location, parse_location, world_id_from_location};

use vrcx_0_application_core::WorldCache;

use crate::RealtimeEntryCorrectionStream;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::text::{first_non_empty, first_non_empty_owned};

#[derive(Clone, Debug)]
pub(crate) struct PendingWorldNameResolution {
    pub(crate) world_id: String,
    pub(crate) entry: Option<PendingEntryCorrection>,
}

impl PendingWorldNameResolution {
    pub(crate) fn cache_only(world_id: String) -> Self {
        Self {
            world_id,
            entry: None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PendingEntryCorrection {
    pub(crate) stream: RealtimeEntryCorrectionStream,
    pub(crate) id: String,
    pub(crate) location: String,
    pub(crate) group_name: String,
}

pub(crate) fn enrich_feed_entry(
    world_cache: &WorldCache,
    entry: &mut FeedLiveEntry,
    emit_correction: bool,
) -> Option<PendingWorldNameResolution> {
    let top_level_name = entry.world_name().to_string();
    let top_level_is_meaningful = is_meaningful_world_name(&top_level_name);

    let mut unresolved_world_id = None;
    let world_id = first_world_id([entry.world_id(), top_level_name.as_str(), entry.location()]);
    let world_name = if top_level_is_meaningful {
        Some(top_level_name)
    } else if world_id.is_empty() {
        None
    } else {
        match world_cache.get_name(&world_id) {
            Some(world_name) => Some(world_name),
            None => {
                unresolved_world_id = Some(world_id.clone());
                None
            }
        }
    };

    if let Some(world_name) = world_name {
        if !top_level_is_meaningful {
            entry.set_world_name(world_name);
        }
        if !world_id.is_empty() && entry.world_id().is_empty() {
            entry.set_world_id(world_id);
        }
    }
    let display_location =
        resolved_display_location(entry.location(), entry.world_name(), entry.group_name());
    if !display_location.is_empty() {
        entry.set_display_location(display_location);
    }
    unresolved_world_id.map(|world_id| PendingWorldNameResolution {
        world_id,
        entry: emit_correction.then(|| feed_pending_entry_correction(entry)),
    })
}

fn feed_pending_entry_correction(entry: &FeedLiveEntry) -> PendingEntryCorrection {
    PendingEntryCorrection {
        stream: RealtimeEntryCorrectionStream::Feed,
        id: entry.correction_id(),
        location: entry.location().to_string(),
        group_name: entry.group_name().to_string(),
    }
}

pub(crate) fn enrich_notification_world_name(
    world_cache: &WorldCache,
    value: &mut Value,
    emit_correction: bool,
) -> Option<PendingWorldNameResolution> {
    let object = value.as_object_mut()?;
    let top_level_name = object_string(object, "worldName");
    let details_name = nested_object_string(object, &["details", "worldName"]);
    let top_level_is_meaningful = is_meaningful_world_name(&top_level_name);
    let details_is_meaningful = is_meaningful_world_name(&details_name);

    let mut unresolved_world_id = None;
    let world_id = notification_world_id_from_object(object);
    let world_name = if top_level_is_meaningful {
        Some(top_level_name)
    } else if details_is_meaningful {
        Some(details_name)
    } else if world_id.is_empty() {
        None
    } else {
        match world_cache.get_name(&world_id) {
            Some(world_name) => Some(world_name),
            None => {
                unresolved_world_id = Some(world_id.clone());
                None
            }
        }
    };

    if let Some(world_name) = world_name {
        if !top_level_is_meaningful {
            object.insert("worldName".into(), Value::String(world_name.clone()));
        }
        if !details_is_meaningful {
            if let Some(details) = object.get_mut("details").and_then(Value::as_object_mut) {
                details.insert("worldName".into(), Value::String(world_name));
            }
        }
        if !world_id.is_empty() && object_str(object, "worldId").is_empty() {
            object.insert("worldId".into(), Value::String(world_id));
        }
    }
    apply_display_location(object);
    unresolved_world_id.map(|world_id| PendingWorldNameResolution {
        world_id,
        entry: emit_correction
            .then(|| notification_pending_entry_correction(object))
            .flatten(),
    })
}

pub(crate) fn resolved_display_location(
    location: &str,
    world_name: &str,
    group_name: &str,
) -> String {
    let parsed = parse_location(location);
    format_display_location(&parsed, world_name, group_name)
}

fn notification_world_id_from_object(object: &serde_json::Map<String, Value>) -> String {
    first_world_id([
        object_str(object, "worldId"),
        object_str(object, "worldName"),
        object_str(object, "location"),
        object_str(object, "instanceLocation"),
        nested_object_str(object, &["details", "worldId"]),
        nested_object_str(object, &["details", "worldName"]),
        nested_object_str(object, &["details", "location"]),
    ])
}

fn notification_pending_entry_correction(
    object: &serde_json::Map<String, Value>,
) -> Option<PendingEntryCorrection> {
    let id = notification_id_from_object(object);
    (!id.trim().is_empty()).then(|| PendingEntryCorrection {
        stream: RealtimeEntryCorrectionStream::Notification,
        id,
        location: first_non_empty_owned([
            object_str(object, "location"),
            nested_object_str(object, &["details", "location"]),
            object_str(object, "instanceLocation"),
        ]),
        group_name: first_non_empty_owned([
            object_str(object, "groupName"),
            nested_object_str(object, &["details", "groupName"]),
        ]),
    })
}

fn notification_id_from_object(object: &serde_json::Map<String, Value>) -> String {
    first_non_empty_owned([
        object_str(object, "id"),
        object_str(object, "notificationId"),
    ])
}

fn apply_display_location(object: &mut serde_json::Map<String, Value>) {
    let location = first_non_empty([
        object_str(object, "location"),
        nested_object_str(object, &["details", "location"]),
        object_str(object, "instanceLocation"),
    ]);
    let world_name = first_non_empty([
        object_str(object, "worldName"),
        nested_object_str(object, &["details", "worldName"]),
    ]);
    let group_name = first_non_empty([
        object_str(object, "groupName"),
        nested_object_str(object, &["details", "groupName"]),
    ]);
    let display_location = resolved_display_location(location, world_name, group_name);
    if !display_location.is_empty() {
        object.insert("displayLocation".into(), Value::String(display_location));
    }
}

fn object_string(object: &serde_json::Map<String, Value>, key: &str) -> String {
    object_str(object, key).to_string()
}

fn object_str<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> &'a str {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
}

fn nested_object_string(object: &serde_json::Map<String, Value>, path: &[&str]) -> String {
    nested_object_str(object, path).to_string()
}

fn nested_object_str<'a>(object: &'a serde_json::Map<String, Value>, path: &[&str]) -> &'a str {
    let Some((first, rest)) = path.split_first() else {
        return "";
    };
    let Some(mut current) = object.get(*first) else {
        return "";
    };
    for key in rest {
        let Some(next) = current.get(*key) else {
            return "";
        };
        current = next;
    }
    current.as_str().map(str::trim).unwrap_or_default()
}

fn first_world_id<const N: usize>(values: [&str; N]) -> String {
    values
        .into_iter()
        .map(world_id_from_location)
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}
