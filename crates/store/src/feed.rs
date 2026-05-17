#![allow(non_snake_case)]
#![allow(unused_imports)]

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_core::json::RawJson;

use crate::common::{DbParams, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::domain_support::*;
use crate::game_log::{
    ensure_game_log_tables, write_batch as write_game_log_batch, GameLogEventEntry,
    GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogResourceLoadEntry, GameLogVideoPlayEntry, GameLogWriteBatch,
};
use crate::realtime::{
    ensure_realtime_tables, normalize_user_table_prefix, write_realtime_batch,
    RealtimePersistenceBatch,
};
use crate::Error;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowsQueryInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveEntryInput {
    pub sequence: i64,
    #[serde(default)]
    pub entry: RawJson,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelQueryInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    #[serde(default)]
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub live_entries: Vec<FeedLiveEntryInput>,
    #[serde(default)]
    pub min_live_sequence: i64,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub max_rows: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveRowsMergeInput {
    #[serde(default)]
    pub rows: Vec<RawJson>,
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub live_entries: Vec<FeedLiveEntryInput>,
    #[serde(default)]
    pub min_live_sequence: i64,
    #[serde(default)]
    pub max_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelOutput {
    pub rows: Vec<RawJson>,
    pub max_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowOutput {
    pub row_id: RawJson,
    #[serde(rename = "created_at")]
    pub created_at: RawJson,
    pub user_id: RawJson,
    pub display_name: RawJson,
    pub r#type: RawJson,
    pub location: RawJson,
    pub world_name: RawJson,
    pub previous_location: RawJson,
    pub time: RawJson,
    pub group_name: RawJson,
    pub status: RawJson,
    pub status_description: RawJson,
    pub previous_status: RawJson,
    pub previous_status_description: RawJson,
    pub bio: RawJson,
    pub previous_bio: RawJson,
    pub owner_id: RawJson,
    pub avatar_name: RawJson,
    pub current_avatar_image_url: RawJson,
    pub current_avatar_thumbnail_image_url: RawJson,
    pub previous_current_avatar_image_url: RawJson,
    pub previous_current_avatar_thumbnail_image_url: RawJson,
}

pub fn app__feed_add_entry(
    db: &DatabaseService,
    user_id: String,
    entry: RawJson,
) -> Result<(), Error> {
    write_realtime_batch(
        db,
        &user_id,
        &RealtimePersistenceBatch {
            feed_entries: vec![entry.into_value()],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    Ok(())
}

pub fn app__feed_avatar_purge(
    db: &DatabaseService,
    user_id: String,
    cutoff_date: Option<String>,
) -> Result<i64, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    if let Some(cutoff_date) = cutoff_date.filter(|value| !value.trim().is_empty()) {
        return db.execute_non_query(
            &format!("DELETE FROM {user_prefix}_feed_avatar WHERE created_at < @cutoff"),
            &ParamsBuilder::new().set("cutoff", cutoff_date).build(),
        );
    }
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_feed_avatar"),
        &Default::default(),
    )
}

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

    let vip_placeholders = add_list_params(&mut params, &query.vip_list, "vip");
    let vip_query = if vip_placeholders.is_empty() {
        String::new()
    } else {
        format!("AND user_id IN ({})", vip_placeholders.join(", "))
    };

    let mode = normalize_text(&query.mode);
    let search = normalize_text(&query.search);
    let instance_mode = mode == "instance"
        || (mode == "search" && (search.starts_with("wrld_") || search.starts_with("grp_")));
    let flags = feed_filter_flags(&query.filters, !instance_mode);
    let mut selects = Vec::new();

    if instance_mode {
        params.insert(
            "@instance_like".into(),
            Value::String(format!("%{search}%")),
        );
        if flags.gps {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_gps WHERE location LIKE @instance_like {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
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
                &vip_query,
            );
        }
    } else if mode == "lookup" {
        if flags.gps {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_gps WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.status {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_status WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.bio {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_bio WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
        }
        if flags.avatar {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_avatar WHERE 1=1 {vip_query} ORDER BY id DESC LIMIT @per_table)"
            ));
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
                &vip_query,
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
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_gps WHERE (display_name LIKE @search_like OR world_name LIKE @search_like OR group_name LIKE @search_like) {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.status {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_status WHERE (display_name LIKE @search_like OR status LIKE @search_like OR status_description LIKE @search_like) {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.bio {
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_bio WHERE (display_name LIKE @search_like OR bio LIKE @search_like) {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
        }
        if flags.avatar {
            let avatar_query = if search.contains("private") {
                "OR user_id = owner_id"
            } else if search.contains("public") {
                "OR user_id != owner_id"
            } else {
                ""
            };
            selects.push(format!(
                "SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url FROM {user_prefix}_feed_avatar WHERE (display_name LIKE @search_like OR avatar_name LIKE @search_like) {avatar_query} {date_query} {vip_query} ORDER BY created_at DESC, id DESC LIMIT @per_table)"
            ));
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
                &vip_query,
            );
        }
    }

    if selects.is_empty() {
        return Ok(Vec::new());
    }

    Ok(db
        .execute(
            &format!(
                "SELECT {} FROM ({}) ORDER BY created_at DESC, id DESC LIMIT @limit",
                feed_base_columns(),
                selects.join(" UNION ALL ")
            ),
            &params,
        )?
        .into_iter()
        .map(|row| feed_row_from_unified_row(&row))
        .collect())
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
        max_entries: query.max_entries,
        date_from: query.date_from.clone(),
        date_to: query.date_to.clone(),
    };
    let rows = query_feed_rows(db, &rows_query)?
        .into_iter()
        .map(feed_row_output_to_value)
        .map(RawJson::from)
        .collect::<Vec<_>>();
    let max_rows = if query.max_rows > 0 {
        query.max_rows
    } else {
        query.max_entries
    };

    Ok(merge_feed_live_rows(FeedLiveRowsMergeInput {
        rows,
        current_user_id: query.user_id,
        filters: query.filters,
        search: query.search,
        date_from: query.date_from,
        date_to: query.date_to,
        favorites_only: query.favorites_only,
        favorite_user_ids: query.favorite_user_ids,
        live_entries: query.live_entries,
        min_live_sequence: query.min_live_sequence,
        max_rows,
    }))
}

pub fn app__feed_rows_query(
    db: &DatabaseService,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, Error> {
    query_feed_rows(db, &query)
}

pub fn app__feed_read_model_query(
    db: &DatabaseService,
    query: FeedReadModelQueryInput,
) -> Result<FeedReadModelOutput, Error> {
    query_feed_read_model(db, query)
}

pub fn app__feed_live_rows_merge(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
    merge_feed_live_rows(query)
}
