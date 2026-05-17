#![allow(non_snake_case)]
#![allow(unused_imports)]

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub filters: Vec<String>,
    pub per_table_limit: i64,
    #[serde(default)]
    pub include_unseen: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV1RowOutput {
    pub id: String,
    pub created_at: String,
    pub r#type: String,
    pub sender_user_id: String,
    pub sender_username: String,
    pub receiver_user_id: String,
    pub message: String,
    pub world_id: String,
    pub world_name: String,
    pub image_url: String,
    pub invite_message: String,
    pub request_message: String,
    pub response_message: String,
    pub expired: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV2RowOutput {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub r#type: String,
    pub link: String,
    pub link_text: String,
    pub message: String,
    pub title: String,
    pub image_url: String,
    pub seen: i64,
    pub sender_user_id: String,
    pub sender_username: String,
    pub data: String,
    pub responses: String,
    pub details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsOutput {
    pub v1_rows: Vec<NotificationV1RowOutput>,
    pub v2_rows: Vec<NotificationV2RowOutput>,
    pub unseen_v2_rows: Vec<NotificationV2RowOutput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub per_table_limit: i64,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub include_unseen: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListItemOutput {
    pub id: String,
    pub version: i64,
    pub created_at: String,
    #[serde(rename = "created_at")]
    pub created_at_legacy: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub updated_at: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub expires_at: String,
    pub r#type: String,
    pub link: String,
    pub link_text: String,
    pub message: String,
    pub title: String,
    pub image_url: String,
    pub seen: bool,
    pub sender_user_id: String,
    pub sender_username: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub receiver_user_id: String,
    pub data: Value,
    pub responses: Value,
    pub details: Value,
    pub expired: bool,
}

fn notification_filter_params(
    filters: &[String],
    search: &str,
    search_columns: &[&str],
) -> (String, DbParams) {
    let mut params = HashMap::new();
    let mut clauses = Vec::new();
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let type_placeholders = add_list_params(&mut params, &filters, "notification_type");
    if !type_placeholders.is_empty() {
        clauses.push(format!("type IN ({})", type_placeholders.join(", ")));
    }

    let search = normalize_text(search).to_lowercase();
    if !search.is_empty() {
        params.insert("@search_like".into(), Value::String(format!("%{search}%")));
        clauses.push(format!(
            "({})",
            search_columns
                .iter()
                .map(|column| format!("LOWER(COALESCE({column}, '')) LIKE @search_like"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ));
    }

    if clauses.is_empty() {
        (String::new(), params)
    } else {
        (format!(" WHERE {}", clauses.join(" AND ")), params)
    }
}

fn notification_date_millis(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .unwrap_or(0)
}

fn notification_expires_at_expired(value: &str, now: DateTime<Utc>) -> bool {
    if value.trim().is_empty() {
        return false;
    }
    DateTime::parse_from_rfc3339(value)
        .map(|date| date <= now)
        .unwrap_or(false)
}

fn notification_value_text(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(value_as_string)
        .unwrap_or_default()
}

fn notification_matches_search(notification: &NotificationListItemOutput, search: &str) -> bool {
    let search = normalize_text(search).to_lowercase();
    if search.is_empty() {
        return true;
    }

    [
        notification.r#type.clone(),
        notification.sender_username.clone(),
        notification.sender_user_id.clone(),
        notification.title.clone(),
        notification.message.clone(),
        notification.link_text.clone(),
        notification.link.clone(),
        notification_value_text(&notification.details, "worldName"),
        notification_value_text(&notification.details, "worldId"),
        notification_value_text(&notification.details, "inviteMessage"),
        notification_value_text(&notification.details, "requestMessage"),
        notification_value_text(&notification.details, "responseMessage"),
        notification_value_text(&notification.data, "groupName"),
    ]
    .iter()
    .any(|value| value.to_lowercase().contains(&search))
}

fn notification_matches_filters(
    notification: &NotificationListItemOutput,
    filters: &[String],
) -> bool {
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    filters.is_empty() || filters.iter().any(|filter| filter == &notification.r#type)
}

fn notification_v1_list_item(row: NotificationV1RowOutput) -> NotificationListItemOutput {
    let details = json!({
        "worldId": row.world_id,
        "worldName": row.world_name,
        "imageUrl": row.image_url,
        "inviteMessage": row.invite_message,
        "requestMessage": row.request_message,
        "responseMessage": row.response_message,
    });
    NotificationListItemOutput {
        id: row.id,
        version: 1,
        created_at: row.created_at.clone(),
        created_at_legacy: row.created_at,
        updated_at: String::new(),
        expires_at: String::new(),
        r#type: row.r#type,
        link: String::new(),
        link_text: String::new(),
        message: row.message,
        title: String::new(),
        image_url: row.image_url,
        seen: false,
        sender_user_id: row.sender_user_id,
        sender_username: row.sender_username,
        receiver_user_id: row.receiver_user_id,
        data: json!({}),
        responses: json!([]),
        details,
        expired: row.expired == 1,
    }
}

fn notification_v2_list_item(
    row: NotificationV2RowOutput,
    now: DateTime<Utc>,
) -> NotificationListItemOutput {
    let expires_at = row.expires_at;
    let expired = notification_expires_at_expired(&expires_at, now);
    let data = parse_json_value(&Value::String(row.data), json!({}));
    let responses = parse_json_value(&Value::String(row.responses), json!([]));
    let details = parse_json_value(&Value::String(row.details), json!({}));
    NotificationListItemOutput {
        id: row.id,
        version: 2,
        created_at: row.created_at.clone(),
        created_at_legacy: row.created_at,
        updated_at: row.updated_at,
        expires_at,
        r#type: row.r#type,
        link: row.link,
        link_text: row.link_text,
        message: row.message,
        title: row.title,
        image_url: row.image_url,
        seen: row.seen == 1,
        sender_user_id: row.sender_user_id,
        sender_username: row.sender_username,
        receiver_user_id: String::new(),
        data: if data.is_object() { data } else { json!({}) },
        responses: if responses.is_array() {
            responses
        } else {
            json!([])
        },
        details: if details.is_object() {
            details
        } else {
            json!({})
        },
        expired,
    }
}

fn notification_push_dedup(
    deduped: &mut HashMap<String, NotificationListItemOutput>,
    notification: NotificationListItemOutput,
) {
    if notification.id.trim().is_empty() {
        return;
    }
    let should_replace = deduped
        .get(&notification.id)
        .map(|existing| notification.version >= existing.version)
        .unwrap_or(true);
    if should_replace {
        deduped.insert(notification.id.clone(), notification);
    }
}

pub fn app__notification_rows_query(
    db: &DatabaseService,
    query: NotificationRowsQueryInput,
) -> Result<NotificationRowsOutput, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(NotificationRowsOutput {
            v1_rows: Vec::new(),
            v2_rows: Vec::new(),
            unseen_v2_rows: Vec::new(),
        });
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let (where_sql, mut params) = build_type_filter(&query.filters);
    params.insert("@limit".into(), Value::from(limit));

    let v1_rows = db
        .execute(
            &format!(
                "SELECT id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired
                 FROM {user_prefix}_notifications{where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &params,
        )?
        .into_iter()
        .map(|row| notification_v1_from_row(&row))
        .collect();
    let v2_rows = db
        .execute(
            &format!(
                "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                 FROM {user_prefix}_notifications_v2{where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &params,
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect();
    let unseen_v2_rows = if query.include_unseen {
        db
            .execute(
                &format!(
                    "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                     FROM {user_prefix}_notifications_v2
                     WHERE seen = 0
                       AND (expires_at IS NULL OR expires_at = '' OR expires_at > @now)
                     ORDER BY created_at DESC, id DESC"
                ),
                &ParamsBuilder::new().set("now", now_iso()).build(),
            )?
            .into_iter()
            .map(|row| notification_v2_from_row(&row))
            .collect()
    } else {
        Vec::new()
    };

    Ok(NotificationRowsOutput {
        v1_rows,
        v2_rows,
        unseen_v2_rows,
    })
}

fn query_notification_list(
    db: &DatabaseService,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let per_table_limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let final_limit = if query.limit > 0 { query.limit } else { 500 };
    let search = normalize_text(query.search);
    let now = Utc::now();

    let v1_search_columns = [
        "type",
        "sender_username",
        "sender_user_id",
        "message",
        "world_id",
        "world_name",
        "invite_message",
        "request_message",
        "response_message",
    ];
    let v2_search_columns = [
        "type",
        "sender_username",
        "sender_user_id",
        "title",
        "message",
        "link_text",
        "link",
        "data",
        "details",
    ];
    let (v1_where_sql, mut v1_params) =
        notification_filter_params(&query.filters, &search, &v1_search_columns);
    let (v2_where_sql, mut v2_params) =
        notification_filter_params(&query.filters, &search, &v2_search_columns);
    v1_params.insert("@limit".into(), Value::from(per_table_limit));
    v2_params.insert("@limit".into(), Value::from(per_table_limit));

    let v1_rows = db
        .execute(
            &format!(
                "SELECT id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired
                 FROM {user_prefix}_notifications{v1_where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &v1_params,
        )?
        .into_iter()
        .map(|row| notification_v1_from_row(&row));
    let v2_rows = db
        .execute(
            &format!(
                "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                 FROM {user_prefix}_notifications_v2{v2_where_sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit"
            ),
            &v2_params,
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row));
    let unseen_v2_rows = if query.include_unseen {
        db.execute(
            &format!(
                "SELECT id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details
                     FROM {user_prefix}_notifications_v2
                     WHERE seen = 0
                       AND (expires_at IS NULL OR expires_at = '' OR expires_at > @now)
                     ORDER BY created_at DESC, id DESC"
            ),
            &ParamsBuilder::new().set("now", now_iso()).build(),
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut deduped = HashMap::new();
    for row in v1_rows {
        notification_push_dedup(&mut deduped, notification_v1_list_item(row));
    }
    for row in v2_rows {
        notification_push_dedup(&mut deduped, notification_v2_list_item(row, now));
    }
    for row in unseen_v2_rows {
        notification_push_dedup(&mut deduped, notification_v2_list_item(row, now));
    }

    let mut notifications = deduped
        .into_values()
        .filter(|notification| notification_matches_filters(notification, &query.filters))
        .filter(|notification| notification_matches_search(notification, &search))
        .collect::<Vec<_>>();
    notifications.sort_by(|left, right| {
        notification_date_millis(&right.created_at)
            .cmp(&notification_date_millis(&left.created_at))
            .then_with(|| right.id.cmp(&left.id))
    });
    notifications.truncate(final_limit as usize);
    Ok(notifications)
}

pub fn app__notification_list_query(
    db: &DatabaseService,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    query_notification_list(db, query)
}

pub fn app__notification_add_v1(
    db: &DatabaseService,
    user_id: String,
    notification: Value,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;

    let id = object_field_string(&notification, &["id"]);
    let created_at = object_field_string(&notification, &["created_at", "createdAt"]);
    let notification_type = object_field_string(&notification, &["type"]);
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::Custom(
            "Notification is missing required field".into(),
        ));
    }

    let details = object_field(&notification, "details").unwrap_or(&Value::Null);
    let image_url = object_field_string(&notification, &["imageUrl"]);
    let detail_image_url = object_field_string(details, &["imageUrl"]);
    db.execute_non_query(
        &format!("INSERT OR IGNORE INTO {user_prefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @expired)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", created_at)
            .set("type", notification_type)
            .set("sender_user_id", object_field_string(&notification, &["senderUserId"]))
            .set("sender_username", object_field_string(&notification, &["senderUsername"]))
            .set("receiver_user_id", object_field_string(&notification, &["receiverUserId"]))
            .set("message", object_field_string(&notification, &["message"]))
            .set("world_id", object_field_string(details, &["worldId"]))
            .set("world_name", object_field_string(details, &["worldName"]))
            .set("image_url", if detail_image_url.is_empty() { image_url } else { detail_image_url })
            .set("invite_message", object_field_string(details, &["inviteMessage"]))
            .set("request_message", object_field_string(details, &["requestMessage"]))
            .set("response_message", object_field_string(details, &["responseMessage"]))
            .set("expired", if object_field_bool(&notification, "$isExpired") { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

pub fn app__notification_add_v2(
    db: &DatabaseService,
    user_id: String,
    notification: Value,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = object_field_string(&notification, &["id"]);
    if id.is_empty() {
        return Ok(());
    }

    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", object_field_optional_string(&notification, &["createdAt", "created_at"]))
            .set("updated_at", object_field_optional_string(&notification, &["updatedAt", "updated_at"]))
            .set("expires_at", object_field_optional_string(&notification, &["expiresAt", "expires_at"]))
            .set("type", object_field_optional_string(&notification, &["type"]))
            .set("link", object_field_optional_string(&notification, &["link"]))
            .set("link_text", object_field_optional_string(&notification, &["linkText", "link_text"]))
            .set("message", object_field_optional_string(&notification, &["message"]))
            .set("title", object_field_optional_string(&notification, &["title"]))
            .set("image_url", object_field_optional_string(&notification, &["imageUrl", "image_url"]))
            .set("seen", if object_field_bool(&notification, "seen") { 1 } else { 0 })
            .set("sender_user_id", object_field_optional_string(&notification, &["senderUserId", "sender_user_id"]))
            .set("sender_username", object_field_optional_string(&notification, &["senderUsername", "sender_username"]))
            .set("data", object_field_json(&notification, "data", Value::Object(Default::default())))
            .set("responses", object_field_json(&notification, "responses", Value::Array(Vec::new())))
            .set("details", object_field_json(&notification, "details", Value::Object(Default::default())))
            .build(),
    )?;
    Ok(())
}

pub fn app__notification_v2_expire(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).set("expires_at", now_iso()).build(),
    )?;
    Ok(())
}

pub fn app__notification_v2_mark_seen(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )?;
    Ok(())
}

pub fn app__notification_update_expired(
    db: &DatabaseService,
    user_id: String,
    id: String,
    expired: bool,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications SET expired = @expired WHERE id = @id"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("expired", if expired { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

pub fn app__notification_delete(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_notifications WHERE id = @id"),
            &ParamsBuilder::new().set("id", id.clone()).build(),
        )?;
        tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_notifications_v2 WHERE id = @id"),
            &ParamsBuilder::new().set("id", id).build(),
        )?;
        Ok(())
    })?;
    Ok(())
}

pub fn app__notification_expire(
    db: &DatabaseService,
    user_id: String,
    id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    let now = now_iso();
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("UPDATE {user_prefix}_notifications SET expired = 1 WHERE id = @id"),
            &ParamsBuilder::new().set("id", id.clone()).build(),
        )?;
        tx.execute_non_query(
            &format!("UPDATE {user_prefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id"),
            &ParamsBuilder::new().set("id", id).set("expires_at", now).build(),
        )?;
        Ok(())
    })?;
    Ok(())
}

pub fn app__notification_mark_seen_local_bulk(
    db: &DatabaseService,
    user_id: String,
    ids: Vec<String>,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let ids: Vec<String> = ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect();
    db.write_transaction(|tx| {
        for id in &ids {
            tx.execute_non_query(
                &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
                &ParamsBuilder::new().set("id", id.clone()).build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}
