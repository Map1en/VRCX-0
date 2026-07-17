use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::game_log::{ensure_game_log_tables, GameLogLocationEntry};
use crate::Error;
use vrcx_0_core::trust::trust_level_changed;

use super::schema::{ensure_realtime_tables, normalize_user_table_prefix};
use super::types::*;

#[derive(Clone, Debug, Default)]
struct ExistingFriendLogRow {
    user_id: String,
    display_name: String,
    trust_level: String,
    friend_number: i64,
}

struct FriendLogHistoryEntry<'a> {
    created_at: &'a str,
    entry_type: &'a str,
    user_id: &'a str,
    display_name: &'a str,
    previous_display_name: &'a str,
    trust_level: &'a str,
    previous_trust_level: &'a str,
    friend_number: i64,
}

pub fn write_realtime_batch(
    db: &DatabaseService,
    owner_user_id: &str,
    batch: &RealtimePersistenceBatch,
) -> Result<RealtimeWriteCounts, Error> {
    if batch.is_empty() {
        return Ok(RealtimeWriteCounts::default());
    }

    let owner_user_id = normalize_user_id(owner_user_id);
    if owner_user_id.is_empty() {
        return Err(Error::Database(
            "Realtime persistence requires a current user id.".into(),
        ));
    }
    validate_friend_log_backed_feed_entries(batch)?;
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    if !batch.game_log_locations.is_empty() {
        ensure_game_log_tables(db)?;
    }
    db.write_transaction(|tx| {
        let mut counts = RealtimeWriteCounts::default();
        for entry in &batch.friend_log_upserts {
            counts.add_realtime_rows(upsert_friend_log_current(tx, &user_prefix, entry)?);
        }
        for entry in &batch.friend_log_deletes {
            counts.add_realtime_rows(delete_friend_log_current(tx, &user_prefix, entry)?);
        }
        for entry in &batch.feed_entries {
            if matches!(
                entry_string(entry, "type").as_str(),
                "TrustLevel" | "Friend" | "Unfriend"
            ) {
                continue;
            }
            counts.add_realtime_rows(insert_feed_entry(tx, &user_prefix, entry)?);
        }
        for entry in &batch.notification_v1_upserts {
            counts.add_realtime_rows(upsert_notification_v1(tx, &user_prefix, entry)?);
        }
        for entry in &batch.notification_v2_upserts {
            counts.add_realtime_rows(upsert_notification_v2(tx, &user_prefix, entry)?);
        }
        for entry in &batch.notification_v2_updates {
            counts.add_realtime_rows(update_notification_v2(tx, &user_prefix, entry)?);
        }
        for entry in &batch.notification_expirations {
            counts.add_realtime_rows(expire_notification(tx, &user_prefix, entry)?);
        }
        for id in &batch.notification_seen {
            counts.add_realtime_rows(mark_notification_seen(tx, &user_prefix, id)?);
        }
        for entry in &batch.avatar_history_upserts {
            counts.add_realtime_rows(upsert_avatar_history(tx, &user_prefix, entry)?);
        }
        for entry in &batch.avatar_time_spent_upserts {
            counts.add_realtime_rows(upsert_avatar_time_spent(tx, &user_prefix, entry)?);
        }
        for entry in &batch.game_log_locations {
            counts.add_game_log_rows(insert_game_log_location_if_changed(tx, entry)?);
        }
        Ok(counts)
    })
}

fn validate_friend_log_backed_feed_entries(batch: &RealtimePersistenceBatch) -> Result<(), Error> {
    for entry in batch
        .feed_entries
        .iter()
        .filter(|entry| entry_string(entry, "type") == "TrustLevel")
    {
        let created_at = entry_string(entry, "created_at");
        let user_id = normalize_user_id(&entry_string(entry, "userId"));
        let display_name = entry_string(entry, "displayName");
        let trust_level = entry_string(entry, "trustLevel");
        let previous_trust_level = entry_string(entry, "previousTrustLevel");
        let friend_number = entry_i64(entry, "friendNumber");
        let valid = !created_at.is_empty()
            && !user_id.is_empty()
            && !trust_level.is_empty()
            && !previous_trust_level.is_empty()
            && entry.get("friendNumber").is_some()
            && batch.friend_log_upserts.iter().any(|upsert| {
                normalize_user_id(&upsert.target_user_id) == user_id
                    && upsert.created_at.trim() == created_at
                    && upsert.display_name.trim() == display_name.trim()
                    && upsert.trust_level.trim() == trust_level.trim()
                    && upsert.friend_number == friend_number
            });
        if !valid {
            return Err(Error::InvalidData(
                "TrustLevel feed entry requires a matching friend-log upsert.".into(),
            ));
        }
    }
    Ok(())
}

fn upsert_friend_log_current(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogUpsert,
) -> Result<u64, Error> {
    let target_user_id = normalize_user_id(&entry.target_user_id);
    if target_user_id.is_empty() {
        return Ok(0);
    }
    let existing_rows = tx.execute(
        &format!(
            "SELECT user_id, display_name, trust_level, friend_number FROM {user_prefix}_friend_log_current WHERE user_id = @user_id LIMIT 1"
        ),
        &ParamsBuilder::new().set("user_id", target_user_id.clone()).build(),
    )?;
    let existing = existing_rows
        .first()
        .map(|row| existing_friend_log_row(row));
    let friend_number = if entry.friend_number > 0 {
        entry.friend_number
    } else if let Some(existing) = existing.as_ref() {
        existing.friend_number
    } else {
        next_friend_number(tx, user_prefix)?
    };
    let existing_display_name = existing
        .as_ref()
        .map(|existing| existing.display_name.trim())
        .unwrap_or("");
    let entry_display_name = entry.display_name.trim();
    let display_name = if !entry_display_name.is_empty() && entry_display_name != "Unknown" {
        entry_display_name
    } else if !existing_display_name.is_empty() && existing_display_name != "Unknown" {
        existing_display_name
    } else {
        "Unknown"
    };
    let existing_trust_level = existing
        .as_ref()
        .map(|existing| existing.trust_level.trim())
        .unwrap_or("");
    let trust_level =
        first_non_empty([entry.trust_level.as_str(), existing_trust_level, "Visitor"]);
    let insert_count = tx.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"
        ),
        &ParamsBuilder::new()
            .set("user_id", target_user_id.clone())
            .set("display_name", display_name)
            .set("trust_level", trust_level)
            .set("friend_number", friend_number)
            .build(),
    )?;
    let mut affected = affected_count(insert_count);
    if insert_count <= 0 {
        affected = affected.saturating_add(affected_count(tx.execute_non_query(
            &format!(
                "UPDATE {user_prefix}_friend_log_current SET display_name = @display_name, trust_level = @trust_level, friend_number = CASE WHEN @friend_number > 0 THEN @friend_number ELSE friend_number END WHERE user_id = @user_id"
            ),
            &ParamsBuilder::new()
                .set("user_id", target_user_id.clone())
                .set("display_name", display_name)
                .set("trust_level", trust_level)
                .set("friend_number", friend_number)
                .build(),
        )?));
        let renamed = !existing_display_name.is_empty()
            && existing_display_name != "Unknown"
            && display_name != "Unknown"
            && display_name != existing_display_name;
        if renamed {
            affected = affected.saturating_add(add_friend_log_history(
                tx,
                user_prefix,
                &FriendLogHistoryEntry {
                    created_at: &entry.created_at,
                    entry_type: "DisplayName",
                    user_id: &target_user_id,
                    display_name,
                    previous_display_name: existing_display_name,
                    trust_level,
                    previous_trust_level: "",
                    friend_number,
                },
            )?);
        }
        if trust_level_changed(existing_trust_level, trust_level) {
            affected = affected.saturating_add(add_friend_log_history(
                tx,
                user_prefix,
                &FriendLogHistoryEntry {
                    created_at: &entry.created_at,
                    entry_type: "TrustLevel",
                    user_id: &target_user_id,
                    display_name,
                    previous_display_name: "",
                    trust_level,
                    previous_trust_level: existing_trust_level,
                    friend_number,
                },
            )?);
        }
        if entry.force_history {
            affected = affected.saturating_add(add_friend_log_history(
                tx,
                user_prefix,
                &FriendLogHistoryEntry {
                    created_at: &entry.created_at,
                    entry_type: "Friend",
                    user_id: &target_user_id,
                    display_name,
                    previous_display_name: "",
                    trust_level,
                    previous_trust_level: "",
                    friend_number,
                },
            )?);
        }
    } else {
        affected = affected.saturating_add(add_friend_log_history(
            tx,
            user_prefix,
            &FriendLogHistoryEntry {
                created_at: &entry.created_at,
                entry_type: "Friend",
                user_id: &target_user_id,
                display_name,
                previous_display_name: "",
                trust_level,
                previous_trust_level: "",
                friend_number,
            },
        )?);
    }
    Ok(affected)
}

fn delete_friend_log_current(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogDelete,
) -> Result<u64, Error> {
    let target_user_id = normalize_user_id(&entry.target_user_id);
    if target_user_id.is_empty() {
        return Ok(0);
    }
    let existing_rows = tx.execute(
        &format!(
            "SELECT user_id, display_name, trust_level, friend_number FROM {user_prefix}_friend_log_current WHERE user_id = @user_id LIMIT 1"
        ),
        &ParamsBuilder::new().set("user_id", target_user_id.clone()).build(),
    )?;
    let Some(existing) = existing_rows
        .first()
        .map(|row| existing_friend_log_row(row))
    else {
        return Ok(0);
    };
    let deleted = tx.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
        &ParamsBuilder::new().set("user_id", target_user_id).build(),
    )?;
    let mut affected = affected_count(deleted);
    if deleted > 0 {
        affected = affected.saturating_add(add_friend_log_history(
            tx,
            user_prefix,
            &FriendLogHistoryEntry {
                created_at: &entry.created_at,
                entry_type: "Unfriend",
                user_id: &existing.user_id,
                display_name: &existing.display_name,
                previous_display_name: "",
                trust_level: &existing.trust_level,
                previous_trust_level: "",
                friend_number: existing.friend_number,
            },
        )?);
    }
    Ok(affected)
}

fn add_friend_log_history(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogHistoryEntry<'_>,
) -> Result<u64, Error> {
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)"
        ),
        &ParamsBuilder::new()
            .set("created_at", entry.created_at)
            .set("type", entry.entry_type)
            .set("user_id", entry.user_id)
            .set("display_name", entry.display_name)
            .set("previous_display_name", entry.previous_display_name)
            .set("trust_level", entry.trust_level)
            .set("previous_trust_level", entry.previous_trust_level)
            .set("friend_number", entry.friend_number)
            .build(),
    )
    .map(affected_count)
}

fn insert_feed_entry(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &Value,
) -> Result<u64, Error> {
    let entry_type = entry_string(entry, "type");
    let affected = match entry_type.as_str() {
        "GPS" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (@created_at, @user_id, @display_name, @location, @world_name, @previous_location, @time, @group_name)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("location", entry_string(entry, "location"))
                .set("world_name", entry_string(entry, "worldName"))
                .set("previous_location", entry_string(entry, "previousLocation"))
                .set("time", entry_i64(entry, "time"))
                .set("group_name", entry_string(entry, "groupName"))
                .build(),
        )?,
        "Online" | "Offline" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_online_offline (created_at, user_id, display_name, type, location, world_name, time, group_name) VALUES (@created_at, @user_id, @display_name, @type, @location, @world_name, @time, @group_name)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("type", entry_type)
                .set("location", entry_string(entry, "location"))
                .set("world_name", entry_string(entry, "worldName"))
                .set("time", entry_i64(entry, "time"))
                .set("group_name", entry_string(entry, "groupName"))
                .build(),
        )?,
        "Status" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_status (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (@created_at, @user_id, @display_name, @status, @status_description, @previous_status, @previous_status_description)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("status", entry_string(entry, "status"))
                .set("status_description", entry_string(entry, "statusDescription"))
                .set("previous_status", entry_string(entry, "previousStatus"))
                .set("previous_status_description", entry_string(entry, "previousStatusDescription"))
                .build(),
        )?,
        "Bio" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_bio (created_at, user_id, display_name, bio, previous_bio) VALUES (@created_at, @user_id, @display_name, @bio, @previous_bio)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("bio", entry_string(entry, "bio"))
                .set("previous_bio", entry_string(entry, "previousBio"))
                .build(),
        )?,
        "Avatar" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) VALUES (@created_at, @user_id, @display_name, @owner_id, @avatar_name, @current_avatar_image_url, @current_avatar_thumbnail_image_url, @previous_current_avatar_image_url, @previous_current_avatar_thumbnail_image_url)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("owner_id", entry_string(entry, "ownerId"))
                .set("avatar_name", entry_string(entry, "avatarName"))
                .set("current_avatar_image_url", entry_string(entry, "currentAvatarImageUrl"))
                .set("current_avatar_thumbnail_image_url", entry_string(entry, "currentAvatarThumbnailImageUrl"))
                .set("previous_current_avatar_image_url", entry_string(entry, "previousCurrentAvatarImageUrl"))
                .set("previous_current_avatar_thumbnail_image_url", entry_string(entry, "previousCurrentAvatarThumbnailImageUrl"))
                .build(),
        )?,
        other => {
            return Err(Error::InvalidData(format!(
                "Unknown realtime feed entry type: {other}"
            )));
        }
    };
    Ok(affected_count(affected))
}

fn upsert_notification_v1(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    notification: &Value,
) -> Result<u64, Error> {
    let id = entry_string(notification, "id");
    let created_at_snake = entry_string(notification, "created_at");
    let created_at_camel = entry_string(notification, "createdAt");
    let created_at =
        first_non_empty([created_at_snake.as_str(), created_at_camel.as_str()]).to_string();
    let notification_type = entry_string(notification, "type");
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::InvalidData(
            "Notification v1 upsert requires id, createdAt/created_at, and type.".into(),
        ));
    }
    let details = notification.get("details").unwrap_or(&Value::Null);
    tx.execute_non_query(
        &format!("INSERT OR IGNORE INTO {user_prefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @expired)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", created_at)
            .set("type", notification_type)
            .set("sender_user_id", entry_string(notification, "senderUserId"))
            .set("sender_username", entry_string(notification, "senderUsername"))
            .set("receiver_user_id", entry_string(notification, "receiverUserId"))
            .set("message", entry_string(notification, "message"))
            .set("world_id", entry_string(details, "worldId"))
            .set("world_name", entry_string(details, "worldName"))
            .set("image_url", {
                let details_image = entry_string(details, "imageUrl");
                let notification_image = entry_string(notification, "imageUrl");
                first_non_empty([details_image.as_str(), notification_image.as_str()])
                    .to_string()
            })
            .set("invite_message", entry_string(details, "inviteMessage"))
            .set("request_message", entry_string(details, "requestMessage"))
            .set("response_message", entry_string(details, "responseMessage"))
            .set(
                "expired",
                if bool_field(notification.get("$isExpired"))
                    || bool_field(notification.get("expired"))
                {
                    1
                } else {
                    0
                },
            )
            .build(),
    )
    .map(affected_count)
}

fn upsert_notification_v2(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    notification: &Value,
) -> Result<u64, Error> {
    let id = entry_string(notification, "id");
    let created_at = entry_string(notification, "createdAt");
    let notification_type = entry_string(notification, "type");
    if id.is_empty() || created_at.is_empty() || notification_type.is_empty() {
        return Err(Error::InvalidData(
            "Notification v2 upsert requires id, createdAt, and type.".into(),
        ));
    }
    tx.execute_non_query(
        &format!("INSERT OR REPLACE INTO {user_prefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details)"),
        &ParamsBuilder::new()
            .set("id", id)
            .set("created_at", created_at)
            .set("updated_at", entry_string(notification, "updatedAt"))
            .set("expires_at", entry_string(notification, "expiresAt"))
            .set("type", notification_type)
            .set("link", entry_string(notification, "link"))
            .set("link_text", entry_string(notification, "linkText"))
            .set("message", entry_string(notification, "message"))
            .set("title", entry_string(notification, "title"))
            .set("image_url", entry_string(notification, "imageUrl"))
            .set("seen", if bool_field(notification.get("seen")) { 1 } else { 0 })
            .set("sender_user_id", entry_string(notification, "senderUserId"))
            .set("sender_username", entry_string(notification, "senderUsername"))
            .set("data", json_string(notification.get("data"), "{}"))
            .set("responses", json_string(notification.get("responses"), "[]"))
            .set("details", json_string(notification.get("details"), "{}"))
            .build(),
    )
    .map(affected_count)
}

fn expire_notification(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &NotificationExpiration,
) -> Result<u64, Error> {
    let id = normalize_user_id(&entry.id);
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
        &format!("UPDATE {user_prefix}_notifications SET expired = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )?));
    Ok(affected)
}

fn update_notification_v2(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &NotificationV2Update,
) -> Result<u64, Error> {
    let id = normalize_user_id(&entry.id);
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

fn mark_notification_seen(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    id: &str,
) -> Result<u64, Error> {
    let id = normalize_user_id(id);
    if id.is_empty() {
        return Ok(0);
    }
    tx.execute_non_query(
        &format!("UPDATE {user_prefix}_notifications_v2 SET seen = 1 WHERE id = @id"),
        &ParamsBuilder::new().set("id", id).build(),
    )
    .map(affected_count)
}

fn upsert_avatar_history(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &AvatarHistoryUpsert,
) -> Result<u64, Error> {
    let avatar_id = normalize_user_id(&entry.avatar_id);
    if avatar_id.is_empty() {
        return Ok(0);
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time)
             VALUES (@avatar_id, @created_at, 0)
             ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at"
        ),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", entry.created_at.clone())
            .build(),
    )
    .map(affected_count)
}

fn upsert_avatar_time_spent(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &AvatarTimeSpentUpsert,
) -> Result<u64, Error> {
    let avatar_id = normalize_user_id(&entry.avatar_id);
    if avatar_id.is_empty() || entry.time_spent <= 0 {
        return Ok(0);
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time)
             VALUES (@avatar_id, @created_at, @time_spent)
             ON CONFLICT(avatar_id) DO UPDATE SET time = time + @time_spent"
        ),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", entry.created_at.clone())
            .set("time_spent", entry.time_spent)
            .build(),
    )
    .map(affected_count)
}

fn insert_game_log_location_if_changed(
    tx: &mut DatabaseWriteTransaction<'_>,
    entry: &GameLogLocationEntry,
) -> Result<u64, Error> {
    if entry.location.trim().is_empty() {
        return Ok(0);
    }
    let rows = tx.execute(
        "SELECT location FROM gamelog_location ORDER BY created_at DESC, id DESC LIMIT 1",
        &Default::default(),
    )?;
    let latest = rows
        .first()
        .and_then(|row| row.first())
        .and_then(Value::as_str)
        .unwrap_or("");
    if latest == entry.location {
        return Ok(0);
    }
    tx.execute_non_query(
        "INSERT OR IGNORE INTO gamelog_location (created_at, location, world_id, world_name, time, group_name) VALUES (@created_at, @location, @world_id, @world_name, @time, @group_name)",
        &ParamsBuilder::new()
            .set("created_at", entry.created_at.clone())
            .set("location", entry.location.clone())
            .set("world_id", entry.world_id.clone())
            .set("world_name", entry.world_name.clone())
            .set("time", entry.time)
            .set("group_name", entry.group_name.clone())
            .build(),
    )
    .map(affected_count)
}

fn affected_count(count: i64) -> u64 {
    count.max(0) as u64
}

fn next_friend_number(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
) -> Result<i64, Error> {
    let rows = tx.execute(
        &format!("SELECT MAX(friend_number), COUNT(*) FROM {user_prefix}_friend_log_current"),
        &Default::default(),
    )?;
    let max_number = rows
        .first()
        .and_then(|row| row.first())
        .and_then(value_to_i64)
        .unwrap_or(0);
    let count = rows
        .first()
        .and_then(|row| row.get(1))
        .and_then(value_to_i64)
        .unwrap_or(0);
    Ok(if max_number > 0 {
        max_number + 1
    } else {
        count + 1
    })
}

fn existing_friend_log_row(row: &[Value]) -> ExistingFriendLogRow {
    ExistingFriendLogRow {
        user_id: row
            .first()
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        display_name: row.get(1).and_then(Value::as_str).unwrap_or("").to_string(),
        trust_level: row
            .get(2)
            .and_then(Value::as_str)
            .unwrap_or("Visitor")
            .to_string(),
        friend_number: row.get(3).and_then(value_to_i64).unwrap_or(0),
    }
}

fn normalize_user_id(value: &str) -> String {
    value.trim().to_string()
}

fn entry_string(entry: &Value, key: &str) -> String {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            entry
                .get(key)
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
}

fn entry_i64(entry: &Value, key: &str) -> i64 {
    entry.get(key).and_then(value_to_i64).unwrap_or(0)
}

fn value_to_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| {
            value
                .as_str()
                .and_then(|value| value.trim().parse::<i64>().ok())
        })
}

fn bool_field(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

fn json_string(value: Option<&Value>, default: &str) -> String {
    value
        .filter(|value| !value.is_null())
        .map(ToString::to_string)
        .unwrap_or_else(|| default.to_string())
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

#[cfg(test)]
mod tests;
