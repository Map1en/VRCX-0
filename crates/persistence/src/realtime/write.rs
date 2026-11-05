use crate::avatars::{upsert_avatar_history, upsert_avatar_time_spent};
use crate::common::normalize_text;
use crate::database::DatabaseService;
use crate::feed::insert_feed_entry;
use crate::friends::{delete_friend_log_current, upsert_friend_log_current};
use crate::game_log::{
    ensure_game_log_tables, insert_game_log_location, update_game_log_location_time,
};
use crate::notifications::{
    expire_notification, insert_app_notification, mark_notification_seen, update_notification_v2,
    upsert_notification_v1, upsert_notification_v2,
};
use crate::ownership::{owner_id_get_or_insert, OwnerId, OwnerRowId};
use crate::Error;
use vrcx_0_contracts::feed_live::FeedLiveEntry;

use super::schema::{ensure_realtime_tables, normalize_user_table_prefix};
use super::self_profile::observe_self_profile_field;
use super::types::*;

pub fn write_realtime_batch(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    batch: &RealtimePersistenceBatch,
) -> Result<RealtimeWriteCounts, Error> {
    if batch.is_empty() {
        return Ok(RealtimeWriteCounts::default());
    }

    let owner_user_id = OwnerId::new(normalize_text(owner_user_id.as_str()));
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
        for notification in &batch.app_notification_upserts {
            counts.add_realtime_rows(insert_app_notification(tx, &user_prefix, notification)?);
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
    let user_id = normalize_text(user_id);
    !created_at.is_empty()
        && !user_id.is_empty()
        && batch.friend_log_upserts.iter().any(|upsert| {
            normalize_text(&upsert.target_user_id) == user_id
                && upsert.created_at.trim() == created_at
                && upsert.display_name.trim() == display_name.trim()
                && trust_level
                    .is_none_or(|trust_level| upsert.trust_level.trim() == trust_level.trim())
                && upsert.friend_number == friend_number
        })
}

#[cfg(test)]
mod tests;
