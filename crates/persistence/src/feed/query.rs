#![allow(non_snake_case)]

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::common::{add_list_params, normalize_text, value_as_string};
use crate::database::DatabaseService;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

use super::types::*;

fn query_feed_rows(
    db: &DatabaseService,
    query: &FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, Error> {
    let user_id = normalize_text(&query.user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;

    let mut params = HashMap::new();
    let max_entries = if query.max_entries > 0 {
        query.max_entries
    } else {
        500
    };
    params.insert("@limit".into(), Value::from(max_entries));
    params.insert("@per_table".into(), Value::from(max_entries));
    let has_cursor = query
        .cursor
        .as_ref()
        .filter(|cursor| !cursor.created_at.trim().is_empty() && cursor.row_id > 0)
        .is_some();
    if let Some(cursor) = query
        .cursor
        .as_ref()
        .filter(|cursor| !cursor.created_at.trim().is_empty() && cursor.row_id > 0)
    {
        params.insert(
            "@cursor_created_at".into(),
            Value::String(cursor.created_at.clone()),
        );
        params.insert(
            "@cursor_source_rank".into(),
            Value::from(cursor.source_rank),
        );
        params.insert("@cursor_row_id".into(), Value::from(cursor.row_id));
    }

    let vip_placeholders = add_list_params(&mut params, &query.vip_list, "vip");
    let vip_query = if vip_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id IN ({})", vip_placeholders.join(", "))
    };
    let excluded_placeholders = add_list_params(&mut params, &query.excluded_user_ids, "excluded");
    let excluded_query = if excluded_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id NOT IN ({})", excluded_placeholders.join(", "))
    };
    let user_scope_query = format!("{vip_query} {excluded_query}");

    let mode = normalize_text(&query.mode);
    let search = normalize_text(&query.search);
    let instance_mode = mode == "instance"
        || (mode == "search" && (search.starts_with("wrld_") || search.starts_with("grp_")));
    let recent_order_sql = "created_at DESC, id DESC";
    let flags = feed_filter_flags(&query.filters, !instance_mode);
    let mut selects = Vec::new();

    if instance_mode {
        params.insert(
            "@instance_like".into(),
            Value::String(format!("%{search}%")),
        );
        if flags.gps {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_gps",
                FEED_GPS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_GPS_SOURCE_RANK,
                    where_sql: &format!("location LIKE @instance_like {user_scope_query}"),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            push_feed_online_offline_select(
                &mut selects,
                &user_prefix,
                "location LIKE @instance_like",
                type_filter,
                &user_scope_query,
                has_cursor,
                recent_order_sql,
            );
        }
    } else if mode == "lookup" {
        if flags.gps {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_gps",
                FEED_GPS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_GPS_SOURCE_RANK,
                    where_sql: &format!("1=1 {user_scope_query}"),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.status {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_status",
                FEED_STATUS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_STATUS_SOURCE_RANK,
                    where_sql: &format!("1=1 {user_scope_query}"),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.bio {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_bio",
                FEED_BIO_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_BIO_SOURCE_RANK,
                    where_sql: &format!("1=1 {user_scope_query}"),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.avatar {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_avatar",
                FEED_AVATAR_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_AVATAR_SOURCE_RANK,
                    where_sql: &format!("1=1 {user_scope_query}"),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            push_feed_online_offline_select(
                &mut selects,
                &user_prefix,
                "1=1",
                type_filter,
                &user_scope_query,
                has_cursor,
                recent_order_sql,
            );
        }
    } else {
        params.insert("@search_like".into(), Value::String(format!("%{search}%")));
        let mut date_query = String::new();
        if !query.date_from.trim().is_empty() {
            date_query.push_str("AND created_at >= @date_from ");
            params.insert("@date_from".into(), Value::String(query.date_from.clone()));
        }
        if !query.date_to.trim().is_empty() {
            date_query.push_str("AND created_at <= @date_to ");
            params.insert("@date_to".into(), Value::String(query.date_to.clone()));
        }
        if flags.gps {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_gps",
                FEED_GPS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_GPS_SOURCE_RANK,
                    where_sql: &format!(
                        "(display_name LIKE @search_like OR world_name LIKE @search_like OR group_name LIKE @search_like) {date_query} {user_scope_query}"
                    ),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.status {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_status",
                FEED_STATUS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_STATUS_SOURCE_RANK,
                    where_sql: &format!(
                        "(display_name LIKE @search_like OR status LIKE @search_like OR status_description LIKE @search_like) {date_query} {user_scope_query}"
                    ),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.bio {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_bio",
                FEED_BIO_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_BIO_SOURCE_RANK,
                    where_sql: &format!(
                        "(display_name LIKE @search_like OR bio LIKE @search_like) {date_query} {user_scope_query}"
                    ),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.avatar {
            let avatar_query = if search.contains("private") {
                "OR user_id = owner_id"
            } else if search.contains("public") {
                "OR user_id != owner_id"
            } else {
                ""
            };
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_avatar",
                FEED_AVATAR_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_AVATAR_SOURCE_RANK,
                    where_sql: &format!(
                        "(display_name LIKE @search_like OR avatar_name LIKE @search_like) {avatar_query} {date_query} {user_scope_query}"
                    ),
                    has_cursor,
                    order_sql: recent_order_sql,
                },
            );
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            let where_sql =
                "(display_name LIKE @search_like OR world_name LIKE @search_like OR group_name LIKE @search_like)";
            push_feed_online_offline_select(
                &mut selects,
                &user_prefix,
                where_sql,
                &format!("{type_filter} {date_query}"),
                &user_scope_query,
                has_cursor,
                recent_order_sql,
            );
        }
    }

    if selects.is_empty() {
        return Ok(Vec::new());
    }

    db.execute(
        &format!(
            "SELECT {} FROM ({}) ORDER BY created_at DESC, source_rank DESC, id DESC LIMIT @limit",
            feed_base_columns(),
            selects.join(" UNION ALL ")
        ),
        &params,
    )
    .map(|rows| {
        rows.iter()
            .map(|row| feed_row_from_unified_row(row))
            .collect()
    })
}

fn query_feed_read_model(
    db: &DatabaseService,
    query: FeedReadModelQueryInput,
) -> Result<FeedReadModelOutput, Error> {
    let rows_query = FeedRowsQueryInput {
        user_id: query.user_id.clone(),
        mode: query.mode.clone(),
        search: query.search.clone(),
        filters: query.filters.clone(),
        vip_list: query.vip_list.clone(),
        excluded_user_ids: query.excluded_user_ids.clone(),
        max_entries: query.max_entries,
        date_from: query.date_from.clone(),
        date_to: query.date_to.clone(),
        cursor: query.cursor.clone(),
    };
    let rows = query_feed_rows(db, &rows_query)?;
    let max_rows = if query.max_rows > 0 {
        query.max_rows
    } else {
        query.max_entries
    };
    let context = FeedLiveRowsMergeContext {
        current_user_id: &query.user_id,
        filters: &query.filters,
        search: &query.search,
        date_from: &query.date_from,
        date_to: &query.date_to,
        favorites_only: query.favorites_only,
        favorite_user_ids: &query.favorite_user_ids,
        excluded_user_ids: &query.excluded_user_ids,
        max_rows,
    };

    Ok(merge_feed_rows_with_live(
        rows,
        &query.live_entries,
        query.min_live_sequence,
        context,
    ))
}

pub fn feed_rows_query(
    db: &DatabaseService,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, Error> {
    query_feed_rows(db, &query)
}

pub fn feed_read_model_query(
    db: &DatabaseService,
    query: FeedReadModelQueryInput,
) -> Result<FeedReadModelOutput, Error> {
    query_feed_read_model(db, query)
}

pub fn feed_live_rows_merge(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
    merge_feed_live_rows(query)
}

const FEED_GPS_SOURCE_RANK: i64 = 60;
const FEED_ONLINE_OFFLINE_SOURCE_RANK: i64 = 50;
const FEED_STATUS_SOURCE_RANK: i64 = 40;
const FEED_AVATAR_SOURCE_RANK: i64 = 30;
const FEED_BIO_SOURCE_RANK: i64 = 20;

const FEED_GPS_PROJECTION: &str = "id, 60 AS source_rank, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url";
const FEED_STATUS_PROJECTION: &str = "id, 40 AS source_rank, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url";
const FEED_BIO_PROJECTION: &str = "id, 20 AS source_rank, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url";
const FEED_AVATAR_PROJECTION: &str = "id, 30 AS source_rank, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url";
const FEED_ONLINE_OFFLINE_PROJECTION: &str = "id, 50 AS source_rank, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url";

struct FeedSelectOptions<'a> {
    source_rank: i64,
    where_sql: &'a str,
    has_cursor: bool,
    order_sql: &'a str,
}

fn push_feed_select(
    selects: &mut Vec<String>,
    user_prefix: &str,
    table_suffix: &str,
    projection: &str,
    options: FeedSelectOptions<'_>,
) {
    let cursor_sql = feed_cursor_condition(options.source_rank, options.has_cursor);
    let where_sql = options.where_sql;
    let order_sql = options.order_sql;
    selects.push(format!(
        "SELECT * FROM (SELECT {projection} FROM {user_prefix}_{table_suffix} WHERE {where_sql} {cursor_sql} ORDER BY {order_sql} LIMIT @per_table)"
    ));
}

fn feed_cursor_condition(source_rank: i64, has_cursor: bool) -> String {
    if !has_cursor {
        return String::new();
    }
    format!(
        "AND (created_at < @cursor_created_at OR (created_at = @cursor_created_at AND {source_rank} < @cursor_source_rank) OR (created_at = @cursor_created_at AND {source_rank} = @cursor_source_rank AND id < @cursor_row_id))"
    )
}

fn value_opt_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Null => None,
        other => {
            let text = value_as_string(other);
            (!text.is_empty()).then_some(text)
        }
    }
}

fn value_opt_i64(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn value_opt_string_list(value: Option<&Value>) -> Option<Vec<String>> {
    Some(
        value?
            .as_array()?
            .iter()
            .filter(|item| !item.is_null())
            .map(value_as_string)
            .collect(),
    )
}

fn row_opt_string(row: &[Value], index: usize) -> Option<String> {
    value_opt_string(row.get(index))
}

fn row_opt_i64(row: &[Value], index: usize) -> Option<i64> {
    value_opt_i64(row.get(index))
}

fn entry_opt_string(entry: &Value, keys: &[&str]) -> Option<String> {
    value_opt_string(feed_entry_value(entry, keys))
}

fn entry_opt_i64(entry: &Value, keys: &[&str]) -> Option<i64> {
    value_opt_i64(feed_entry_value(entry, keys))
}

fn entry_opt_string_list(entry: &Value, keys: &[&str]) -> Option<Vec<String>> {
    value_opt_string_list(feed_entry_value(entry, keys))
}

fn feed_row_from_unified_row(row: &[Value]) -> FeedRowOutput {
    FeedRowOutput {
        row_id: row_opt_i64(row, 0),
        source_rank: row_opt_i64(row, 1),
        created_at: row_opt_string(row, 2),
        user_id: row_opt_string(row, 3),
        display_name: row_opt_string(row, 4),
        r#type: row_opt_string(row, 5),
        location: row_opt_string(row, 6),
        world_name: row_opt_string(row, 7),
        previous_location: row_opt_string(row, 8),
        time: row_opt_i64(row, 9),
        group_name: row_opt_string(row, 10),
        status: row_opt_string(row, 11),
        status_description: row_opt_string(row, 12),
        previous_status: row_opt_string(row, 13),
        previous_status_description: row_opt_string(row, 14),
        bio: row_opt_string(row, 15),
        previous_bio: row_opt_string(row, 16),
        owner_id: row_opt_string(row, 17),
        avatar_name: row_opt_string(row, 18),
        current_avatar_image_url: row_opt_string(row, 19),
        current_avatar_thumbnail_image_url: row_opt_string(row, 20),
        current_avatar_tags: None,
        previous_owner_id: None,
        previous_avatar_name: None,
        previous_current_avatar_image_url: row_opt_string(row, 21),
        previous_current_avatar_thumbnail_image_url: row_opt_string(row, 22),
        previous_current_avatar_tags: None,
        owner_user_id: None,
    }
}

fn feed_row_from_value(entry: &Value) -> FeedRowOutput {
    FeedRowOutput {
        row_id: entry_opt_i64(entry, &["rowId", "row_id"]),
        source_rank: entry_opt_i64(entry, &["sourceRank", "source_rank"]),
        created_at: entry_opt_string(entry, &["created_at", "createdAt"]),
        user_id: entry_opt_string(entry, &["userId", "user_id"]),
        display_name: entry_opt_string(entry, &["displayName", "display_name"]),
        r#type: entry_opt_string(entry, &["type"]),
        location: entry_opt_string(entry, &["location"]),
        world_name: entry_opt_string(entry, &["worldName", "world_name"]),
        previous_location: entry_opt_string(entry, &["previousLocation", "previous_location"]),
        time: entry_opt_i64(entry, &["time"]),
        group_name: entry_opt_string(entry, &["groupName", "group_name"]),
        status: entry_opt_string(entry, &["status"]),
        status_description: entry_opt_string(entry, &["statusDescription", "status_description"]),
        previous_status: entry_opt_string(entry, &["previousStatus", "previous_status"]),
        previous_status_description: entry_opt_string(
            entry,
            &["previousStatusDescription", "previous_status_description"],
        ),
        bio: entry_opt_string(entry, &["bio"]),
        previous_bio: entry_opt_string(entry, &["previousBio", "previous_bio"]),
        owner_id: entry_opt_string(entry, &["ownerId", "owner_id"]),
        avatar_name: entry_opt_string(entry, &["avatarName", "avatar_name"]),
        current_avatar_image_url: entry_opt_string(
            entry,
            &["currentAvatarImageUrl", "current_avatar_image_url"],
        ),
        current_avatar_thumbnail_image_url: entry_opt_string(
            entry,
            &[
                "currentAvatarThumbnailImageUrl",
                "current_avatar_thumbnail_image_url",
            ],
        ),
        current_avatar_tags: entry_opt_string_list(
            entry,
            &["currentAvatarTags", "current_avatar_tags"],
        ),
        previous_owner_id: entry_opt_string(entry, &["previousOwnerId", "previous_owner_id"]),
        previous_avatar_name: entry_opt_string(
            entry,
            &["previousAvatarName", "previous_avatar_name"],
        ),
        previous_current_avatar_image_url: entry_opt_string(
            entry,
            &[
                "previousCurrentAvatarImageUrl",
                "previous_current_avatar_image_url",
            ],
        ),
        previous_current_avatar_thumbnail_image_url: entry_opt_string(
            entry,
            &[
                "previousCurrentAvatarThumbnailImageUrl",
                "previous_current_avatar_thumbnail_image_url",
            ],
        ),
        previous_current_avatar_tags: entry_opt_string_list(
            entry,
            &["previousCurrentAvatarTags", "previous_current_avatar_tags"],
        ),
        owner_user_id: entry_opt_string(entry, &["ownerUserId", "owner_user_id"]),
    }
}

#[derive(Default)]
struct FeedFilterFlags {
    pub(crate) gps: bool,
    pub(crate) status: bool,
    pub(crate) bio: bool,
    pub(crate) avatar: bool,
    pub(crate) online: bool,
    pub(crate) offline: bool,
}

fn feed_filter_flags(filters: &[String], include_profile: bool) -> FeedFilterFlags {
    let mut flags = FeedFilterFlags {
        gps: true,
        status: include_profile,
        bio: include_profile,
        avatar: include_profile,
        online: true,
        offline: true,
    };
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return flags;
    }

    flags = FeedFilterFlags::default();
    for filter in filters {
        match filter.as_str() {
            "GPS" => flags.gps = true,
            "Status" if include_profile => flags.status = true,
            "Bio" if include_profile => flags.bio = true,
            "Avatar" if include_profile => flags.avatar = true,
            "Online" => flags.online = true,
            "Offline" => flags.offline = true,
            _ => {}
        }
    }
    flags
}

fn push_feed_online_offline_select(
    selects: &mut Vec<String>,
    user_prefix: &str,
    where_sql: &str,
    type_filter: &str,
    vip_query: &str,
    has_cursor: bool,
    order_sql: &str,
) {
    push_feed_select(
        selects,
        user_prefix,
        "feed_online_offline",
        FEED_ONLINE_OFFLINE_PROJECTION,
        FeedSelectOptions {
            source_rank: FEED_ONLINE_OFFLINE_SOURCE_RANK,
            where_sql: &format!("{where_sql} {type_filter} {vip_query}"),
            has_cursor,
            order_sql,
        },
    );
}

fn feed_base_columns() -> &'static str {
    "id, source_rank, created_at, user_id, display_name, type, location, world_name, previous_location, time, group_name, status, status_description, previous_status, previous_status_description, bio, previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url"
}

fn feed_entry_value<'a>(entry: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let object = entry.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).filter(|value| !value.is_null()))
}

fn feed_entry_string(entry: &Value, keys: &[&str]) -> String {
    feed_entry_value(entry, keys)
        .map(value_as_string)
        .unwrap_or_default()
}

fn feed_row_key(row: &FeedRowOutput) -> String {
    let entry_type = row.r#type.as_deref().unwrap_or_default();
    if let Some(row_id) = row.row_id {
        return format!("row:{entry_type}:{row_id}");
    }

    format!(
        "{entry_type}:{}:{}:{}",
        row.created_at.as_deref().unwrap_or_default(),
        row.user_id.as_deref().unwrap_or_default(),
        row.location.as_deref().unwrap_or_default()
    )
}

fn feed_search_matches(row: &Value, search: &str) -> bool {
    let query = search.trim().to_uppercase();
    if query.is_empty() {
        return true;
    }

    if (query.starts_with("WRLD_") || query.starts_with("GRP_"))
        && feed_entry_string(row, &["location"])
            .to_uppercase()
            .contains(&query)
    {
        return true;
    }

    [
        feed_entry_string(row, &["displayName", "display_name"]),
        feed_entry_string(row, &["worldName", "world_name"]),
        feed_entry_string(row, &["groupName", "group_name"]),
        feed_entry_string(row, &["status"]),
        feed_entry_string(row, &["statusDescription", "status_description"]),
        feed_entry_string(row, &["previousStatus", "previous_status"]),
        feed_entry_string(
            row,
            &["previousStatusDescription", "previous_status_description"],
        ),
        feed_entry_string(row, &["bio"]),
        feed_entry_string(row, &["previousBio", "previous_bio"]),
        feed_entry_string(row, &["avatarName", "avatar_name"]),
        feed_entry_string(row, &["message"]),
    ]
    .iter()
    .any(|value| value.to_uppercase().contains(&query))
}

fn feed_live_entry_matches(
    row: &Value,
    context: &FeedLiveRowsMergeContext<'_>,
    favorite_user_ids: &HashSet<String>,
    excluded_user_ids: &HashSet<String>,
) -> bool {
    if !row.is_object() {
        return false;
    }

    let entry_type = feed_entry_string(row, &["type"]);
    if !matches!(
        entry_type.as_str(),
        "GPS" | "Online" | "Offline" | "Status" | "Avatar" | "Bio"
    ) {
        return false;
    }

    let owner_user_id = feed_entry_string(row, &["ownerUserId", "owner_user_id"]);
    if !owner_user_id.is_empty() && owner_user_id != context.current_user_id {
        return false;
    }

    let active_filters = context
        .filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if !active_filters.is_empty() && !active_filters.contains(&entry_type) {
        return false;
    }

    if context.favorites_only {
        let user_id = feed_entry_string(row, &["userId", "user_id"]);
        if user_id.is_empty() || !favorite_user_ids.contains(&user_id) {
            return false;
        }
    }
    let user_id = feed_entry_string(row, &["userId", "user_id"]);
    if !user_id.is_empty() && excluded_user_ids.contains(&user_id) {
        return false;
    }

    let created_at = feed_entry_string(row, &["created_at", "createdAt"]);
    if !context.date_from.trim().is_empty()
        && !created_at.is_empty()
        && created_at.as_str() < context.date_from
    {
        return false;
    }
    if !context.date_to.trim().is_empty()
        && !created_at.is_empty()
        && created_at.as_str() > context.date_to
    {
        return false;
    }

    feed_search_matches(row, context.search)
}

pub(crate) struct FeedLiveRowsMergeContext<'a> {
    pub(crate) current_user_id: &'a str,
    pub(crate) filters: &'a [String],
    pub(crate) search: &'a str,
    pub(crate) date_from: &'a str,
    pub(crate) date_to: &'a str,
    pub(crate) favorites_only: bool,
    pub(crate) favorite_user_ids: &'a [String],
    pub(crate) excluded_user_ids: &'a [String],
    pub(crate) max_rows: i64,
}

fn merge_feed_rows_with_live(
    rows: Vec<FeedRowOutput>,
    live_entries: &[FeedLiveEntryInput],
    min_live_sequence: i64,
    context: FeedLiveRowsMergeContext<'_>,
) -> FeedReadModelOutput {
    let favorite_user_ids = context
        .favorite_user_ids
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let excluded_user_ids = context
        .excluded_user_ids
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let mut max_sequence = min_live_sequence;
    let mut matching_entries = Vec::new();

    for live_entry in live_entries
        .iter()
        .filter(|entry| entry.sequence > min_live_sequence)
    {
        max_sequence = max_sequence.max(live_entry.sequence);
        if feed_live_entry_matches(
            live_entry.entry.as_value(),
            &context,
            &favorite_user_ids,
            &excluded_user_ids,
        ) {
            matching_entries.push(feed_row_from_value(live_entry.entry.as_value()));
        }
    }

    let max_rows = if context.max_rows > 0 {
        context.max_rows as usize
    } else {
        rows.len().saturating_add(matching_entries.len())
    };
    let mut seen = HashSet::new();
    let mut output_rows = Vec::new();

    for entry in matching_entries.into_iter().rev() {
        let key = feed_row_key(&entry);
        if seen.insert(key) {
            output_rows.push(entry);
        }
    }
    for row in rows {
        if let Some(user_id) = row.user_id.as_ref() {
            if !user_id.is_empty() && excluded_user_ids.contains(user_id) {
                continue;
            }
        }
        let key = feed_row_key(&row);
        if seen.insert(key) {
            output_rows.push(row);
        }
    }
    output_rows.truncate(max_rows);

    FeedReadModelOutput {
        rows: output_rows,
        max_sequence,
    }
}

fn merge_feed_live_rows(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
    let context = FeedLiveRowsMergeContext {
        current_user_id: &query.current_user_id,
        filters: &query.filters,
        search: &query.search,
        date_from: &query.date_from,
        date_to: &query.date_to,
        favorites_only: query.favorites_only,
        favorite_user_ids: &query.favorite_user_ids,
        excluded_user_ids: &query.excluded_user_ids,
        max_rows: query.max_rows,
    };
    merge_feed_rows_with_live(
        query
            .rows
            .iter()
            .map(|row| feed_row_from_value(row.as_value()))
            .collect(),
        &query.live_entries,
        query.min_live_sequence,
        context,
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;
    use vrcx_0_core::json::RawJson;

    use crate::database::DatabaseService;

    use super::super::write::feed_add_entry;
    use super::{
        feed_live_rows_merge, feed_rows_query, FeedCursorInput, FeedLiveEntryInput,
        FeedLiveRowsMergeInput, FeedRowsQueryInput,
    };

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
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
    fn live_feed_ignores_friend_relationship_events_without_active_filters() {
        let output = feed_live_rows_merge(FeedLiveRowsMergeInput {
            rows: Vec::new(),
            current_user_id: "usr_self".into(),
            filters: Vec::new(),
            search: String::new(),
            date_from: String::new(),
            date_to: String::new(),
            favorites_only: false,
            favorite_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            live_entries: vec![
                FeedLiveEntryInput {
                    sequence: 1,
                    entry: RawJson::from(json!({
                        "type": "Friend",
                        "userId": "usr_friend",
                        "displayName": "Friend",
                        "created_at": "2026-05-15T00:00:00Z",
                    })),
                },
                FeedLiveEntryInput {
                    sequence: 2,
                    entry: RawJson::from(json!({
                        "type": "GPS",
                        "userId": "usr_friend",
                        "displayName": "Friend",
                        "location": "wrld_1:instance",
                        "created_at": "2026-05-15T00:00:01Z",
                    })),
                },
            ],
            min_live_sequence: 0,
            max_rows: 10,
        });

        assert_eq!(output.max_sequence, 2);
        assert_eq!(output.rows.len(), 1);
        assert_eq!(output.rows[0].r#type.as_deref(), Some("GPS"));
    }

    #[test]
    fn live_feed_rows_keep_avatar_fields_that_only_exist_on_live_entries() {
        let output = feed_live_rows_merge(FeedLiveRowsMergeInput {
            rows: Vec::new(),
            current_user_id: "usr_self".into(),
            filters: Vec::new(),
            search: String::new(),
            date_from: String::new(),
            date_to: String::new(),
            favorites_only: false,
            favorite_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            live_entries: vec![FeedLiveEntryInput {
                sequence: 1,
                entry: RawJson::from(json!({
                    "type": "Avatar",
                    "userId": "usr_friend",
                    "displayName": "Friend",
                    "created_at": "2026-05-15T00:00:00Z",
                    "avatarName": "Current",
                    "previousAvatarName": "Previous",
                    "ownerId": "usr_owner",
                    "previousOwnerId": "usr_previous_owner",
                    "currentAvatarTags": ["content_horror"],
                    "previousCurrentAvatarTags": [],
                })),
            }],
            min_live_sequence: 0,
            max_rows: 10,
        });

        assert_eq!(output.rows.len(), 1);
        let row = &output.rows[0];
        assert_eq!(row.previous_avatar_name.as_deref(), Some("Previous"));
        assert_eq!(row.previous_owner_id.as_deref(), Some("usr_previous_owner"));
        assert_eq!(
            row.current_avatar_tags.as_deref(),
            Some(["content_horror".to_string()].as_slice())
        );
        assert_eq!(
            row.previous_current_avatar_tags.as_deref(),
            Some([].as_slice())
        );
        assert_eq!(row.row_id, None);
    }

    #[test]
    fn merged_rows_normalize_snake_case_live_entry_field_names() {
        let output = feed_live_rows_merge(FeedLiveRowsMergeInput {
            rows: Vec::new(),
            current_user_id: "usr_self".into(),
            filters: Vec::new(),
            search: String::new(),
            date_from: String::new(),
            date_to: String::new(),
            favorites_only: false,
            favorite_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            live_entries: vec![FeedLiveEntryInput {
                sequence: 1,
                entry: RawJson::from(json!({
                    "type": "GPS",
                    "user_id": "usr_friend",
                    "display_name": "Friend",
                    "createdAt": "2026-05-15T00:00:00Z",
                    "location": "wrld_1:instance",
                    "world_name": "World",
                    "time": "1500",
                })),
            }],
            min_live_sequence: 0,
            max_rows: 10,
        });

        assert_eq!(output.rows.len(), 1);
        let row = &output.rows[0];
        assert_eq!(row.user_id.as_deref(), Some("usr_friend"));
        assert_eq!(row.display_name.as_deref(), Some("Friend"));
        assert_eq!(row.created_at.as_deref(), Some("2026-05-15T00:00:00Z"));
        assert_eq!(row.world_name.as_deref(), Some("World"));
        assert_eq!(row.time, Some(1500));
    }

    #[test]
    fn lookup_feed_pagination_uses_the_same_date_order_as_its_cursor() -> Result<(), crate::Error> {
        let dir = TestDir::new("feed-lookup-rowid");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

        feed_add_entry(
            &db,
            "usr_self".into(),
            RawJson::from(json!({
                "created_at": "2026-05-15T00:10:00Z",
                "type": "GPS",
                "userId": "usr_newer_created",
                "displayName": "newer-created",
                "location": "wrld_1:newer",
                "worldName": "Newer Created",
                "previousLocation": "",
                "time": 0,
                "groupName": ""
            })),
        )?;
        feed_add_entry(
            &db,
            "usr_self".into(),
            RawJson::from(json!({
                "created_at": "2026-05-15T00:00:00Z",
                "type": "GPS",
                "userId": "usr_later_inserted",
                "displayName": "later-inserted",
                "location": "wrld_1:later",
                "worldName": "Later Inserted",
                "previousLocation": "",
                "time": 0,
                "groupName": ""
            })),
        )?;

        let first_page = feed_rows_query(
            &db,
            FeedRowsQueryInput {
                user_id: "usr_self".into(),
                mode: "lookup".into(),
                search: String::new(),
                filters: vec!["GPS".into()],
                vip_list: Vec::new(),
                excluded_user_ids: Vec::new(),
                max_entries: 1,
                date_from: String::new(),
                date_to: String::new(),
                cursor: None,
            },
        )?;

        assert_eq!(first_page.len(), 1);
        assert_eq!(first_page[0].display_name.as_deref(), Some("newer-created"));

        let second_page = feed_rows_query(
            &db,
            FeedRowsQueryInput {
                user_id: "usr_self".into(),
                mode: "lookup".into(),
                search: String::new(),
                filters: vec!["GPS".into()],
                vip_list: Vec::new(),
                excluded_user_ids: Vec::new(),
                max_entries: 1,
                date_from: String::new(),
                date_to: String::new(),
                cursor: Some(FeedCursorInput {
                    created_at: first_page[0].created_at.clone().unwrap(),
                    source_rank: first_page[0].source_rank.unwrap(),
                    row_id: first_page[0].row_id.unwrap(),
                }),
            },
        )?;

        assert_eq!(second_page.len(), 1);
        assert_eq!(
            second_page[0].display_name.as_deref(),
            Some("later-inserted")
        );
        Ok(())
    }
}
