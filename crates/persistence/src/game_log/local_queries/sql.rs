use super::*;

pub(super) struct GameLogRecentDescriptor {
    table: &'static str,
    projection: &'static str,
}

pub(super) const GAME_LOG_RECENT_DESCRIPTORS: &[GameLogRecentDescriptor] = &[
    GameLogRecentDescriptor {
        table: "gamelog_location",
        projection: "id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message",
    },
    GameLogRecentDescriptor {
        table: "gamelog_join_leave",
        projection: "id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message",
    },
    GameLogRecentDescriptor {
        table: "gamelog_portal_spawn",
        projection: "id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message",
    },
    GameLogRecentDescriptor {
        table: "gamelog_video_play",
        projection: "id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, NULL AS message",
    },
    GameLogRecentDescriptor {
        table: "gamelog_resource_load",
        projection: "id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type, NULL AS data, NULL AS message",
    },
    GameLogRecentDescriptor {
        table: "gamelog_event",
        projection: "id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, data, NULL AS message",
    },
    GameLogRecentDescriptor {
        table: "gamelog_external",
        projection: "id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type, NULL AS data, message",
    },
];

const GAME_LOG_LOCATION_BASE_PROJECTION: &str = "id, created_at, 'Location' AS type, NULL AS display_name, location, NULL AS user_id, time, world_id, world_name, group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type";
const GAME_LOG_JOIN_LEAVE_BASE_PROJECTION: &str = "id, created_at, type, display_name, location, user_id, time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type";
const GAME_LOG_PORTAL_SPAWN_BASE_PROJECTION: &str = "id, created_at, 'PortalSpawn' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, world_name, NULL AS group_name, instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type";
const GAME_LOG_EVENT_BASE_PROJECTION: &str = "id, created_at, 'Event' AS type, NULL AS display_name, NULL AS location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type";
const GAME_LOG_EXTERNAL_BASE_PROJECTION: &str = "id, created_at, 'External' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, NULL AS resource_url, NULL AS resource_type";
const GAME_LOG_VIDEO_PLAY_BASE_PROJECTION: &str = "id, created_at, 'VideoPlay' AS type, display_name, location, user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, video_url, video_name, video_id, NULL AS resource_url, NULL AS resource_type";
const GAME_LOG_RESOURCE_LOAD_BASE_PROJECTION: &str = "id, created_at, resource_type AS type, NULL AS display_name, location, NULL AS user_id, NULL AS time, NULL AS world_id, NULL AS world_name, NULL AS group_name, NULL AS instance_id, NULL AS video_url, NULL AS video_name, NULL AS video_id, resource_url, resource_type";

pub(super) fn game_log_recent_select_sql(descriptor: &GameLogRecentDescriptor) -> String {
    format!(
        "SELECT {} FROM {} WHERE owner_id IN (0, @owner_id) AND created_at >= date(@date_offset) ORDER BY id DESC LIMIT @limit",
        descriptor.projection, descriptor.table
    )
}

fn game_log_union_projection(
    base_projection: &str,
    include_extra: bool,
    data_expr: &str,
    message_expr: &str,
) -> String {
    if include_extra {
        format!("{base_projection}, {data_expr} AS data, {message_expr} AS message")
    } else {
        base_projection.to_string()
    }
}

fn game_log_union_select_sql(
    table: &str,
    base_projection: &str,
    where_sql: &str,
    include_extra: bool,
    data_expr: &str,
    message_expr: &str,
) -> String {
    let projection =
        game_log_union_projection(base_projection, include_extra, data_expr, message_expr);
    format!(
        "SELECT * FROM (SELECT {projection} FROM {table} WHERE owner_id IN (0, @owner_id) AND ({where_sql}) ORDER BY id DESC LIMIT @per_table)"
    )
}

pub(super) fn game_log_location_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_location",
        GAME_LOG_LOCATION_BASE_PROJECTION,
        where_sql,
        include_extra,
        "NULL",
        "NULL",
    )
}

pub(super) fn game_log_join_leave_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_join_leave",
        GAME_LOG_JOIN_LEAVE_BASE_PROJECTION,
        where_sql,
        include_extra,
        "NULL",
        "NULL",
    )
}

pub(super) fn game_log_portal_spawn_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_portal_spawn",
        GAME_LOG_PORTAL_SPAWN_BASE_PROJECTION,
        where_sql,
        include_extra,
        "NULL",
        "NULL",
    )
}

pub(super) fn game_log_event_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_event",
        GAME_LOG_EVENT_BASE_PROJECTION,
        where_sql,
        include_extra,
        "data",
        "NULL",
    )
}

pub(super) fn game_log_external_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_external",
        GAME_LOG_EXTERNAL_BASE_PROJECTION,
        where_sql,
        include_extra,
        "NULL",
        "message",
    )
}

pub(super) fn game_log_video_play_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_video_play",
        GAME_LOG_VIDEO_PLAY_BASE_PROJECTION,
        where_sql,
        include_extra,
        "NULL",
        "NULL",
    )
}

pub(super) fn game_log_resource_load_union_select(where_sql: &str, include_extra: bool) -> String {
    game_log_union_select_sql(
        "gamelog_resource_load",
        GAME_LOG_RESOURCE_LOAD_BASE_PROJECTION,
        where_sql,
        include_extra,
        "NULL",
        "NULL",
    )
}

pub(super) fn append_i64_in_params(
    mut params: ParamsBuilder,
    values: &[i64],
    prefix: &str,
) -> (ParamsBuilder, Vec<String>) {
    let mut placeholders = Vec::with_capacity(values.len());
    for (index, value) in values.iter().enumerate() {
        let key = format!("{prefix}_{index}");
        params = params.set(&key, *value);
        placeholders.push(key);
    }
    (params, placeholders)
}
