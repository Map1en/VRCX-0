use serde_json::Value;

use crate::common::{
    affected_count, bool_field, delete_by_key_sql, insert_or_ignore_sql, insert_or_replace_sql,
    json_string, normalize_text, now_iso, object_field, object_field_bool, object_field_json,
    object_field_optional_string, object_field_string, update_by_key_sql, DbParams, DbWriteTarget,
    ParamsBuilder,
};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;
use vrcx_0_contracts::notifications::AppNotification;
use vrcx_0_contracts::realtime::{NotificationExpiration, NotificationV2Update};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::text::first_non_empty;

use super::schema::{NOTIFICATION_V1_COLUMNS, NOTIFICATION_V2_COLUMNS};

pub fn notification_add_v1(
    db: &DatabaseService,
    user_id: String,
    notification: Value,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    write_notification_v1(
        db,
        &user_prefix,
        notification_v1_params(&notification, false)?,
        false,
    )
}

fn notification_v1_params(notification: &Value, force_active: bool) -> Result<DbParams, Error> {
    let id = normalize_text(object_field_string(notification, &["id"]));
    let created_at = object_field_string(notification, &["created_at", "createdAt"]);
    let notification_type = object_field_string(notification, &["type"]);
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::Custom(
            "Notification is missing required field".into(),
        ));
    }

    let details = object_field(notification, "details").unwrap_or(&Value::Null);
    let image_url = object_field_string(notification, &["imageUrl"]);
    let detail_image_url = object_field_string(details, &["imageUrl"]);
    let expired = !force_active && object_field_bool(notification, "$isExpired");
    let seen = object_field_bool(notification, "seen") || expired;
    Ok(ParamsBuilder::new()
        .set("id", id)
        .set("created_at", created_at)
        .set("type", notification_type)
        .set(
            "sender_user_id",
            object_field_string(notification, &["senderUserId"]),
        )
        .set(
            "sender_username",
            object_field_string(notification, &["senderUsername"]),
        )
        .set(
            "receiver_user_id",
            object_field_string(notification, &["receiverUserId"]),
        )
        .set("message", object_field_string(notification, &["message"]))
        .set("world_id", object_field_string(details, &["worldId"]))
        .set("world_name", object_field_string(details, &["worldName"]))
        .set(
            "image_url",
            if detail_image_url.is_empty() {
                image_url
            } else {
                detail_image_url
            },
        )
        .set(
            "invite_message",
            object_field_string(details, &["inviteMessage"]),
        )
        .set(
            "request_message",
            object_field_string(details, &["requestMessage"]),
        )
        .set(
            "response_message",
            object_field_string(details, &["responseMessage"]),
        )
        .set("location", object_field_string(notification, &["location"]))
        .set("expired", if expired { 1 } else { 0 })
        .set("seen", if seen { 1 } else { 0 })
        .build())
}

fn write_notification_v1(
    target: &impl DbWriteTarget,
    user_prefix: &str,
    params: DbParams,
    replace: bool,
) -> Result<(), Error> {
    let table = format!("{user_prefix}_notifications");
    let sql = if replace {
        let insert = insert_or_replace_sql(&table, NOTIFICATION_V1_COLUMNS).replacen(
            "INSERT OR REPLACE",
            "INSERT",
            1,
        );
        let updates = NOTIFICATION_V1_COLUMNS
            .iter()
            .filter(|column| **column != "id" && **column != "seen")
            .map(|column| format!("{column} = excluded.{column}"))
            .chain(std::iter::once(format!(
                "seen = MAX({table}.seen, excluded.seen)"
            )))
            .collect::<Vec<_>>()
            .join(", ");
        format!("{insert} ON CONFLICT(id) DO UPDATE SET {updates}")
    } else {
        insert_or_ignore_sql(&table, NOTIFICATION_V1_COLUMNS)
    };
    target.execute_non_query(&sql, &params)?;
    Ok(())
}

pub fn notification_friend_requests_sync(
    db: &DatabaseService,
    user_id: String,
    visible: Vec<Value>,
    visible_complete: bool,
    hidden: Vec<Value>,
    hidden_complete: bool,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let visible = visible
        .iter()
        .map(|notification| notification_v1_params(notification, true))
        .collect::<Result<Vec<_>, _>>()?;
    let hidden = hidden
        .iter()
        .map(|notification| notification_v1_params(notification, true))
        .collect::<Result<Vec<_>, _>>()?;
    let table = format!("{user_prefix}_notifications");

    db.write_transaction(|tx| {
        if visible_complete {
            tx.execute_non_query(
                &format!("UPDATE {table} SET expired = 1 WHERE type = @type"),
                &ParamsBuilder::new().set("type", "friendRequest").build(),
            )?;
        }
        if hidden_complete {
            tx.execute_non_query(
                &format!("UPDATE {table} SET expired = 1 WHERE type = @type"),
                &ParamsBuilder::new()
                    .set("type", "ignoredFriendRequest")
                    .build(),
            )?;
        }
        for params in visible.into_iter().chain(hidden) {
            write_notification_v1(tx, &user_prefix, params, true)?;
        }
        Ok(())
    })
}

pub fn notification_add_v2(
    db: &DatabaseService,
    user_id: String,
    notification: Value,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(object_field_string(&notification, &["id"]));
    if id.is_empty() {
        return Ok(());
    }

    let table = format!("{user_prefix}_notifications_v2");
    let insert = insert_or_replace_sql(&table, NOTIFICATION_V2_COLUMNS).replacen(
        "INSERT OR REPLACE",
        "INSERT",
        1,
    );
    let updates = NOTIFICATION_V2_COLUMNS
        .iter()
        .filter(|column| **column != "id" && **column != "seen")
        .map(|column| format!("{column} = excluded.{column}"))
        .chain(std::iter::once(format!(
            "seen = MAX({table}.seen, excluded.seen)"
        )))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("{insert} ON CONFLICT(id) DO UPDATE SET {updates}");
    db.execute_non_query(
        &sql,
        &ParamsBuilder::new()
            .set("id", id)
            .set(
                "created_at",
                object_field_optional_string(&notification, &["createdAt", "created_at"]),
            )
            .set(
                "updated_at",
                object_field_optional_string(&notification, &["updatedAt", "updated_at"]),
            )
            .set(
                "expires_at",
                object_field_optional_string(&notification, &["expiresAt", "expires_at"]),
            )
            .set(
                "type",
                object_field_optional_string(&notification, &["type"]),
            )
            .set(
                "link",
                object_field_optional_string(&notification, &["link"]),
            )
            .set(
                "link_text",
                object_field_optional_string(&notification, &["linkText", "link_text"]),
            )
            .set(
                "message",
                object_field_optional_string(&notification, &["message"]),
            )
            .set(
                "title",
                object_field_optional_string(&notification, &["title"]),
            )
            .set(
                "image_url",
                object_field_optional_string(&notification, &["imageUrl", "image_url"]),
            )
            .set(
                "seen",
                if object_field_bool(&notification, "seen") {
                    1
                } else {
                    0
                },
            )
            .set(
                "sender_user_id",
                object_field_optional_string(&notification, &["senderUserId", "sender_user_id"]),
            )
            .set(
                "sender_username",
                object_field_optional_string(&notification, &["senderUsername", "sender_username"]),
            )
            .set(
                "data",
                object_field_json(&notification, "data", Value::Object(Default::default())),
            )
            .set(
                "responses",
                object_field_json(&notification, "responses", Value::Array(Vec::new())),
            )
            .set(
                "details",
                object_field_json(&notification, "details", Value::Object(Default::default())),
            )
            .build(),
    )?;
    Ok(())
}

pub fn notification_v2_expire(
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
    let table = format!("{user_prefix}_notifications_v2");
    let sql = update_by_key_sql(&table, &["expires_at", "seen"], "id");
    db.execute_non_query(
        &sql,
        &ParamsBuilder::new()
            .set("id", id)
            .set("expires_at", now_iso())
            .set("seen", 1)
            .build(),
    )?;
    Ok(())
}

pub fn notification_v2_mark_seen(
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
    let table = format!("{user_prefix}_notifications_v2");
    let sql = update_by_key_sql(&table, &["seen"], "id");
    db.execute_non_query(
        &sql,
        &ParamsBuilder::new().set("id", id).set("seen", 1).build(),
    )?;
    Ok(())
}

pub fn notification_mark_seen(
    db: &DatabaseService,
    user_id: String,
    id: String,
    version: i64,
) -> Result<(), Error> {
    if version >= 2 {
        notification_v2_mark_seen(db, user_id, id)
    } else {
        notification_v1_mark_seen(db, user_id, id)
    }
}

fn notification_v1_mark_seen(
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
    let table = format!("{user_prefix}_notifications");
    let sql = update_by_key_sql(&table, &["seen"], "id");
    db.execute_non_query(
        &sql,
        &ParamsBuilder::new().set("id", id).set("seen", 1).build(),
    )?;
    Ok(())
}

pub fn notification_update_expired(
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
    let table = format!("{user_prefix}_notifications");
    let params = ParamsBuilder::new().set("id", id);
    let (sql, params) = if expired {
        (
            update_by_key_sql(&table, &["expired", "seen"], "id"),
            params.set("expired", 1).set("seen", 1),
        )
    } else {
        (
            update_by_key_sql(&table, &["expired"], "id"),
            params.set("expired", 0),
        )
    };
    db.execute_non_query(&sql, &params.build())?;
    Ok(())
}

pub fn notification_delete(db: &DatabaseService, user_id: String, id: String) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    let delete_sqls = ["notifications", "notifications_v2", "app_notification_log"]
        .map(|table| delete_by_key_sql(&format!("{user_prefix}_{table}"), "id"));
    db.write_transaction(|tx| {
        for sql in &delete_sqls {
            tx.execute_non_query(sql, &ParamsBuilder::new().set("id", id.clone()).build())?;
        }
        Ok(())
    })?;
    Ok(())
}

pub fn notification_expire(db: &DatabaseService, user_id: String, id: String) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    let now = now_iso();
    let v1_table = format!("{user_prefix}_notifications");
    let v2_table = format!("{user_prefix}_notifications_v2");
    let expire_v1_sql = update_by_key_sql(&v1_table, &["expired", "seen"], "id");
    let expire_v2_sql = update_by_key_sql(&v2_table, &["expires_at", "seen"], "id");
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &expire_v1_sql,
            &ParamsBuilder::new()
                .set("id", id.clone())
                .set("expired", 1)
                .set("seen", 1)
                .build(),
        )?;
        tx.execute_non_query(
            &expire_v2_sql,
            &ParamsBuilder::new()
                .set("id", id)
                .set("expires_at", now)
                .set("seen", 1)
                .build(),
        )?;
        Ok(())
    })?;
    Ok(())
}

pub fn notification_mark_seen_local_bulk(
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
    let table = format!("{user_prefix}_notifications_v2");
    let sql = update_by_key_sql(&table, &["seen"], "id");
    db.write_transaction(|tx| {
        for id in &ids {
            tx.execute_non_query(
                &sql,
                &ParamsBuilder::new()
                    .set("id", id.clone())
                    .set("seen", 1)
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

pub(crate) fn insert_app_notification(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    notification: &AppNotification,
) -> Result<u64, Error> {
    if notification.id.is_empty()
        || notification.created_at.is_empty()
        || notification.r#type.is_empty()
        || notification.message_key.is_empty()
    {
        return Err(Error::InvalidData(
            "App notification requires id, createdAt, type, and messageKey.".into(),
        ));
    }
    let message_params = serde_json::to_string(&notification.message_params)
        .map_err(|error| Error::InvalidData(error.to_string()))?;
    let affected = tx.execute_non_query(
        &insert_or_ignore_sql(
            &format!("{user_prefix}_app_notification_log"),
            crate::notifications::APP_NOTIFICATION_COLUMNS,
        ),
        &ParamsBuilder::new()
            .set("id", notification.id.clone())
            .set("created_at", notification.created_at.clone())
            .set("type", notification.r#type.clone())
            .set("subject_id", notification.subject_id.clone())
            .set("subject_name", notification.subject_name.clone())
            .set("image_url", notification.image_url.clone())
            .set("message_key", notification.message_key.clone())
            .set("message_params", message_params)
            .build(),
    )?;
    Ok(affected_count(affected))
}

pub(crate) fn upsert_notification_v1(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    notification: &Value,
) -> Result<u64, Error> {
    let id = notification.text_field("id");
    let created_at_snake = notification.text_field("created_at");
    let created_at_camel = notification.text_field("createdAt");
    let created_at =
        first_non_empty([created_at_snake.as_str(), created_at_camel.as_str()]).to_string();
    let notification_type = notification.text_field("type");
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::InvalidData(
            "Notification v1 upsert requires id, createdAt/created_at, and type.".into(),
        ));
    }
    let details = notification.get("details").unwrap_or(&Value::Null);
    let expired =
        bool_field(notification.get("$isExpired")) || bool_field(notification.get("expired"));
    let seen = bool_field(notification.get("seen")) || expired;
    tx.execute_non_query(
        &format!("INSERT OR IGNORE INTO {user_prefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, location, expired, seen) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @location, @expired, @seen)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", created_at)
            .set("type", notification_type)
            .set("sender_user_id", notification.text_field("senderUserId"))
            .set("sender_username", notification.text_field("senderUsername"))
            .set("receiver_user_id", notification.text_field("receiverUserId"))
            .set("message", notification.text_field("message"))
            .set("world_id", details.text_field("worldId"))
            .set("world_name", details.text_field("worldName"))
            .set("image_url", {
                let details_image = details.text_field("imageUrl");
                let notification_image = notification.text_field("imageUrl");
                first_non_empty([details_image.as_str(), notification_image.as_str()])
                    .to_string()
            })
            .set("invite_message", details.text_field("inviteMessage"))
            .set("request_message", details.text_field("requestMessage"))
            .set("response_message", details.text_field("responseMessage"))
            .set("location", notification.text_field("location"))
            .set("expired", if expired { 1 } else { 0 })
            .set("seen", if seen { 1 } else { 0 })
            .build(),
    )
    .map(affected_count)
}

pub(crate) fn upsert_notification_v2(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    notification: &Value,
) -> Result<u64, Error> {
    let id = notification.text_field("id");
    let created_at = notification.text_field("createdAt");
    let notification_type = notification.text_field("type");
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::InvalidData(
            "Notification v2 upsert requires id, createdAt, and type.".into(),
        ));
    }
    tx.execute_non_query(
        &format!("INSERT INTO {user_prefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, updated_at = excluded.updated_at, expires_at = excluded.expires_at, type = excluded.type, link = excluded.link, link_text = excluded.link_text, message = excluded.message, title = excluded.title, image_url = excluded.image_url, seen = MAX({user_prefix}_notifications_v2.seen, excluded.seen), sender_user_id = excluded.sender_user_id, sender_username = excluded.sender_username, data = excluded.data, responses = excluded.responses, details = excluded.details"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", created_at)
            .set("updated_at", notification.text_field("updatedAt"))
            .set("expires_at", notification.text_field("expiresAt"))
            .set("type", notification_type)
            .set("link", notification.text_field("link"))
            .set("link_text", notification.text_field("linkText"))
            .set("message", notification.text_field("message"))
            .set("title", notification.text_field("title"))
            .set("image_url", notification.text_field("imageUrl"))
            .set("seen", if bool_field(notification.get("seen")) { 1 } else { 0 })
            .set("sender_user_id", notification.text_field("senderUserId"))
            .set("sender_username", notification.text_field("senderUsername"))
            .set("data", json_string(notification.get("data"), "{}"))
            .set("responses", json_string(notification.get("responses"), "[]"))
            .set("details", json_string(notification.get("details"), "{}"))
            .build(),
    )
    .map(affected_count)
}

pub(crate) fn expire_notification(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &NotificationExpiration,
) -> Result<u64, Error> {
    let id = normalize_text(&entry.id);
    if id.is_empty() {
        return Ok(0);
    }
    let mut affected = affected_count(tx.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id"),
        &ParamsBuilder::new()
            .set("id", id.clone())
            .set("expires_at", entry.expired_at.clone())
            .build(),
    )?);
    affected = affected.saturating_add(affected_count(tx.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications SET expired = 1, seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )?));
    Ok(affected)
}

pub(crate) fn update_notification_v2(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &NotificationV2Update,
) -> Result<u64, Error> {
    let id = normalize_text(&entry.id);
    let Some(updates) = entry.updates.as_object() else {
        return Ok(0);
    };
    if id.is_empty() || updates.is_empty() {
        return Ok(0);
    }

    let mut assignments = Vec::new();
    let mut params = ParamsBuilder::new().set("id", id.clone());
    for (json_key, column) in [
        ("createdAt", "created_at"),
        ("updatedAt", "updated_at"),
        ("expiresAt", "expires_at"),
        ("type", "type"),
        ("link", "link"),
        ("linkText", "link_text"),
        ("message", "message"),
        ("title", "title"),
        ("imageUrl", "image_url"),
        ("senderUserId", "sender_user_id"),
        ("senderUsername", "sender_username"),
    ] {
        if let Some(value) = updates.get(json_key) {
            assignments.push(format!("{column} = @{column}"));
            params = params.set(column, value.clone());
        }
    }
    if let Some(value) = updates.get("seen") {
        assignments.push("seen = @seen".to_string());
        params = params.set("seen", if bool_field(Some(value)) { 1 } else { 0 });
    }
    for (json_key, column, default) in [
        ("data", "data", "{}"),
        ("responses", "responses", "[]"),
        ("details", "details", "{}"),
    ] {
        if updates.contains_key(json_key) {
            assignments.push(format!("{column} = @{column}"));
            params = params.set(column, json_string(updates.get(json_key), default));
        }
    }

    if assignments.is_empty() {
        return Ok(0);
    }
    let updated = tx.execute_non_query(
        &format!(
            "UPDATE {user_prefix}_notifications_v2 SET {} WHERE id = @id",
            assignments.join(", ")
        ),
        &params.build(),
    )?;
    if updated <= 0 {
        let mut notification = updates.clone();
        notification.insert("id".into(), Value::String(id));
        notification
            .entry("createdAt")
            .or_insert_with(|| Value::String(entry.received_at.clone()));
        notification
            .entry("created_at")
            .or_insert_with(|| Value::String(entry.received_at.clone()));
        return upsert_notification_v2(tx, user_prefix, &Value::Object(notification));
    }
    Ok(affected_count(updated))
}

pub(crate) fn mark_notification_seen(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    id: &str,
) -> Result<u64, Error> {
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(0);
    }
    tx.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )
    .map(affected_count)
}

#[cfg(test)]
mod tests;
