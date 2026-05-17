#![allow(non_snake_case)]
#![allow(unused_imports)]

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::domain_support::*;
use crate::Error;

use super::{ensure_game_log_tables, write_batch as write_game_log_batch};
use super::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry,
    GameLogLocationTimeUpdate, GameLogPortalSpawnEntry, GameLogQueryInput,
    GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};

pub fn app__game_log_entries_add(
    db: &DatabaseService,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), Error> {
    let batch = game_log_batch_for_kind(&kind, entries);
    write_game_log_batch(db, &batch)?;
    Ok(())
}

pub fn app__game_log_instance_delete_by_location(
    db: &DatabaseService,
    location: String,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    db.execute_non_query(
        "DELETE FROM gamelog_location WHERE location = @location",
        &ParamsBuilder::new()
            .set("location", normalize_text(location))
            .build(),
    )
}

pub fn app__game_log_instance_delete(
    db: &DatabaseService,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    let location = normalize_text(location);
    let event_ids: Vec<i64> = event_ids.into_iter().filter(|value| *value > 0).collect();
    if event_ids.is_empty() {
        return Ok(0);
    }
    let mut params = ParamsBuilder::new().set("location", location);
    let mut placeholders = Vec::with_capacity(event_ids.len());
    for (index, event_id) in event_ids.iter().enumerate() {
        let key = format!("event_id_{index}");
        params = params.set(&key, *event_id);
        placeholders.push(format!("@{key}"));
    }
    db.execute_non_query(
        &format!(
            "DELETE FROM gamelog_join_leave WHERE (location = @location) AND (id IN ({}))",
            placeholders.join(", ")
        ),
        &params.build(),
    )
}

pub fn app__game_log_entry_delete(
    db: &DatabaseService,
    kind: String,
    entry: Value,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    let row_id = value_as_i64(
        object_field(&entry, "rowId")
            .or_else(|| object_field(&entry, "id"))
            .unwrap_or(&Value::Null),
    );
    let (table_name, fallback_column, fallback_value) = match kind.as_str() {
        "VideoPlay" => (
            "gamelog_video_play",
            "video_url",
            object_field_string(&entry, &["videoUrl", "video_url"]),
        ),
        "Event" => (
            "gamelog_event",
            "data",
            object_field_string(&entry, &["data"]),
        ),
        "External" => (
            "gamelog_external",
            "message",
            object_field_string(&entry, &["message"]),
        ),
        "StringLoad" | "ImageLoad" | "ResourceLoad" => (
            "gamelog_resource_load",
            "resource_url",
            object_field_string(&entry, &["resourceUrl", "resource_url"]),
        ),
        _ => return Ok(0),
    };
    if row_id > 0 {
        return db.execute_non_query(
            &format!("DELETE FROM {table_name} WHERE id = @id"),
            &ParamsBuilder::new().set("id", row_id).build(),
        );
    }
    db.execute_non_query(
        &format!("DELETE FROM {table_name} WHERE created_at = @created_at AND {fallback_column} = @fallback_value"),
        &ParamsBuilder::new()
            .set("created_at", object_field_string(&entry, &["created_at", "createdAt"]))
            .set("fallback_value", fallback_value)
        .build(),
    )
}

pub fn app__game_log_query(db: &DatabaseService, query: GameLogQueryInput) -> Result<Value, Error> {
    ensure_game_log_tables(db)?;
    let params = query.params.into_value();
    let kind = normalize_text(&query.kind);
    match kind.as_str() {
        "recentDatabase" => {
            let date_offset = query_param_string(&params, "dateOffset");
            let limit = query_param_i64(&params, "maxTableSize", 500);
            let mut rows = Vec::new();
            for row in db.execute(
                "SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_location
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in db.execute(
                "SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_join_leave
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in db.execute(
                "SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_portal_spawn
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in db.execute(
                "SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message
                 FROM gamelog_video_play
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in db.execute(
                "SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message
                 FROM gamelog_resource_load
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in db.execute(
                "SELECT id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message
                 FROM gamelog_event
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset.clone())
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            for row in db.execute(
                "SELECT id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message
                 FROM gamelog_external
                 WHERE created_at >= date(@date_offset)
                 ORDER BY id DESC
                 LIMIT @limit",
                &ParamsBuilder::new()
                    .set("date_offset", date_offset)
                    .set("limit", limit)
                    .build(),
            )? {
                rows.push(game_log_row_from_unified_row(&row));
            }
            rows.sort_by(|left, right| {
                let left_date = left
                    .get("created_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let right_date = right
                    .get("created_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                left_date.cmp(right_date)
            });
            if rows.len() > limit as usize {
                rows.drain(0..rows.len() - limit as usize);
            }
            Ok(Value::Array(rows))
        }
        "rowsByLocation" | "lookupRows" | "searchRows" => {
            let mode = kind.as_str();
            let include_extra = mode != "rowsByLocation";
            let filters = query_param_string_array(&params, "filters");
            let flags = game_log_filter_flags(&filters, include_extra);
            let vip_list = query_param_string_array(&params, "vipList");
            let mut db_params = HashMap::new();
            let max_entries = query_param_i64(&params, "maxEntries", 500);
            db_params.insert("@limit".into(), Value::from(max_entries));
            db_params.insert("@per_table".into(), Value::from(max_entries));
            let vip_placeholders = add_list_params(&mut db_params, &vip_list, "vip");
            let vip_query = if vip_placeholders.is_empty() {
                String::new()
            } else {
                format!("AND user_id IN ({})", vip_placeholders.join(", "))
            };
            let mut selects = Vec::new();

            if mode == "rowsByLocation" {
                let instance_id = query_param_string(&params, "instanceId");
                db_params.insert(
                    "@location_like".into(),
                    Value::String(format!("%{instance_id}%")),
                );
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(query_param_string(&params, "currentUserId")),
                );
                if flags.location {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_location WHERE location LIKE @location_like ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_join_leave WHERE (location LIKE @location_like AND user_id != @current_user_id) {vip_query} {query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.portalspawn {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_portal_spawn WHERE location LIKE @location_like {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.videoplay {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type FROM gamelog_video_play WHERE location LIKE @location_like {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type FROM gamelog_resource_load WHERE location LIKE @location_like {check_string} {check_image} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
            } else if mode == "lookupRows" {
                if flags.location {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_location ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_join_leave WHERE 1=1 {vip_query} {query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.portalspawn {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_portal_spawn WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.event {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message FROM gamelog_event ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.external {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message FROM gamelog_external WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.videoplay {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_video_play WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message FROM gamelog_resource_load WHERE 1=1 {check_string} {check_image} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
            } else {
                let search = query_param_string(&params, "search");
                db_params.insert("@search_like".into(), Value::String(format!("%{search}%")));
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(query_param_string(&params, "currentUserId")),
                );
                if flags.location {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_location WHERE (world_name LIKE @search_like OR group_name LIKE @search_like) ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_join_leave WHERE ((display_name LIKE @search_like OR user_id LIKE @search_like) AND user_id != @current_user_id) {vip_query} {query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.portalspawn {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_portal_spawn WHERE (display_name LIKE @search_like OR user_id LIKE @search_like OR world_name LIKE @search_like) {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.event {
                    selects.push(
                        "SELECT * FROM (SELECT id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message FROM gamelog_event WHERE data LIKE @search_like ORDER BY id DESC LIMIT @per_table)".to_string()
                    );
                }
                if flags.external {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message FROM gamelog_external WHERE (display_name LIKE @search_like OR user_id LIKE @search_like OR message LIKE @search_like) {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.videoplay {
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message FROM gamelog_video_play WHERE (video_url LIKE @search_like OR video_name LIKE @search_like OR display_name LIKE @search_like OR user_id LIKE @search_like) {vip_query} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(format!(
                        "SELECT * FROM (SELECT id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message FROM gamelog_resource_load WHERE resource_url LIKE @search_like {check_string} {check_image} ORDER BY id DESC LIMIT @per_table)"
                    ));
                }
            }

            if selects.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            Ok(Value::Array(
                db.execute(
                    &format!(
                        "SELECT {} FROM ({}) ORDER BY created_at DESC, id DESC LIMIT @limit",
                        game_log_base_columns(include_extra),
                        selects.join(" UNION ALL ")
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| game_log_row_from_unified_row(&row))
                .collect(),
            ))
        }
        "lastVisit" => {
            let world_id = query_param_string(&params, "worldId");
            let count = if query_param_bool(&params, "currentWorldMatch") {
                2
            } else {
                1
            };
            let row = db
                .execute(
                    "SELECT created_at, world_id FROM gamelog_location WHERE world_id = @world_id ORDER BY id DESC LIMIT @count",
                    &ParamsBuilder::new()
                        .set("world_id", world_id)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(row
                .map(|row| json!({ "created_at": row_json(&row, 0), "worldId": row_json(&row, 1) }))
                .unwrap_or_else(|| json!({ "created_at": "", "worldId": "" })))
        }
        "visitCount" => {
            let world_id = query_param_string(&params, "worldId");
            let count = db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_location WHERE world_id = @world_id",
                    &ParamsBuilder::new().set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "visitCount": count, "worldId": world_id }))
        }
        "timeSpentInWorld" => {
            let world_id = query_param_string(&params, "worldId");
            let time_spent = db
                .execute(
                    "SELECT COALESCE(SUM(time), 0) FROM gamelog_location WHERE world_id = @world_id",
                    &ParamsBuilder::new().set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "timeSpent": time_spent, "worldId": world_id }))
        }
        "lastGroupVisit" => {
            let group_id = query_param_string(&params, "groupId");
            let created_at = db
                .execute(
                    "SELECT created_at FROM gamelog_location WHERE location LIKE @group_id ORDER BY id DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("group_id", format!("%{group_id}%"))
                        .build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(json!({ "created_at": created_at }))
        }
        "previousInstancesByGroupId" => {
            let group_id = query_param_string(&params, "groupId");
            let mut by_location = HashMap::<String, Value>::new();
            let mut location_order = Vec::<String>::new();
            for row in db.execute(
                "SELECT created_at, location, time, world_name, group_name
                 FROM gamelog_location
                 WHERE location LIKE @group_id
                 ORDER BY id DESC",
                &ParamsBuilder::new()
                    .set("group_id", format!("%{group_id}%"))
                    .build(),
            )? {
                let location = row_string(&row, 1);
                if !by_location.contains_key(&location) {
                    location_order.push(location.clone());
                }
                let time = row_i64(&row, 2)
                    + by_location
                        .get(&location)
                        .and_then(|value| value.get("time"))
                        .map(value_as_i64)
                        .unwrap_or(0);
                by_location.insert(
                    location.clone(),
                    json!({
                        "created_at": row_json(&row, 0),
                        "location": location,
                        "time": time,
                        "worldName": row_json(&row, 3),
                        "groupName": row_json(&row, 4)
                    }),
                );
            }
            Ok(Value::Array(
                location_order
                    .into_iter()
                    .filter_map(|location| by_location.remove(&location))
                    .collect(),
            ))
        }
        "lastSeen" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = if query_param_bool(&params, "inCurrentWorld") {
                2
            } else {
                1
            };
            let row = db
                .execute(
                    "SELECT created_at, user_id FROM gamelog_join_leave WHERE user_id = @user_id OR display_name = @display_name ORDER BY id DESC LIMIT @count",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(row
                .map(|row| {
                    let row_user_id = row_string(&row, 1);
                    json!({
                        "created_at": row_json(&row, 0),
                        "userId": if row_user_id.is_empty() { user_id } else { row_user_id }
                    })
                })
                .unwrap_or_else(|| json!({ "created_at": "", "userId": "" })))
        }
        "joinCount" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_join_leave WHERE (type = 'OnPlayerJoined') AND (user_id = @user_id OR display_name = @display_name)",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "joinCount": count, "userId": user_id }))
        }
        "timeSpent" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let time_spent = db
                .execute(
                    "SELECT COALESCE(SUM(time), 0)
                     FROM gamelog_join_leave
                     WHERE type = 'OnPlayerLeft'
                       AND (user_id = @user_id OR display_name = @display_name)",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "timeSpent": time_spent, "userId": user_id }))
        }
        "userStats" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = if query_param_bool(&params, "inCurrentWorld") {
                2
            } else {
                1
            };
            let last_seen = db
                .execute(
                    "SELECT created_at FROM gamelog_join_leave WHERE user_id = @user_id OR display_name = @display_name ORDER BY id DESC LIMIT @count",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .set("count", count)
                        .build(),
                )?
                .last()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            let stats = db
                .execute(
                    "SELECT
                        COALESCE(SUM(CASE WHEN type = 'OnPlayerLeft' THEN time ELSE 0 END), 0),
                        COUNT(DISTINCT NULLIF(location, ''))
                     FROM gamelog_join_leave
                     WHERE user_id = @user_id OR display_name = @display_name",
                    &ParamsBuilder::new()
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .build(),
                )?
                .first()
                .cloned();
            let mut previous_names = Vec::new();
            for row in db.execute(
                "SELECT display_name, MAX(created_at)
                 FROM gamelog_join_leave
                 WHERE user_id = @user_id
                   AND display_name != ''
                   AND display_name != @display_name
                 GROUP BY display_name
                 ORDER BY MAX(created_at) DESC",
                &ParamsBuilder::new()
                    .set("user_id", user_id.clone())
                    .set("display_name", display_name)
                    .build(),
            )? {
                previous_names.push(json!({
                    "displayName": row_json(&row, 0),
                    "created_at": row_json(&row, 1)
                }));
            }
            Ok(json!({
                "timeSpent": stats.as_ref().map(|row| row_i64(row, 0)).unwrap_or(0),
                "lastSeen": last_seen,
                "joinCount": stats.as_ref().map(|row| row_i64(row, 1)).unwrap_or(0),
                "userId": user_id,
                "previousDisplayNames": previous_names
            }))
        }
        "allUserStats" => {
            let user_ids = query_param_string_array(&params, "userIds");
            let display_names = query_param_string_array(&params, "displayNames");
            if user_ids.is_empty() && display_names.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let mut db_params = HashMap::new();
            let mut clauses = Vec::new();
            let user_placeholders = add_list_params(&mut db_params, &user_ids, "stat_user_id");
            if !user_placeholders.is_empty() {
                clauses.push(format!("g.user_id IN ({})", user_placeholders.join(", ")));
            }
            let name_placeholders =
                add_list_params(&mut db_params, &display_names, "stat_display_name");
            if !name_placeholders.is_empty() {
                clauses.push(format!(
                    "g.display_name IN ({})",
                    name_placeholders.join(", ")
                ));
            }
            Ok(Value::Array(
                db.execute(
                    &format!(
                        "SELECT
                                g.created_at,
                                g.user_id,
                                SUM(g.time) AS timeSpent,
                                COUNT(DISTINCT g.location) AS joinCount,
                                g.display_name,
                                MAX(g.id) AS max_id
                            FROM
                                gamelog_join_leave g
                            WHERE
                                {}
                            GROUP BY
                                g.user_id,
                                g.display_name
                            ORDER BY
                                g.user_id DESC",
                        clauses.join("\n                OR ")
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "lastSeen": row_json(&row, 0),
                        "userId": row_json(&row, 1),
                        "timeSpent": row_json(&row, 2),
                        "joinCount": row_json(&row, 3),
                        "displayName": row_json(&row, 4)
                    })
                })
                .collect(),
            ))
        }
        "lastDate" => {
            let mut dates = Vec::new();
            for table in [
                "gamelog_location",
                "gamelog_join_leave",
                "gamelog_portal_spawn",
                "gamelog_event",
                "gamelog_video_play",
                "gamelog_resource_load",
            ] {
                if let Some(date) = db
                    .execute(
                        &format!("SELECT created_at FROM {table} ORDER BY id DESC LIMIT 1"),
                        &Default::default(),
                    )?
                    .first()
                    .map(|row| row_string(row, 0))
                    .filter(|value| !value.is_empty())
                {
                    dates.push(date);
                }
            }
            dates.sort();
            Ok(Value::String(dates.pop().unwrap_or_default()))
        }
        "previousInstancesByUserIdRows" => {
            let user_id = query_param_string(&params, "userId");
            if user_id.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            Ok(Value::Array(
                db
                    .execute(
                        "WITH grouped_locations AS (
                            SELECT DISTINCT location, world_name, group_name
                            FROM gamelog_location
                        )
                        SELECT gamelog_join_leave.created_at,
                               strftime('%s', gamelog_join_leave.created_at) * 1000 created_at_ts,
                               gamelog_join_leave.location,
                               gamelog_join_leave.time,
                               grouped_locations.world_name,
                               grouped_locations.group_name,
                               gamelog_join_leave.id,
                               gamelog_join_leave.type
                        FROM gamelog_join_leave
                        INNER JOIN grouped_locations ON gamelog_join_leave.location = grouped_locations.location
                        WHERE user_id = @user_id
                        ORDER BY gamelog_join_leave.id ASC",
                        &ParamsBuilder::new().set("user_id", user_id).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "created_at": row_json(&row, 0),
                            "createdAtTs": row_json(&row, 1),
                            "location": row_json(&row, 2),
                            "time": row_json(&row, 3),
                            "worldName": row_json(&row, 4),
                            "groupName": row_json(&row, 5),
                            "eventId": row_json(&row, 6),
                            "eventType": row_json(&row, 7)
                        })
                    })
                    .collect(),
            ))
        }
        "previousInstancesByWorldId" => {
            let world_id = query_param_string(&params, "worldId");
            Ok(Value::Array(
                db.execute(
                    "SELECT id, created_at, location, time, world_name, group_name
                         FROM gamelog_location
                         WHERE world_id = @world_id
                         ORDER BY id DESC",
                    &ParamsBuilder::new().set("world_id", world_id).build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row_json(&row, 0),
                        "created_at": row_json(&row, 1),
                        "location": row_json(&row, 2),
                        "time": row_i64(&row, 3),
                        "worldName": row_json(&row, 4),
                        "groupName": row_json(&row, 5)
                    })
                })
                .collect(),
            ))
        }
        "playersFromInstanceRows" => {
            let location = query_param_string(&params, "location");
            Ok(Value::Array(
                db
                    .execute(
                        "SELECT id, created_at, display_name, user_id, time, type FROM gamelog_join_leave WHERE location = @location ORDER BY id ASC",
                        &ParamsBuilder::new().set("location", location).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "rowId": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "displayName": row_json(&row, 2),
                            "userId": row_json(&row, 3),
                            "time": row_i64(&row, 4),
                            "type": row_json(&row, 5)
                        })
                    })
                    .collect(),
            ))
        }
        "locationBeforeOrAt" => {
            let created_at = query_param_string(&params, "createdAt");
            let row = db
                .execute(
                    "SELECT created_at, location, world_id, world_name, group_name
                     FROM gamelog_location
                     WHERE created_at <= @created_at
                     ORDER BY created_at DESC
                     LIMIT 1",
                    &ParamsBuilder::new().set("created_at", created_at).build(),
                )?
                .first()
                .cloned();
            Ok(row
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "location": row_json(&row, 1),
                        "worldId": row_json(&row, 2),
                        "worldName": row_json(&row, 3),
                        "groupName": row_json(&row, 4)
                    })
                })
                .unwrap_or(Value::Null))
        }
        "joinLeaveRange" => {
            let location = query_param_string(&params, "location");
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at, type, display_name, user_id
                         FROM gamelog_join_leave
                         WHERE location = @location
                           AND created_at >= @after_date
                           AND created_at <= @before_date
                         ORDER BY created_at ASC",
                    &ParamsBuilder::new()
                        .set("location", location)
                        .set("after_date", after_date)
                        .set("before_date", before_date)
                        .build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "type": row_json(&row, 1),
                        "displayName": row_json(&row, 2),
                        "userId": row_json(&row, 3)
                    })
                })
                .collect(),
            ))
        }
        "playerDetailFromInstance" => {
            let location = query_param_string(&params, "location");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at, display_name, user_id, time
                         FROM gamelog_join_leave
                         WHERE location = @location AND type = 'OnPlayerLeft'
                         ORDER BY created_at ASC",
                    &ParamsBuilder::new().set("location", location).build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "display_name": row_json(&row, 1),
                        "user_id": row_json(&row, 2),
                        "time": row_i64(&row, 3)
                    })
                })
                .collect(),
            ))
        }
        "previousDisplayNamesByUserId" => {
            let user_id = query_param_string(&params, "userId");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at, display_name
                         FROM gamelog_join_leave
                         WHERE user_id = @user_id
                         ORDER BY id DESC",
                    &ParamsBuilder::new().set("user_id", user_id).build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "displayName": row_json(&row, 1)
                    })
                })
                .collect(),
            ))
        }
        "instanceTimes" => Ok(Value::Array(
            db.execute(
                "SELECT location, time FROM gamelog_location",
                &Default::default(),
            )?
            .into_iter()
            .map(|row| json!({ "location": row_json(&row, 0), "time": row_i64(&row, 1) }))
            .collect(),
        )),
        "onlineSessions" => {
            let from_date = query_param_string(&params, "fromDate");
            let to_date = query_param_string(&params, "toDate");
            let mut rows = Vec::new();
            if !from_date.is_empty() {
                if let Some(row) = db
                    .execute(
                        "SELECT created_at, time FROM gamelog_location WHERE created_at < @from_date ORDER BY created_at DESC LIMIT 1",
                        &ParamsBuilder::new().set("from_date", from_date.clone()).build(),
                    )?
                    .first()
                    .cloned()
                {
                    rows.push(json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }));
                }
            }
            let mut clauses = Vec::new();
            let mut db_params = HashMap::new();
            if !from_date.is_empty() {
                clauses.push("created_at >= @from_date");
                db_params.insert("@from_date".into(), Value::String(from_date));
            }
            if !to_date.is_empty() {
                clauses.push("created_at < @to_date");
                db_params.insert("@to_date".into(), Value::String(to_date));
            }
            let date_clause = if clauses.is_empty() {
                String::new()
            } else {
                format!("WHERE {}", clauses.join(" AND "))
            };
            for row in db.execute(
                &format!("SELECT created_at, time FROM gamelog_location {date_clause} ORDER BY created_at"),
                &db_params,
            )? {
                rows.push(json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }));
            }
            Ok(Value::Array(rows))
        }
        "onlineSessionsAfter" => {
            let after = query_param_string(&params, "afterCreatedAt");
            let op = if query_param_bool(&params, "inclusive") {
                ">="
            } else {
                ">"
            };
            Ok(Value::Array(
                db
                    .execute(
                        &format!("SELECT created_at, time FROM gamelog_location WHERE created_at {op} @after ORDER BY created_at"),
                        &ParamsBuilder::new().set("after", after).build(),
                    )?
                    .into_iter()
                    .map(|row| json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }))
                    .collect(),
            ))
        }
        "topWorlds" => {
            let days = query_param_i64(&params, "days", 0);
            let limit = query_param_i64(&params, "limit", 5);
            let sort_by = query_param_string(&params, "sortBy");
            let exclude_world_id = query_param_string(&params, "excludeWorldId");
            let where_clause = if days > 0 {
                "AND created_at >= datetime('now', @days_offset)"
            } else {
                ""
            };
            let exclude_clause = if exclude_world_id.is_empty() {
                ""
            } else {
                "AND world_id != @exclude_world_id"
            };
            let order_by = if sort_by == "count" {
                "visit_count DESC"
            } else {
                "total_time DESC"
            };
            let mut db_params = HashMap::new();
            db_params.insert("@limit".into(), Value::from(limit));
            if days > 0 {
                db_params.insert(
                    "@days_offset".into(),
                    Value::String(format!("-{days} days")),
                );
            }
            if !exclude_world_id.is_empty() {
                db_params.insert("@exclude_world_id".into(), Value::String(exclude_world_id));
            }
            Ok(Value::Array(
                db
                    .execute(
                        &format!(
                            "SELECT world_id, world_name, COUNT(*) AS visit_count, SUM(time) AS total_time
                             FROM gamelog_location
                             WHERE world_id IS NOT NULL
                               AND world_id != ''
                               AND world_id LIKE 'wrld_%'
                               {where_clause}
                               {exclude_clause}
                             GROUP BY world_id
                             ORDER BY {order_by}
                             LIMIT @limit"
                        ),
                        &db_params,
                    )?
                    .into_iter()
                    .map(|row| {
                        let world_id = row_string(&row, 0);
                        let world_name = row_string(&row, 1);
                        json!({
                            "worldId": world_id,
                            "worldName": if world_name.is_empty() { row_json(&row, 0) } else { row_json(&row, 1) },
                            "visitCount": row_json(&row, 2),
                            "totalTime": row_i64(&row, 3)
                        })
                    })
                    .collect(),
            ))
        }
        "instanceActivityRows" => {
            let start_date = query_param_string(&params, "startDate");
            let end_date = query_param_string(&params, "endDate");
            Ok(Value::Array(
                db
                    .execute(
                        "SELECT id, created_at, type, display_name, location, user_id, time
                         FROM gamelog_join_leave
                         WHERE type = 'OnPlayerLeft'
                           AND (
                             strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '-' || (time * 1.0 / 1000) || ' seconds') BETWEEN @utc_start_date AND @utc_end_date
                             OR created_at BETWEEN @utc_start_date AND @utc_end_date
                           )",
                        &ParamsBuilder::new()
                            .set("utc_start_date", start_date)
                            .set("utc_end_date", end_date)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "id": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "type": row_json(&row, 2),
                            "display_name": row_json(&row, 3),
                            "location": row_json(&row, 4),
                            "user_id": row_json(&row, 5),
                            "time": row_json(&row, 6)
                        })
                    })
                    .collect(),
            ))
        }
        "dateOfInstanceActivity" => {
            let user_id = query_param_string(&params, "userId");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at FROM gamelog_join_leave WHERE user_id = @user_id",
                    &ParamsBuilder::new().set("user_id", user_id).build(),
                )?
                .into_iter()
                .map(|row| row_json(&row, 0))
                .collect(),
            ))
        }
        "instanceJoinHistory" => {
            let user_id = query_param_string(&params, "userId");
            let created_at = query_param_string(&params, "createdAt");
            Ok(Value::Array(
                db
                    .execute(
                        "SELECT created_at, location FROM gamelog_join_leave WHERE user_id = @user_id AND created_at > @created_at ORDER BY created_at DESC",
                        &ParamsBuilder::new()
                            .set("user_id", user_id)
                            .set("created_at", created_at)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| json!({ "created_at": row_json(&row, 0), "location": row_json(&row, 1) }))
                    .collect(),
            ))
        }
        "worldNameByWorldId" => {
            let world_id = query_param_string(&params, "worldId");
            let world_name = db
                .execute(
                    "SELECT world_name FROM gamelog_location WHERE world_id = @world_id ORDER BY id DESC LIMIT 1",
                    &ParamsBuilder::new().set("world_id", world_id).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(Value::String(world_name))
        }
        "userIdFromDisplayName" => {
            let display_name = query_param_string(&params, "displayName");
            let user_id = db
                .execute(
                    "SELECT user_id FROM gamelog_join_leave WHERE display_name = @display_name AND user_id != '' ORDER BY id DESC LIMIT 1",
                    &ParamsBuilder::new().set("display_name", display_name).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(Value::String(user_id))
        }
        "sessionsLocationSegments" => {
            let before_id = params
                .get("beforeId")
                .filter(|value| !value.is_null())
                .map(value_as_i64)
                .filter(|value| *value > 0);
            let limit = query_param_i64(&params, "limit", 100);
            let cursor_clause = if before_id.is_some() {
                "AND id < @before_id"
            } else {
                ""
            };
            let mut db_params = HashMap::new();
            db_params.insert("@limit".into(), Value::from(limit));
            if let Some(before_id) = before_id {
                db_params.insert("@before_id".into(), Value::from(before_id));
            }
            Ok(Value::Array(
                db.execute(
                    &format!(
                        "SELECT id, created_at, location, world_id, world_name, time, group_name
                             FROM gamelog_location
                             WHERE 1=1 {cursor_clause}
                             ORDER BY id DESC
                             LIMIT @limit"
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| game_log_location_segment_from_row(&row))
                .collect(),
            ))
        }
        "sessionsLocationSegmentsByDateRange" => {
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            let limit = query_param_i64(&params, "limit", 100);
            Ok(Value::Array(
                db.execute(
                    "SELECT id, created_at, location, world_id, world_name, time, group_name
                         FROM gamelog_location
                         WHERE created_at >= @after_date
                           AND created_at <= @before_date
                         ORDER BY id DESC
                         LIMIT @limit",
                    &ParamsBuilder::new()
                        .set("after_date", after_date)
                        .set("before_date", before_date)
                        .set("limit", limit)
                        .build(),
                )?
                .into_iter()
                .map(|row| game_log_location_segment_from_row(&row))
                .collect(),
            ))
        }
        "sessionsEventsForSegments" => {
            let location_tags = query_param_string_array(&params, "locationTags");
            if location_tags.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            let current_user_id = query_param_string(&params, "currentUserId");
            let mut db_params = HashMap::new();
            db_params.insert("@after_date".into(), Value::String(after_date));
            db_params.insert("@before_date".into(), Value::String(before_date));
            db_params.insert("@self_id".into(), Value::String(current_user_id));
            let placeholders = add_list_params(&mut db_params, &location_tags, "location_tag");
            let location_in = placeholders.join(", ");
            let mut rows = Vec::new();
            for row in db.execute(
                &format!(
                    "SELECT type, created_at, display_name, user_id, location
                     FROM gamelog_join_leave
                     WHERE location IN ({location_in})
                       AND user_id != @self_id
                       AND created_at >= @after_date
                       AND created_at <= @before_date
                     ORDER BY created_at ASC"
                ),
                &db_params,
            )? {
                rows.push(json!({
                    "type": row_json(&row, 0),
                    "created_at": row_json(&row, 1),
                    "displayName": row_json(&row, 2),
                    "userId": row_json(&row, 3),
                    "location": row_json(&row, 4)
                }));
            }
            for row in db.execute(
                &format!(
                    "SELECT created_at, video_url, video_name, video_id, display_name, user_id, location
                     FROM gamelog_video_play
                     WHERE location IN ({location_in})
                       AND created_at >= @after_date
                       AND created_at <= @before_date
                     ORDER BY created_at ASC"
                ),
                &db_params,
            )? {
                rows.push(json!({
                    "type": "VideoPlay",
                    "created_at": row_json(&row, 0),
                    "videoUrl": row_json(&row, 1),
                    "videoName": row_json(&row, 2),
                    "videoId": row_json(&row, 3),
                    "displayName": row_json(&row, 4),
                    "userId": row_json(&row, 5),
                    "location": row_json(&row, 6)
                }));
            }
            Ok(Value::Array(rows))
        }
        "sessionsLocationSegmentsByAnchor" => {
            let since_date = query_param_string(&params, "sinceDate");
            let limit = query_param_i64(&params, "limit", 100);
            Ok(Value::Array(
                db.execute(
                    "SELECT id, created_at, location, world_id, world_name, time, group_name
                         FROM gamelog_location
                         WHERE created_at >= @since_date
                         ORDER BY id DESC
                         LIMIT @limit",
                    &ParamsBuilder::new()
                        .set("since_date", since_date)
                        .set("limit", limit)
                        .build(),
                )?
                .into_iter()
                .map(|row| game_log_location_segment_from_row(&row))
                .collect(),
            ))
        }
        _ => Err(Error::Custom(format!(
            "Unknown game log query: {}",
            query.kind
        ))),
    }
}
