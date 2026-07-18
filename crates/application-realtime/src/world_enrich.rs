use serde_json::Value;
pub(crate) use vrcx_0_core::location::is_meaningful_world_name;
use vrcx_0_core::location::{format_display_location, parse_location, world_id_from_location};

use vrcx_0_application_core::{RealtimeEntryCorrectionStream, WorldCache};

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

pub(crate) fn enrich_world_name(
    world_cache: &WorldCache,
    value: &mut Value,
    stream: Option<RealtimeEntryCorrectionStream>,
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
        if !world_id.is_empty() && object_string(object, "worldId").is_empty() {
            object.insert("worldId".into(), Value::String(world_id));
        }
    }
    apply_display_location(object);
    unresolved_world_id.map(|world_id| PendingWorldNameResolution {
        world_id,
        entry: stream.and_then(|stream| pending_entry_correction(object, stream)),
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

pub(crate) fn feed_entry_correction_id(object: &serde_json::Map<String, Value>) -> String {
    let id = object_string(object, "id");
    if !id.is_empty() {
        return format!("id:{id}");
    }
    let row_id = first_owned([
        object_string(object, "rowId"),
        object_string(object, "row_id"),
    ]);
    if !row_id.is_empty() {
        let source_rank = first_owned([
            object_string(object, "sourceRank"),
            object_string(object, "source_rank"),
        ]);
        let entry_type = object_string(object, "type");
        if !source_rank.is_empty() {
            return format!("row:{entry_type}:{source_rank}:{row_id}");
        }
        return format!("row:{entry_type}:{row_id}");
    }
    let entry_type = object_string(object, "type");
    let created_at = first_owned([
        object_string(object, "created_at"),
        object_string(object, "createdAt"),
    ]);
    let user_id = first_owned([
        object_string(object, "userId"),
        object_string(object, "senderUserId"),
    ]);
    let location = first_owned([
        object_string(object, "location"),
        nested_object_string(object, &["details", "location"]),
    ]);
    let message = object_string(object, "message");
    format!("{entry_type}:{created_at}:{user_id}:{location}:{message}")
}

fn notification_world_id_from_object(object: &serde_json::Map<String, Value>) -> String {
    first_world_id([
        object_string(object, "worldId"),
        object_string(object, "worldName"),
        object_string(object, "location"),
        object_string(object, "instanceLocation"),
        nested_object_string(object, &["details", "worldId"]),
        nested_object_string(object, &["details", "worldName"]),
        nested_object_string(object, &["details", "location"]),
    ])
}

fn pending_entry_correction(
    object: &serde_json::Map<String, Value>,
    stream: RealtimeEntryCorrectionStream,
) -> Option<PendingEntryCorrection> {
    let id = match stream {
        RealtimeEntryCorrectionStream::Feed => feed_entry_correction_id(object),
        RealtimeEntryCorrectionStream::Notification => notification_id_from_object(object),
    };
    (!id.trim().is_empty()).then(|| PendingEntryCorrection {
        stream,
        id,
        location: first_owned([
            object_string(object, "location"),
            nested_object_string(object, &["details", "location"]),
            object_string(object, "instanceLocation"),
        ]),
        group_name: first_owned([
            object_string(object, "groupName"),
            nested_object_string(object, &["details", "groupName"]),
        ]),
    })
}

fn notification_id_from_object(object: &serde_json::Map<String, Value>) -> String {
    let id = object_string(object, "id");
    if id.is_empty() {
        object_string(object, "notificationId")
    } else {
        id
    }
}

fn apply_display_location(object: &mut serde_json::Map<String, Value>) {
    let location = first_owned([
        object_string(object, "location"),
        nested_object_string(object, &["details", "location"]),
        object_string(object, "instanceLocation"),
    ]);
    let world_name = first_owned([
        object_string(object, "worldName"),
        nested_object_string(object, &["details", "worldName"]),
    ]);
    let group_name = first_owned([
        object_string(object, "groupName"),
        nested_object_string(object, &["details", "groupName"]),
    ]);
    let display_location = resolved_display_location(&location, &world_name, &group_name);
    if !display_location.is_empty() {
        object.insert("displayLocation".into(), Value::String(display_location));
    }
}

fn object_string(object: &serde_json::Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn nested_object_string(object: &serde_json::Map<String, Value>, path: &[&str]) -> String {
    let Some((first, rest)) = path.split_first() else {
        return String::new();
    };
    let Some(mut current) = object.get(*first) else {
        return String::new();
    };
    for key in rest {
        let Some(next) = current.get(*key) else {
            return String::new();
        };
        current = next;
    }
    current
        .as_str()
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn first_world_id<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .map(|value| world_id_from_location_or_id(&value))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

pub fn world_id_from_location_or_id(value: &str) -> String {
    world_id_from_location(value)
}

fn first_owned<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}
