use super::*;

pub(crate) fn game_log_row_from_unified_row(row: &[Value]) -> Result<Value, Error> {
    let event_type = strict_row_string(row, 2)?;
    let mut object = serde_json::Map::new();
    object.insert("rowId".into(), strict_row_json(row, 0)?);
    object.insert("created_at".into(), strict_row_json(row, 1)?);
    object.insert("type".into(), Value::String(event_type.clone()));
    match event_type.as_str() {
        "Location" => {
            object.insert("location".into(), strict_row_json(row, 4)?);
            object.insert("worldId".into(), strict_row_json(row, 7)?);
            object.insert("worldName".into(), strict_row_json(row, 8)?);
            object.insert("time".into(), strict_row_json(row, 6)?);
            object.insert("groupName".into(), strict_row_json(row, 9)?);
        }
        "OnPlayerJoined" | "OnPlayerLeft" => {
            object.insert("displayName".into(), strict_row_json(row, 3)?);
            object.insert("location".into(), strict_row_json(row, 4)?);
            object.insert("userId".into(), strict_row_json(row, 5)?);
            object.insert("time".into(), strict_row_json(row, 6)?);
        }
        "PortalSpawn" => {
            object.insert("displayName".into(), strict_row_json(row, 3)?);
            object.insert("location".into(), strict_row_json(row, 4)?);
            object.insert("userId".into(), strict_row_json(row, 5)?);
            object.insert("instanceId".into(), strict_row_json(row, 10)?);
            object.insert("worldName".into(), strict_row_json(row, 8)?);
        }
        "VideoPlay" => {
            object.insert("videoUrl".into(), strict_row_json(row, 11)?);
            object.insert("videoName".into(), strict_row_json(row, 12)?);
            object.insert("videoId".into(), strict_row_json(row, 13)?);
            object.insert("location".into(), strict_row_json(row, 4)?);
            object.insert("displayName".into(), strict_row_json(row, 3)?);
            object.insert("userId".into(), strict_row_json(row, 5)?);
        }
        "Event" => {
            object.insert("data".into(), strict_row_json(row, 16)?);
        }
        "External" => {
            object.insert("message".into(), strict_row_json(row, 17)?);
            object.insert("displayName".into(), strict_row_json(row, 3)?);
            object.insert("userId".into(), strict_row_json(row, 5)?);
            object.insert("location".into(), strict_row_json(row, 4)?);
        }
        "StringLoad" | "ImageLoad" => {
            object.insert("resourceUrl".into(), strict_row_json(row, 14)?);
            object.insert("location".into(), strict_row_json(row, 4)?);
        }
        _ => {}
    }
    Ok(Value::Object(object))
}

pub(crate) fn game_log_location_segment_from_row(row: &[Value]) -> Result<Value, Error> {
    Ok(json!({
        "id": strict_row_json(row, 0)?,
        "created_at": strict_row_json(row, 1)?,
        "location": strict_row_json(row, 2)?,
        "worldId": strict_row_json(row, 3)?,
        "worldName": strict_row_json(row, 4)?,
        "time": strict_row_json(row, 5)?,
        "groupName": strict_row_json(row, 6)?
    }))
}

pub(crate) fn game_log_base_columns(include_extra: bool) -> &'static str {
    if include_extra {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type, data, message"
    } else {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type"
    }
}

#[derive(Default)]
pub(crate) struct GameLogFilterFlags {
    pub(crate) location: bool,
    pub(crate) onplayerjoined: bool,
    pub(crate) onplayerleft: bool,
    pub(crate) portalspawn: bool,
    pub(crate) event: bool,
    pub(crate) external: bool,
    pub(crate) videoplay: bool,
    pub(crate) stringload: bool,
    pub(crate) imageload: bool,
}

pub(crate) fn game_log_filter_flags(filters: &[String], include_extra: bool) -> GameLogFilterFlags {
    let mut flags = GameLogFilterFlags {
        location: true,
        onplayerjoined: true,
        onplayerleft: true,
        portalspawn: true,
        event: include_extra,
        external: include_extra,
        videoplay: true,
        stringload: true,
        imageload: true,
    };
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return flags;
    }
    flags = GameLogFilterFlags::default();
    for filter in filters {
        match filter.as_str() {
            "Location" => flags.location = true,
            "OnPlayerJoined" => flags.onplayerjoined = true,
            "OnPlayerLeft" => flags.onplayerleft = true,
            "PortalSpawn" => flags.portalspawn = true,
            "Event" if include_extra => flags.event = true,
            "External" if include_extra => flags.external = true,
            "VideoPlay" => flags.videoplay = true,
            "StringLoad" => flags.stringload = true,
            "ImageLoad" => flags.imageload = true,
            _ => {}
        }
    }
    flags
}

pub(crate) fn game_log_batch_for_kind(
    kind: &str,
    entries: Vec<Value>,
) -> Result<GameLogWriteBatch, Error> {
    let mut batch = GameLogWriteBatch::default();
    match kind {
        "Location" => {
            batch.locations = entries
                .into_iter()
                .map(|entry| GameLogLocationEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    location: object_field_string(&entry, &["location"]),
                    world_id: object_field_string(&entry, &["worldId", "world_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                    group_name: object_field_string(&entry, &["groupName", "group_name"]),
                })
                .collect();
        }
        "LocationTime" => {
            batch.location_time_updates = entries
                .into_iter()
                .map(|entry| GameLogLocationTimeUpdate {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                })
                .collect();
        }
        "JoinLeave" => {
            batch.join_leave = entries
                .into_iter()
                .map(|entry| GameLogJoinLeaveEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    event_type: object_field_string(&entry, &["type", "eventType"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    location: object_field_string(&entry, &["location"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                })
                .collect();
        }
        "PortalSpawn" => {
            batch.portal_spawns = entries
                .into_iter()
                .map(|entry| GameLogPortalSpawnEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    location: object_field_string(&entry, &["location"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    instance_id: object_field_string(&entry, &["instanceId", "instance_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                })
                .collect();
        }
        "VideoPlay" => {
            batch.video_plays = entries
                .into_iter()
                .map(|entry| GameLogVideoPlayEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    video_url: object_field_string(&entry, &["videoUrl", "video_url"]),
                    video_name: object_field_string(&entry, &["videoName", "video_name"]),
                    video_id: object_field_string(&entry, &["videoId", "video_id"]),
                    location: object_field_string(&entry, &["location"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                })
                .collect();
        }
        "ResourceLoad" | "StringLoad" | "ImageLoad" => {
            batch.resource_loads = entries
                .into_iter()
                .map(|entry| GameLogResourceLoadEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    resource_url: object_field_string(&entry, &["resourceUrl", "resource_url"]),
                    resource_type: object_field_string(
                        &entry,
                        &["type", "resourceType", "resource_type"],
                    ),
                    location: object_field_string(&entry, &["location"]),
                })
                .collect();
        }
        "Event" => {
            batch.events = entries
                .into_iter()
                .map(|entry| GameLogEventEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    data: object_field_string(&entry, &["data"]),
                })
                .collect();
        }
        "External" => {
            batch.externals = entries
                .into_iter()
                .map(|entry| GameLogExternalEntry {
                    created_at: object_field_string(&entry, &["created_at", "createdAt"]),
                    message: object_field_string(&entry, &["message"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    location: object_field_string(&entry, &["location"]),
                })
                .collect();
        }
        _ => {
            return Err(Error::InvalidData(format!(
                "Unknown game log entry kind: {kind}"
            )));
        }
    }
    Ok(batch)
}
