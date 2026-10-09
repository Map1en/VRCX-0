use serde_json::Value;

use crate::activity::activity_iso_from_ms;
use crate::common::{row_string, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::game_log::{ensure_game_log_tables, GameLogLocationEntry, GameLogLocationTimeUpdate};
use crate::ownership::{owner_id_get_or_insert, OwnerId, OwnerRowId};
use crate::Error;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::friend_log::FriendLogCurrentOutput;
use vrcx_0_core::friend_log::{plan_friend_log_upsert, FriendLogCurrent, FriendLogUpsertInput};

use super::schema::{ensure_realtime_tables, normalize_user_table_prefix};
use super::types::*;
use vrcx_0_core::text::first_non_empty;

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
    owner_user_id: &OwnerId,
    batch: &RealtimePersistenceBatch,
) -> Result<RealtimeWriteCounts, Error> {
    write_realtime_batch_inner(db, owner_user_id, batch, None)
}

/// Atomically records a durable collector batch and its replay marker.
pub fn write_realtime_batch_once(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    batch: &RealtimePersistenceBatch,
    batch_id: &str,
) -> Result<RealtimeWriteCounts, Error> {
    if batch_id.is_empty() || batch_id.len() > 128 {
        return Err(Error::InvalidData("Invalid realtime batch id.".into()));
    }
    db.execute_non_query(
        "CREATE TABLE IF NOT EXISTS collector_realtime_batches (owner_user_id TEXT NOT NULL, batch_id TEXT NOT NULL, PRIMARY KEY (owner_user_id, batch_id))",
        &Default::default(),
    )?;
    write_realtime_batch_inner(db, owner_user_id, batch, Some(batch_id))
}

fn write_realtime_batch_inner(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    batch: &RealtimePersistenceBatch,
    batch_id: Option<&str>,
) -> Result<RealtimeWriteCounts, Error> {
    if batch.is_empty() {
        return Ok(RealtimeWriteCounts::default());
    }

    let owner_user_id = OwnerId::new(normalize_user_id(owner_user_id.as_str()));
    if owner_user_id.is_empty() {
        return Err(Error::Database(
            "Realtime persistence requires a current user id.".into(),
        ));
    }
    validate_friend_log_backed_feed_entries(batch)?;
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    ensure_realtime_tables(db, &user_prefix)?;
    let has_game_log_writes =
        !batch.game_log_locations.is_empty() || !batch.game_log_location_time_updates.is_empty();
    if has_game_log_writes {
        ensure_game_log_tables(db)?;
    }
    let owner_id = if has_game_log_writes {
        owner_id_get_or_insert(db, &owner_user_id)?
    } else {
        OwnerRowId::UNASSIGNED
    };
    db.write_transaction(|tx| {
        let replay_args = ParamsBuilder::new()
            .set("owner", owner_user_id.as_str())
            .set("batch", batch_id.unwrap_or_default())
            .build();
        if batch_id.is_some()
            && !tx.execute("SELECT 1 FROM collector_realtime_batches WHERE owner_user_id = @owner AND batch_id = @batch", &replay_args)?.is_empty()
        {
            return Ok(RealtimeWriteCounts::default());
        }
        let mut counts = RealtimeWriteCounts::default();
        for entry in &batch.friend_log_upserts {
            counts.add_realtime_rows(upsert_friend_log_current(tx, &user_prefix, entry)?);
        }
        for entry in &batch.friend_log_deletes {
            counts.add_realtime_rows(delete_friend_log_current(tx, &user_prefix, entry)?);
        }
        for entry in &batch.feed_entries {
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
            counts.add_game_log_rows(insert_game_log_location(tx, owner_id, entry)?);
        }
        for update in &batch.game_log_location_time_updates {
            counts.add_game_log_rows(update_game_log_location_time(tx, owner_id, update)?);
        }
        for observation in &batch.self_profile_observations {
            counts.add_realtime_rows(observe_self_profile_field(tx, &user_prefix, observation)?);
        }
        if batch_id.is_some() {
            tx.execute_non_query("INSERT INTO collector_realtime_batches (owner_user_id, batch_id) VALUES (@owner, @batch)", &replay_args)?;
        }
        Ok(counts)
    })
}

fn validate_friend_log_backed_feed_entries(batch: &RealtimePersistenceBatch) -> Result<(), Error> {
    for entry in &batch.feed_entries {
        let valid = match entry {
            FeedLiveEntry::TrustLevel {
                created_at,
                user_id,
                display_name,
                trust_level,
                previous_trust_level,
                friend_number,
                ..
            } => {
                !trust_level.is_empty()
                    && !previous_trust_level.is_empty()
                    && has_matching_friend_log_upsert(
                        batch,
                        user_id,
                        created_at,
                        display_name,
                        *friend_number,
                        Some(trust_level),
                    )
            }
            FeedLiveEntry::DisplayName {
                created_at,
                user_id,
                display_name,
                previous_display_name,
                friend_number,
                ..
            } => {
                !previous_display_name.trim().is_empty()
                    && has_matching_friend_log_upsert(
                        batch,
                        user_id,
                        created_at,
                        display_name,
                        *friend_number,
                        None,
                    )
            }
            _ => continue,
        };
        if !valid {
            return Err(Error::InvalidData(format!(
                "{} feed entry requires a matching friend-log upsert.",
                entry.entry_type()
            )));
        }
    }
    Ok(())
}

fn has_matching_friend_log_upsert(
    batch: &RealtimePersistenceBatch,
    user_id: &str,
    created_at: &str,
    display_name: &str,
    friend_number: i64,
    trust_level: Option<&str>,
) -> bool {
    let user_id = normalize_user_id(user_id);
    !created_at.is_empty()
        && !user_id.is_empty()
        && batch.friend_log_upserts.iter().any(|upsert| {
            normalize_user_id(&upsert.target_user_id) == user_id
                && upsert.created_at.trim() == created_at
                && upsert.display_name.trim() == display_name.trim()
                && trust_level
                    .is_none_or(|trust_level| upsert.trust_level.trim() == trust_level.trim())
                && upsert.friend_number == friend_number
        })
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
        &ParamsBuilder::new().set("user_id", target_user_id).build(),
    )?;
    let existing = existing_rows
        .first()
        .map(|row| existing_friend_log_row(row));
    let Some(plan) = plan_friend_log_upsert(
        FriendLogUpsertInput {
            target_user_id: &entry.target_user_id,
            display_name: &entry.display_name,
            trust_level: &entry.trust_level,
            friend_number: entry.friend_number,
            force_history: entry.force_history,
        },
        existing.as_ref().map(|existing| FriendLogCurrent {
            display_name: &existing.display_name,
            trust_level: &existing.trust_level,
            friend_number: existing.friend_number,
        }),
        || next_friend_number(tx, user_prefix),
    )?
    else {
        return Ok(0);
    };
    let params = ParamsBuilder::new()
        .set("user_id", plan.user_id.clone())
        .set("display_name", plan.display_name.clone())
        .set("trust_level", plan.trust_level.clone())
        .set("friend_number", plan.friend_number)
        .build();
    let insert_count = tx.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"
        ),
        &params,
    )?;
    let mut affected = affected_count(insert_count);
    if insert_count <= 0 {
        affected = affected.saturating_add(affected_count(tx.execute_non_query(
            &format!(
                "UPDATE {user_prefix}_friend_log_current SET display_name = @display_name, trust_level = @trust_level, friend_number = CASE WHEN @friend_number > 0 THEN @friend_number ELSE friend_number END WHERE user_id = @user_id"
            ),
            &params,
        )?));
    }
    for history in &plan.history {
        affected = affected.saturating_add(add_friend_log_history(
            tx,
            user_prefix,
            &FriendLogHistoryEntry {
                created_at: &entry.created_at,
                entry_type: history.entry_type,
                user_id: &plan.user_id,
                display_name: &plan.display_name,
                previous_display_name: &history.previous_display_name,
                trust_level: &plan.trust_level,
                previous_trust_level: &history.previous_trust_level,
                friend_number: plan.friend_number,
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
    entry: &FeedLiveEntry,
) -> Result<u64, Error> {
    let affected = match entry {
        FeedLiveEntry::Gps {
            created_at,
            user_id,
            display_name,
            location,
            world_name,
            previous_location,
            time,
            group_name,
            ..
        } => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (@created_at, @user_id, @display_name, @location, @world_name, @previous_location, @time, @group_name)"),
            &ParamsBuilder::new()
                .set("created_at", created_at.clone())
                .set("user_id", user_id.clone())
                .set("display_name", display_name.clone())
                .set("location", location.clone())
                .set("world_name", world_name.clone())
                .set("previous_location", previous_location.clone())
                .set("time", *time)
                .set("group_name", group_name.clone())
                .build(),
        )?,
        FeedLiveEntry::Online {
            created_at,
            user_id,
            display_name,
            location,
            world_name,
            group_name,
            time,
            ..
        }
        | FeedLiveEntry::Offline {
            created_at,
            user_id,
            display_name,
            location,
            world_name,
            group_name,
            time,
            ..
        } => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_online_offline (created_at, user_id, display_name, type, location, world_name, time, group_name) VALUES (@created_at, @user_id, @display_name, @type, @location, @world_name, @time, @group_name)"),
            &ParamsBuilder::new()
                .set("created_at", created_at.clone())
                .set("user_id", user_id.clone())
                .set("display_name", display_name.clone())
                .set("type", entry.entry_type())
                .set("location", location.clone())
                .set("world_name", world_name.clone())
                .set("time", time.unwrap_or(0))
                .set("group_name", group_name.clone())
                .build(),
        )?,
        FeedLiveEntry::Status {
            created_at,
            user_id,
            display_name,
            status,
            status_description,
            previous_status,
            previous_status_description,
            ..
        } => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_status (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (@created_at, @user_id, @display_name, @status, @status_description, @previous_status, @previous_status_description)"),
            &ParamsBuilder::new()
                .set("created_at", created_at.clone())
                .set("user_id", user_id.clone())
                .set("display_name", display_name.clone())
                .set("status", status.clone())
                .set("status_description", status_description.clone())
                .set("previous_status", previous_status.clone())
                .set("previous_status_description", previous_status_description.clone())
                .build(),
        )?,
        FeedLiveEntry::Bio {
            created_at,
            user_id,
            display_name,
            bio,
            previous_bio,
            ..
        } => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_bio (created_at, user_id, display_name, bio, previous_bio) VALUES (@created_at, @user_id, @display_name, @bio, @previous_bio)"),
            &ParamsBuilder::new()
                .set("created_at", created_at.clone())
                .set("user_id", user_id.clone())
                .set("display_name", display_name.clone())
                .set("bio", bio.clone())
                .set("previous_bio", previous_bio.clone())
                .build(),
        )?,
        FeedLiveEntry::Avatar {
            created_at,
            user_id,
            display_name,
            owner_id,
            avatar_name,
            current_avatar_image_url,
            previous_current_avatar_image_url,
            ..
        } => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, previous_current_avatar_image_url) VALUES (@created_at, @user_id, @display_name, @owner_id, @avatar_name, @current_avatar_image_url, @previous_current_avatar_image_url)"),
            &ParamsBuilder::new()
                .set("created_at", created_at.clone())
                .set("user_id", user_id.clone())
                .set("display_name", display_name.clone())
                .set("owner_id", owner_id.clone())
                .set("avatar_name", avatar_name.clone())
                .set("current_avatar_image_url", current_avatar_image_url.clone())
                .set("previous_current_avatar_image_url", previous_current_avatar_image_url.clone())
                .build(),
        )?,
        FeedLiveEntry::DisplayName { .. }
        | FeedLiveEntry::TrustLevel { .. }
        | FeedLiveEntry::Friend { .. }
        | FeedLiveEntry::Unfriend { .. } => return Ok(0),
        FeedLiveEntry::OnPlayerJoining { .. } | FeedLiveEntry::InstanceClosed { .. } => {
            return Err(Error::InvalidData(format!(
                "Unknown realtime feed entry type: {}",
                entry.entry_type()
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
    let expired =
        bool_field(notification.get("$isExpired")) || bool_field(notification.get("expired"));
    let seen = bool_field(notification.get("seen")) || expired;
    tx.execute_non_query(
        &format!("INSERT OR IGNORE INTO {user_prefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, location, expired, seen) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @location, @expired, @seen)"),
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
            .set("location", entry_string(notification, "location"))
            .set("expired", if expired { 1 } else { 0 })
            .set("seen", if seen { 1 } else { 0 })
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
        &format!("INSERT INTO {user_prefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, updated_at = excluded.updated_at, expires_at = excluded.expires_at, type = excluded.type, link = excluded.link, link_text = excluded.link_text, message = excluded.message, title = excluded.title, image_url = excluded.image_url, seen = MAX({user_prefix}_notifications_v2.seen, excluded.seen), sender_user_id = excluded.sender_user_id, sender_username = excluded.sender_username, data = excluded.data, responses = excluded.responses, details = excluded.details"),
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
        &format!("UPDATE {user_prefix}_notifications SET expired = 1, seen = 1 WHERE id = @id"),
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

fn observe_self_profile_field(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    observation: &SelfProfileObservation,
) -> Result<u64, Error> {
    let field = observation.field.as_str();
    let previous_value = tx
        .execute(
            &format!(
                "SELECT value FROM {user_prefix}_self_profile_log WHERE field = @field ORDER BY id DESC LIMIT 1"
            ),
            &ParamsBuilder::new().set("field", field).build(),
        )?
        .first()
        .map(|row| row_string(row, 0));
    if previous_value.as_deref() == Some(observation.value.as_str()) {
        return Ok(0);
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_self_profile_log (created_at, field, value, previous_value)
             VALUES (@created_at, @field, @value, @previous_value)"
        ),
        &ParamsBuilder::new()
            .set("created_at", observation.observed_at.clone())
            .set("field", field)
            .set("value", observation.value.clone())
            .set("previous_value", previous_value.unwrap_or_default())
            .build(),
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
    if avatar_id.is_empty() || entry.ended_at_ms <= entry.started_at_ms {
        return Ok(0);
    }
    if entry.time_spent > 0 {
        tx.execute_non_query(
            &format!(
                "INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time)
                 VALUES (@avatar_id, @created_at, @time_spent)
                 ON CONFLICT(avatar_id) DO UPDATE SET time = time + @time_spent"
            ),
            &ParamsBuilder::new()
                .set("avatar_id", avatar_id.clone())
                .set("created_at", entry.created_at.clone())
                .set("time_spent", entry.time_spent)
                .build(),
        )?;
    }
    let params = ParamsBuilder::new()
        .set("avatar_id", avatar_id)
        .set("started_at", activity_iso_from_ms(entry.started_at_ms))
        .set("ended_at", activity_iso_from_ms(entry.ended_at_ms))
        .set("time", entry.ended_at_ms - entry.started_at_ms)
        .build();
    let updated = tx.execute_non_query(
        &format!(
            "UPDATE {user_prefix}_avatar_wear_log SET ended_at = @ended_at, time = @time
             WHERE avatar_id = @avatar_id AND started_at = @started_at"
        ),
        &params,
    )?;
    if updated > 0 {
        return Ok(affected_count(updated));
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_avatar_wear_log (avatar_id, started_at, ended_at, time)
             VALUES (@avatar_id, @started_at, @ended_at, @time)"
        ),
        &params,
    )
    .map(affected_count)
}

fn insert_game_log_location(
    tx: &mut DatabaseWriteTransaction<'_>,
    owner_id: OwnerRowId,
    entry: &GameLogLocationEntry,
) -> Result<u64, Error> {
    if entry.location.trim().is_empty() {
        return Ok(0);
    }
    tx.execute_non_query(
        "INSERT OR IGNORE INTO gamelog_location (created_at, location, world_id, world_name, time, group_name, owner_id) VALUES (@created_at, @location, @world_id, @world_name, @time, @group_name, @owner_id)",
        &ParamsBuilder::new()
            .set("created_at", entry.created_at.clone())
            .set("location", entry.location.clone())
            .set("world_id", entry.world_id.clone())
            .set("world_name", entry.world_name.clone())
            .set("time", entry.time)
            .set("group_name", entry.group_name.clone())
            .set("owner_id", owner_id)
            .build(),
    )
    .map(affected_count)
}

fn update_game_log_location_time(
    tx: &mut DatabaseWriteTransaction<'_>,
    owner_id: OwnerRowId,
    update: &GameLogLocationTimeUpdate,
) -> Result<u64, Error> {
    if update.created_at.trim().is_empty() || update.time < 0 {
        return Ok(0);
    }
    tx.execute_non_query(
        "UPDATE gamelog_location SET time = @time WHERE created_at = @created_at AND owner_id IN (0, @owner_id)",
        &ParamsBuilder::new()
            .set("created_at", update.created_at.clone())
            .set("time", update.time)
            .set("owner_id", owner_id)
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

fn existing_friend_log_row(row: &[Value]) -> FriendLogCurrentOutput {
    FriendLogCurrentOutput {
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

#[cfg(test)]
mod tests;
