use std::cmp::Ordering;
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
    should_interrupt: Option<Box<dyn Fn() -> bool + Send + Sync>>,
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
    let cursor = query
        .cursor
        .as_ref()
        .filter(|cursor| !cursor.created_at.trim().is_empty() && cursor.row_id > 0);
    let cursor_source_rank = cursor.map(|cursor| cursor.source_rank);
    if let Some(cursor) = cursor {
        params.insert(
            "@cursor_created_at".into(),
            Value::String(cursor.created_at.clone()),
        );
        params.insert("@cursor_row_id".into(), Value::from(cursor.row_id));
    }

    let vip_placeholders = add_list_params(&mut params, &query.vip_list, "vip");
    let vip_query = if vip_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id IN ({})", vip_placeholders.join(", "))
    };
    let scoped_placeholders = add_list_params(&mut params, &query.scoped_user_ids, "scoped");
    let scoped_query = if scoped_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id IN ({})", scoped_placeholders.join(", "))
    };
    let excluded_placeholders = add_list_params(&mut params, &query.excluded_user_ids, "excluded");
    let excluded_query = if excluded_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id NOT IN ({})", excluded_placeholders.join(", "))
    };
    let user_scope_query = format!("{vip_query} {scoped_query} {excluded_query}");

    let normalize_created_at = should_interrupt.is_some();
    let created_at_expression = if normalize_created_at {
        "julianday(created_at)"
    } else {
        "created_at"
    };
    let cursor_created_at_expression = if normalize_created_at {
        "julianday(@cursor_created_at)"
    } else {
        "@cursor_created_at"
    };
    let search = normalize_text(&query.search);
    let mut date_query = String::new();
    if !query.date_from.trim().is_empty() {
        date_query.push_str(&format!(
            "AND {created_at_expression} >= {date_from_expression} ",
            date_from_expression = if normalize_created_at {
                "julianday(@date_from)"
            } else {
                "@date_from"
            }
        ));
        params.insert("@date_from".into(), Value::String(query.date_from.clone()));
    }
    if !query.date_to.trim().is_empty() {
        date_query.push_str(&format!(
            "AND {created_at_expression} <= {date_to_expression} ",
            date_to_expression = if normalize_created_at {
                "julianday(@date_to)"
            } else {
                "@date_to"
            }
        ));
        params.insert("@date_to".into(), Value::String(query.date_to.clone()));
    }
    let instance_mode = query.mode == FeedQueryMode::Instance
        || (query.mode == FeedQueryMode::Search
            && (search.starts_with("wrld_") || search.starts_with("grp_")));
    let recent_order_sql = format!("{created_at_expression} DESC, id DESC");
    let flags = feed_filter_flags(&query.filters, !instance_mode);
    let mut selects = Vec::new();

    if instance_mode {
        params.insert(
            "@instance_like".into(),
            Value::String(literal_like_pattern(&search)),
        );
        if flags.gps {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_gps",
                FEED_GPS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_GPS_SOURCE_RANK,
                    where_sql: &format!(
                        "(location LIKE @instance_like ESCAPE '\\' OR previous_location LIKE @instance_like ESCAPE '\\') {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_online_offline",
                FEED_ONLINE_OFFLINE_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_ONLINE_OFFLINE_SOURCE_RANK,
                    where_sql: &format!(
                        "location LIKE @instance_like ESCAPE '\\' {type_filter} {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
    } else if query.mode == FeedQueryMode::Lookup {
        if flags.gps {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_gps",
                FEED_GPS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_GPS_SOURCE_RANK,
                    where_sql: &format!("1=1 {date_query} {user_scope_query}"),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
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
                    where_sql: &format!("1=1 {date_query} {user_scope_query}"),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
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
                    where_sql: &format!("1=1 {date_query} {user_scope_query}"),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
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
                    where_sql: &format!("1=1 {date_query} {user_scope_query}"),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_online_offline",
                FEED_ONLINE_OFFLINE_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_ONLINE_OFFLINE_SOURCE_RANK,
                    where_sql: &format!("1=1 {type_filter} {date_query} {user_scope_query}"),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
    } else {
        params.insert(
            "@search_like".into(),
            Value::String(literal_like_pattern(&search)),
        );
        if flags.gps {
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_gps",
                FEED_GPS_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_GPS_SOURCE_RANK,
                    where_sql: &format!(
                        "(display_name LIKE @search_like ESCAPE '\\' OR location LIKE @search_like ESCAPE '\\' OR world_name LIKE @search_like ESCAPE '\\' OR previous_location LIKE @search_like ESCAPE '\\' OR group_name LIKE @search_like ESCAPE '\\') {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
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
                        "(display_name LIKE @search_like ESCAPE '\\' OR status LIKE @search_like ESCAPE '\\' OR status_description LIKE @search_like ESCAPE '\\' OR previous_status LIKE @search_like ESCAPE '\\' OR previous_status_description LIKE @search_like ESCAPE '\\') {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
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
                        "(display_name LIKE @search_like ESCAPE '\\' OR bio LIKE @search_like ESCAPE '\\' OR previous_bio LIKE @search_like ESCAPE '\\') {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
        if flags.avatar {
            let avatar_query = match search.as_str() {
                "private" => "OR user_id = owner_id",
                "public" => "OR user_id != owner_id",
                _ => "",
            };
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_avatar",
                FEED_AVATAR_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_AVATAR_SOURCE_RANK,
                    where_sql: &format!(
                        "((display_name LIKE @search_like ESCAPE '\\' OR avatar_name LIKE @search_like ESCAPE '\\') {avatar_query}) {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
        if flags.online || flags.offline {
            let type_filter = match (flags.online, flags.offline) {
                (true, false) => "AND type = 'Online'",
                (false, true) => "AND type = 'Offline'",
                _ => "",
            };
            let where_sql = "(display_name LIKE @search_like ESCAPE '\\' OR location LIKE @search_like ESCAPE '\\' OR world_name LIKE @search_like ESCAPE '\\' OR group_name LIKE @search_like ESCAPE '\\')";
            push_feed_select(
                &mut selects,
                &user_prefix,
                "feed_online_offline",
                FEED_ONLINE_OFFLINE_PROJECTION,
                FeedSelectOptions {
                    source_rank: FEED_ONLINE_OFFLINE_SOURCE_RANK,
                    where_sql: &format!(
                        "{where_sql} {type_filter} {date_query} {user_scope_query}"
                    ),
                    cursor_source_rank,
                    order_sql: &recent_order_sql,
                    created_at_expression,
                    cursor_created_at_expression,
                },
            );
        }
    }

    if selects.is_empty() {
        return Ok(Vec::new());
    }

    let sql = format!(
        "SELECT {} FROM ({}) ORDER BY created_at_sort DESC, source_rank DESC, id DESC LIMIT @limit",
        feed_base_columns(),
        selects.join(" UNION ALL ")
    );
    match should_interrupt {
        Some(callback) => db.execute_interruptible(&sql, &params, callback),
        None => db.execute(&sql, &params),
    }
    .map(|rows| {
        rows.iter()
            .map(|row| feed_row_from_unified_row(row))
            .collect()
    })
}

pub fn feed_rows_query(
    db: &DatabaseService,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, Error> {
    query_feed_rows(db, &query, None)
}

pub fn feed_rows_query_interruptible<F>(
    db: &DatabaseService,
    query: FeedRowsQueryInput,
    should_interrupt: F,
) -> Result<Vec<FeedRowOutput>, Error>
where
    F: Fn() -> bool + Send + Sync + 'static,
{
    query_feed_rows(db, &query, Some(Box::new(should_interrupt)))
}

pub fn feed_latest_query(
    db: &DatabaseService,
    query: FeedLatestQueryInput,
    live_entries: Vec<FeedLiveEntryInput>,
    watermark: i64,
    include_persisted_rows: bool,
) -> Result<FeedReadModelOutput, Error> {
    if query.favorites_only && query.favorite_user_ids.is_empty() {
        return Ok(FeedReadModelOutput {
            rows: Vec::new(),
            max_sequence: watermark,
            persisted_cursor: None,
            persisted_has_more: false,
        });
    }
    let rows = if include_persisted_rows {
        query_feed_rows(
            db,
            &FeedRowsQueryInput {
                user_id: query.user_id.clone(),
                mode: FeedQueryMode::Lookup,
                search: String::new(),
                filters: query.filters.clone(),
                vip_list: if query.favorites_only {
                    query.favorite_user_ids.clone()
                } else {
                    Vec::new()
                },
                scoped_user_ids: query.scoped_user_ids.clone(),
                excluded_user_ids: query.excluded_user_ids.clone(),
                max_entries: query.max_rows,
                date_from: String::new(),
                date_to: String::new(),
                cursor: None,
            },
            None,
        )?
    } else {
        Vec::new()
    };
    let persisted_cursor = rows.last().and_then(feed_cursor_from_row);
    let persisted_has_more =
        include_persisted_rows && query.max_rows > 0 && rows.len() >= query.max_rows as usize;
    let context = FeedLiveRowsMergeContext {
        current_user_id: &query.user_id,
        filters: &query.filters,
        search: "",
        date_from: "",
        date_to: "",
        favorites_only: query.favorites_only,
        favorite_user_ids: &query.favorite_user_ids,
        scoped_user_ids: &query.scoped_user_ids,
        excluded_user_ids: &query.excluded_user_ids,
        max_rows: query.max_rows,
    };
    let mut output = merge_feed_rows_with_live(rows, &live_entries, 0, context);
    output.max_sequence = watermark.max(output.max_sequence);
    output.persisted_cursor = persisted_cursor;
    output.persisted_has_more = persisted_has_more;
    Ok(output)
}

pub fn feed_search_query(
    db: &DatabaseService,
    query: FeedSearchQueryInput,
    live_entries: Vec<FeedLiveEntryInput>,
    watermark: i64,
    include_persisted_rows: bool,
) -> Result<FeedReadModelOutput, Error> {
    if query.favorites_only && query.favorite_user_ids.is_empty() {
        return Ok(FeedReadModelOutput {
            rows: Vec::new(),
            max_sequence: watermark,
            persisted_cursor: None,
            persisted_has_more: false,
        });
    }
    let rows = if include_persisted_rows {
        query_feed_rows(
            db,
            &FeedRowsQueryInput {
                user_id: query.user_id.clone(),
                mode: FeedQueryMode::Search,
                search: query.search.clone(),
                filters: query.filters.clone(),
                vip_list: if query.favorites_only {
                    query.favorite_user_ids.clone()
                } else {
                    Vec::new()
                },
                scoped_user_ids: query.scoped_user_ids.clone(),
                excluded_user_ids: query.excluded_user_ids.clone(),
                max_entries: query.max_rows,
                date_from: query.date_from.clone(),
                date_to: query.date_to.clone(),
                cursor: None,
            },
            None,
        )?
    } else {
        Vec::new()
    };
    let context = FeedLiveRowsMergeContext {
        current_user_id: &query.user_id,
        filters: &query.filters,
        search: &query.search,
        date_from: &query.date_from,
        date_to: &query.date_to,
        favorites_only: query.favorites_only,
        favorite_user_ids: &query.favorite_user_ids,
        scoped_user_ids: &query.scoped_user_ids,
        excluded_user_ids: &query.excluded_user_ids,
        max_rows: query.max_rows,
    };
    let mut output = merge_feed_rows_with_live(rows, &live_entries, 0, context);
    output.max_sequence = watermark.max(output.max_sequence);
    Ok(output)
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
    cursor_source_rank: Option<i64>,
    order_sql: &'a str,
    created_at_expression: &'a str,
    cursor_created_at_expression: &'a str,
}

fn push_feed_select(
    selects: &mut Vec<String>,
    user_prefix: &str,
    table_suffix: &str,
    projection: &str,
    options: FeedSelectOptions<'_>,
) {
    let cursor_sql = feed_cursor_condition(
        options.source_rank,
        options.cursor_source_rank,
        options.created_at_expression,
        options.cursor_created_at_expression,
    );
    let where_sql = options.where_sql;
    let order_sql = options.order_sql;
    let created_at_expression = options.created_at_expression;
    selects.push(format!(
        "SELECT * FROM (SELECT {projection}, {created_at_expression} AS created_at_sort FROM {user_prefix}_{table_suffix} WHERE {where_sql} {cursor_sql} ORDER BY {order_sql} LIMIT @per_table)"
    ));
}

fn feed_cursor_condition(
    source_rank: i64,
    cursor_source_rank: Option<i64>,
    created_at_expression: &str,
    cursor_created_at_expression: &str,
) -> String {
    let Some(cursor_source_rank) = cursor_source_rank else {
        return String::new();
    };
    match source_rank.cmp(&cursor_source_rank) {
        Ordering::Less => {
            format!("AND {created_at_expression} <= {cursor_created_at_expression}")
        }
        Ordering::Equal => format!(
            "AND ({created_at_expression}, id) < ({cursor_created_at_expression}, @cursor_row_id)"
        ),
        Ordering::Greater => {
            format!("AND {created_at_expression} < {cursor_created_at_expression}")
        }
    }
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

fn row_opt_string(row: &[Value], index: usize) -> Option<String> {
    value_opt_string(row.get(index))
}

fn row_opt_i64(row: &[Value], index: usize) -> Option<i64> {
    value_opt_i64(row.get(index))
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

#[derive(Default)]
struct FeedFilterFlags {
    pub(crate) gps: bool,
    pub(crate) status: bool,
    pub(crate) bio: bool,
    pub(crate) avatar: bool,
    pub(crate) online: bool,
    pub(crate) offline: bool,
}

fn feed_filter_flags(filters: &[FeedFilter], include_profile: bool) -> FeedFilterFlags {
    let mut flags = FeedFilterFlags {
        gps: true,
        status: include_profile,
        bio: include_profile,
        avatar: include_profile,
        online: true,
        offline: true,
    };
    if filters.is_empty() {
        return flags;
    }

    flags = FeedFilterFlags::default();
    for filter in filters {
        match filter {
            FeedFilter::Gps => flags.gps = true,
            FeedFilter::Status if include_profile => flags.status = true,
            FeedFilter::Bio if include_profile => flags.bio = true,
            FeedFilter::Avatar if include_profile => flags.avatar = true,
            FeedFilter::Online => flags.online = true,
            FeedFilter::Offline => flags.offline = true,
            FeedFilter::Status | FeedFilter::Bio | FeedFilter::Avatar => {}
        }
    }
    flags
}

fn feed_base_columns() -> &'static str {
    "id, source_rank, created_at, user_id, display_name, type, location, world_name, previous_location, time, group_name, status, status_description, previous_status, previous_status_description, bio, previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url"
}

fn literal_like_pattern(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    format!("%{escaped}%")
}

fn feed_row_key(row: &FeedRowOutput) -> String {
    let entry_type = row.r#type.as_deref().unwrap_or_default();
    if let Some(row_id) = row.row_id {
        return format!("row:{entry_type}:{row_id}");
    }

    feed_row_content_key(row)
}

fn feed_cursor_from_row(row: &FeedRowOutput) -> Option<FeedCursorInput> {
    Some(FeedCursorInput {
        created_at: row.created_at.clone()?,
        source_rank: row.source_rank?,
        row_id: row.row_id?,
    })
}

fn feed_row_content_key(row: &FeedRowOutput) -> String {
    let entry_type = row.r#type.as_deref().unwrap_or_default();
    format!(
        "{entry_type}:{}:{}:{}",
        row.created_at.as_deref().unwrap_or_default(),
        row.user_id.as_deref().unwrap_or_default(),
        row.location.as_deref().unwrap_or_default()
    )
}

pub(crate) struct FeedLiveRowsMergeContext<'a> {
    pub(crate) current_user_id: &'a str,
    pub(crate) filters: &'a [FeedFilter],
    pub(crate) search: &'a str,
    pub(crate) date_from: &'a str,
    pub(crate) date_to: &'a str,
    pub(crate) favorites_only: bool,
    pub(crate) favorite_user_ids: &'a [String],
    pub(crate) scoped_user_ids: &'a [String],
    pub(crate) excluded_user_ids: &'a [String],
    pub(crate) max_rows: i64,
}

fn merge_feed_rows_with_live(
    rows: Vec<FeedRowOutput>,
    live_entries: &[FeedLiveEntryInput],
    min_live_sequence: i64,
    context: FeedLiveRowsMergeContext<'_>,
) -> FeedReadModelOutput {
    let matcher = FeedLiveQueryMatcher::from_parts(
        context.current_user_id,
        context.filters,
        context.search,
        context.date_from,
        context.date_to,
        context.favorites_only,
        context.favorite_user_ids,
        context.scoped_user_ids,
        context.excluded_user_ids,
        context.max_rows,
    );
    let mut max_sequence = min_live_sequence;
    let mut matching_entries = Vec::new();

    for live_entry in live_entries
        .iter()
        .filter(|entry| entry.sequence > min_live_sequence)
    {
        max_sequence = max_sequence.max(live_entry.sequence);
        if matcher.matches(&live_entry.entry) {
            matching_entries.push(FeedRowOutput::from(&live_entry.entry));
        }
    }

    let max_rows = if context.max_rows > 0 {
        context.max_rows as usize
    } else {
        rows.len().saturating_add(matching_entries.len())
    };
    let mut live_content_keys = HashSet::new();
    let mut persisted_row_keys = HashSet::new();
    let mut output_rows = Vec::new();

    for entry in matching_entries.into_iter().rev() {
        if live_content_keys.insert(feed_row_content_key(&entry)) {
            output_rows.push(entry);
        }
    }
    for row in rows {
        if let Some(user_id) = row.user_id.as_ref() {
            if !matcher.matches_user_scope(user_id) {
                continue;
            }
        }
        if live_content_keys.contains(&feed_row_content_key(&row)) {
            continue;
        }
        if persisted_row_keys.insert(feed_row_key(&row)) {
            output_rows.push(row);
        }
    }
    output_rows.truncate(max_rows);

    FeedReadModelOutput {
        rows: output_rows,
        max_sequence,
        persisted_cursor: None,
        persisted_has_more: false,
    }
}

#[cfg(test)]
mod tests;
