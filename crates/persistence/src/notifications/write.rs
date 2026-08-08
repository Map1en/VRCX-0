#![allow(non_snake_case)]

use serde_json::Value;

use crate::common::{
    delete_by_key_sql, insert_or_ignore_sql, insert_or_replace_sql, normalize_text, now_iso,
    object_field, object_field_bool, object_field_json, object_field_optional_string,
    object_field_string, update_by_key_sql, DbParams, DbWriteTarget, ParamsBuilder,
};
use crate::database::DatabaseService;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

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
        .set(
            "expired",
            if !force_active && object_field_bool(notification, "$isExpired") {
                1
            } else {
                0
            },
        )
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
            .filter(|column| **column != "id")
            .map(|column| format!("{column} = excluded.{column}"))
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
        notification_update_expired(db, user_id, id, true)
    }
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
    let sql = update_by_key_sql(&table, &["expired"], "id");
    db.execute_non_query(
        &sql,
        &ParamsBuilder::new()
            .set("id", id)
            .set("expired", if expired { 1 } else { 0 })
            .build(),
    )?;
    Ok(())
}

pub fn notification_delete(db: &DatabaseService, user_id: String, id: String) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let id = normalize_text(id);
    if id.is_empty() {
        return Ok(());
    }
    let v1_table = format!("{user_prefix}_notifications");
    let v2_table = format!("{user_prefix}_notifications_v2");
    let delete_v1_sql = delete_by_key_sql(&v1_table, "id");
    let delete_v2_sql = delete_by_key_sql(&v2_table, "id");
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &delete_v1_sql,
            &ParamsBuilder::new().set("id", id.clone()).build(),
        )?;
        tx.execute_non_query(&delete_v2_sql, &ParamsBuilder::new().set("id", id).build())?;
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
    let expire_v1_sql = update_by_key_sql(&v1_table, &["expired"], "id");
    let expire_v2_sql = update_by_key_sql(&v2_table, &["expires_at", "seen"], "id");
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &expire_v1_sql,
            &ParamsBuilder::new()
                .set("id", id.clone())
                .set("expired", 1)
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

#[cfg(test)]
mod tests;
