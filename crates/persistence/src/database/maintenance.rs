use serde_json::Value;
use vrcx_0_contracts::database_maintenance::{MaintenanceTableSizesOutput, UserTableContextOutput};

use crate::common::{normalize_text, row_i64, row_string, value_as_i64, ParamsBuilder};
use crate::database::schema::{
    add_column_if_missing, add_legacy_indexes, add_notification_indexes, add_v17_global_indexes,
    drop_column_if_exists, ensure_global_store_tables, ensure_user_store_tables, safe_identifier,
    select_table_names, table_column_names,
};
use crate::game_log::{claim_legacy_ownership, ensure_game_log_tables};
use crate::ownership::OwnerId;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::DatabaseService;

mod avatar_cleanup;
mod copresence_repair;
mod leave_location_repair;

pub use avatar_cleanup::avatar_auto_cleanup_run;
use copresence_repair::repair_zero_copresence_durations;
use leave_location_repair::repair_empty_leave_locations;

pub fn vacuum_after_secret_migration(db: &DatabaseService) -> Result<(), Error> {
    db.checkpoint_and_vacuum()
}

const VACUUM_MIN_FREE_PAGE_RATIO: f64 = 0.10;
const VACUUM_MIN_FREE_PAGES: i64 = 1024;

fn read_page_stats(db: &DatabaseService) -> Result<(i64, i64), Error> {
    let rows = db.execute(
        "SELECT (SELECT freelist_count FROM pragma_freelist_count()), \
         (SELECT page_count FROM pragma_page_count())",
        &Default::default(),
    )?;
    let Some(row) = rows.first() else {
        return Ok((0, 0));
    };
    Ok((row_i64(row, 0), row_i64(row, 1)))
}

pub fn database_vacuum_if_fragmented(db: &DatabaseService) -> Result<bool, Error> {
    let (free_pages, page_count) = read_page_stats(db)?;
    if free_pages < VACUUM_MIN_FREE_PAGES
        || page_count <= 0
        || (free_pages as f64) < (page_count as f64) * VACUUM_MIN_FREE_PAGE_RATIO
    {
        return Ok(false);
    }
    run_database_maintenance_task(db, DatabaseMaintenanceTask::Vacuum)?;
    Ok(true)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabaseMaintenanceTask {
    Vacuum,
    Optimize,
    UpdateTableForGroupNames,
    AddFriendLogFriendNumber,
    UpdateTableForAvatarHistory,
    AddLegacyPerformanceIndexes,
    AddV17GlobalPerformanceIndexes,
    AddNotificationPerformanceIndexes,
    CleanLegendFromFriendLog,
    FixGameLogTraveling,
    FixNegativeGPS,
    FixBrokenLeaveEntries,
    FixBrokenGroupInvites,
    FixBrokenNotifications,
    FixBrokenGroupChange,
    FixCancelFriendRequestTypo,
    FixBrokenGameLogDisplayNames,
    RepairZeroCopresenceDurations,
    RepairEmptyLeaveLocations,
    RepairExpiredNotificationsSeen,
    ImportUpstreamPrintFavorites,
    ImportUpstreamHmdNotificationSettings,
}

impl DatabaseMaintenanceTask {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Vacuum => "vacuum",
            Self::Optimize => "optimize",
            Self::UpdateTableForGroupNames => "updateTableForGroupNames",
            Self::AddFriendLogFriendNumber => "addFriendLogFriendNumber",
            Self::UpdateTableForAvatarHistory => "updateTableForAvatarHistory",
            Self::AddLegacyPerformanceIndexes => "addLegacyPerformanceIndexes",
            Self::AddV17GlobalPerformanceIndexes => "addV17GlobalPerformanceIndexes",
            Self::AddNotificationPerformanceIndexes => "addNotificationPerformanceIndexes",
            Self::CleanLegendFromFriendLog => "cleanLegendFromFriendLog",
            Self::FixGameLogTraveling => "fixGameLogTraveling",
            Self::FixNegativeGPS => "fixNegativeGPS",
            Self::FixBrokenLeaveEntries => "fixBrokenLeaveEntries",
            Self::FixBrokenGroupInvites => "fixBrokenGroupInvites",
            Self::FixBrokenNotifications => "fixBrokenNotifications",
            Self::FixBrokenGroupChange => "fixBrokenGroupChange",
            Self::FixCancelFriendRequestTypo => "fixCancelFriendRequestTypo",
            Self::FixBrokenGameLogDisplayNames => "fixBrokenGameLogDisplayNames",
            Self::RepairZeroCopresenceDurations => "repairZeroCopresenceDurations",
            Self::RepairEmptyLeaveLocations => "repairEmptyLeaveLocations",
            Self::RepairExpiredNotificationsSeen => "repairExpiredNotificationsSeen",
            Self::ImportUpstreamPrintFavorites => "importUpstreamPrintFavorites",
            Self::ImportUpstreamHmdNotificationSettings => "importUpstreamHmdNotificationSettings",
        }
    }
}

pub fn user_tables_ensure(
    db: &DatabaseService,
    user_id: String,
) -> Result<UserTableContextOutput, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    claim_legacy_ownership(db, &OwnerId::new(user_id.clone()))?;
    Ok(UserTableContextOutput {
        user_id,
        user_prefix,
    })
}

pub fn database_maintenance_run(
    db: &DatabaseService,
    task: DatabaseMaintenanceTask,
) -> Result<(), Error> {
    run_database_maintenance_task(db, task)
}

pub fn ensure_required_database_schema(db: &DatabaseService) -> Result<(), Error> {
    ensure_game_log_tables(db)?;
    ensure_global_store_tables(db)
}

fn run_database_maintenance_task(
    db: &DatabaseService,
    task: DatabaseMaintenanceTask,
) -> Result<(), Error> {
    match task {
        DatabaseMaintenanceTask::Vacuum => {
            db.execute_non_query_exclusive("VACUUM", &Default::default())?;
            if let Err(error) = db.checkpoint_wal() {
                tracing::warn!("failed to truncate WAL after vacuum: {error}");
            }
        }
        DatabaseMaintenanceTask::Optimize => {
            db.execute_non_query("PRAGMA optimize", &Default::default())?;
        }
        DatabaseMaintenanceTask::UpdateTableForGroupNames => {
            for table_name in select_table_names(
                db,
                "name LIKE '%_feed_gps' OR name LIKE '%_feed_online_offline' OR name = 'gamelog_location'",
            )? {
                add_column_if_missing(db, &table_name, "group_name", "TEXT DEFAULT ''")?;
            }
            let mut columns = table_column_names(db, "gamelog_location")?;
            if columns.contains("groupName") {
                if !columns.contains("group_name") {
                    add_column_if_missing(db, "gamelog_location", "group_name", "TEXT DEFAULT ''")?;
                    columns = table_column_names(db, "gamelog_location")?;
                }
                if columns.contains("group_name") {
                    db.execute_non_query(
                        "UPDATE gamelog_location SET group_name = groupName WHERE (group_name IS NULL OR group_name = '') AND groupName IS NOT NULL AND groupName != ''",
                        &Default::default(),
                    )?;
                }
                drop_column_if_exists(db, "gamelog_location", "groupName")?;
            }
        }
        DatabaseMaintenanceTask::AddFriendLogFriendNumber => {
            for table_name in select_table_names(
                db,
                "name LIKE '%_friend_log_current' OR name LIKE '%_friend_log_history'",
            )? {
                add_column_if_missing(db, &table_name, "friend_number", "INTEGER DEFAULT 0")?;
            }
        }
        DatabaseMaintenanceTask::UpdateTableForAvatarHistory => {
            for table_name in select_table_names(db, "name LIKE '%_avatar_history'")? {
                add_column_if_missing(db, &table_name, "time", "INTEGER DEFAULT 0")?;
            }
        }
        DatabaseMaintenanceTask::AddLegacyPerformanceIndexes => add_legacy_indexes(db)?,
        DatabaseMaintenanceTask::AddV17GlobalPerformanceIndexes => add_v17_global_indexes(db)?,
        DatabaseMaintenanceTask::AddNotificationPerformanceIndexes => add_notification_indexes(db)?,
        DatabaseMaintenanceTask::CleanLegendFromFriendLog => {
            for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
                db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z' AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))"),
                    &Default::default(),
                )?;
            }
        }
        DatabaseMaintenanceTask::FixGameLogTraveling => {
            let traveling = db.execute(
                "SELECT id, created_at, display_name FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND location = 'traveling'",
                &Default::default(),
            )?;
            for row in traveling.into_iter().rev() {
                let row_id = row.first().cloned().unwrap_or(Value::Null);
                let created_at = row.get(1).cloned().unwrap_or(Value::Null);
                let display_name = row.get(2).cloned().unwrap_or(Value::Null);
                let join_rows = db.execute(
                    "SELECT location FROM gamelog_join_leave WHERE type = 'OnPlayerJoined' AND display_name = @display_name AND created_at <= @created_at ORDER BY created_at DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("display_name", display_name)
                        .set("created_at", created_at)
                        .build(),
                )?;
                let Some(location) = join_rows
                    .first()
                    .and_then(|row| row.first())
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                else {
                    continue;
                };
                db.execute_non_query(
                    "UPDATE gamelog_join_leave SET location = @location WHERE id = @row_id",
                    &ParamsBuilder::new()
                        .set("row_id", row_id)
                        .set("location", location.to_string())
                        .build(),
                )?;
            }
        }
        DatabaseMaintenanceTask::FixNegativeGPS => {
            for table_name in select_table_names(db, "name LIKE '%_gps'")? {
                db.execute_non_query(
                    &format!("UPDATE {table_name} SET time = 0 WHERE time < 0"),
                    &Default::default(),
                )?;
            }
        }
        DatabaseMaintenanceTask::FixBrokenLeaveEntries => {
            let mut instance_times = std::collections::HashMap::<String, i64>::new();
            for row in db.execute(
                "SELECT location, time FROM gamelog_location",
                &Default::default(),
            )? {
                let location = row
                    .first()
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let time = row.get(1).map(value_as_i64).unwrap_or(0);
                *instance_times.entry(location).or_default() += time;
            }
            for row in db.execute("SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0", &Default::default())? {
                let location = row.first().and_then(Value::as_str).unwrap_or_default();
                let time = row.get(1).map(value_as_i64).unwrap_or(0);
                let id = row.get(2).cloned().unwrap_or(Value::Null);
                if instance_times.get(location).is_some_and(|instance_time| time > *instance_time) {
                    db.execute_non_query(
                        "UPDATE gamelog_join_leave SET time = 0 WHERE id = @id",
                        &ParamsBuilder::new().set("id", id).build(),
                    )?;
                }
            }
        }
        DatabaseMaintenanceTask::FixBrokenGroupInvites => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type LIKE '%.%'"),
                    &Default::default(),
                )?;
            }
        }
        DatabaseMaintenanceTask::FixBrokenNotifications => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(
                    &format!(
                        "DELETE FROM {table_name} WHERE (created_at is null or created_at = '')"
                    ),
                    &Default::default(),
                )?;
            }
        }
        DatabaseMaintenanceTask::FixBrokenGroupChange => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(&format!("DELETE FROM {table_name} WHERE type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'"), &Default::default())?;
            }
        }
        DatabaseMaintenanceTask::FixCancelFriendRequestTypo => {
            for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
                db.execute_non_query(&format!("UPDATE {table_name} SET type = 'CancelFriendRequest' WHERE type = 'CancelFriendRequst'"), &Default::default())?;
            }
        }
        DatabaseMaintenanceTask::FixBrokenGameLogDisplayNames => {
            for row in db.execute(
                "SELECT id, created_at, type, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%' ORDER BY id",
                &Default::default(),
            )? {
                let id = row.first().cloned().unwrap_or(Value::Null);
                let created_at = row_string(&row, 1);
                let event_type = row_string(&row, 2);
                let display_name = row.get(3).and_then(Value::as_str).unwrap_or_default();
                let new_display_name = display_name
                    .split(" (")
                    .next()
                    .unwrap_or_default()
                    .to_string();
                db.execute_non_query(
                    "UPDATE gamelog_join_leave
                     SET display_name = @new_display_name
                     WHERE id = @id
                       AND NOT EXISTS (
                           SELECT 1 FROM gamelog_join_leave
                           WHERE id <> @id
                             AND created_at = @created_at
                             AND type = @type
                             AND display_name = @new_display_name
                       )",
                    &ParamsBuilder::new()
                        .set("new_display_name", new_display_name)
                        .set("created_at", created_at)
                        .set("type", event_type)
                        .set("id", id)
                        .build(),
                )?;
            }
        }
        DatabaseMaintenanceTask::RepairZeroCopresenceDurations => {
            repair_zero_copresence_durations(db)?;
        }
        DatabaseMaintenanceTask::RepairEmptyLeaveLocations => {
            repair_empty_leave_locations(db)?;
        }
        DatabaseMaintenanceTask::RepairExpiredNotificationsSeen => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                if table_column_names(db, &table_name)?.contains("seen") {
                    db.execute_non_query(
                        &format!("UPDATE {table_name} SET seen = 1 WHERE expired = 1 AND seen = 0"),
                        &Default::default(),
                    )?;
                }
            }
        }
        DatabaseMaintenanceTask::ImportUpstreamPrintFavorites => {
            import_upstream_print_favorites(db)?;
        }
        DatabaseMaintenanceTask::ImportUpstreamHmdNotificationSettings => {
            import_upstream_hmd_notification_settings(db)?;
        }
    }
    Ok(())
}

const HMD_NOTIFICATION_POSITION_CONFIG_KEY: &str = "hmdNotificationPosition";
const HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY: &str = "hmdNotificationTimeout";
const UPSTREAM_NOTIFICATION_POSITION_CONFIG_KEY: &str = "VRCX_notificationPosition";
const UPSTREAM_NOTIFICATION_TIMEOUT_CONFIG_KEY: &str = "VRCX_notificationTimeout";

fn import_upstream_hmd_notification_settings(db: &DatabaseService) -> Result<(), Error> {
    if crate::config::get_raw(db, HMD_NOTIFICATION_POSITION_CONFIG_KEY)?.is_none() {
        let position = crate::config::get_raw(db, UPSTREAM_NOTIFICATION_POSITION_CONFIG_KEY)?;
        if let Some(position) = position.as_deref().and_then(|position| {
            ["top", "center", "bottom"]
                .into_iter()
                .find(|prefix| position.trim().starts_with(prefix))
        }) {
            crate::config::set_string(db, HMD_NOTIFICATION_POSITION_CONFIG_KEY, position)?;
        }
    }
    if crate::config::get_raw(db, HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY)?.is_none() {
        let timeout = crate::config::get_raw(db, UPSTREAM_NOTIFICATION_TIMEOUT_CONFIG_KEY)?
            .and_then(|timeout| timeout.trim().parse::<u64>().ok())
            .filter(|timeout| *timeout >= 1_000);
        if let Some(timeout) = timeout {
            crate::config::set_string(
                db,
                HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY,
                &timeout.min(30_000).to_string(),
            )?;
        }
    }
    Ok(())
}

pub const PRINT_FAVORITE_IDS_CONFIG_KEY: &str = "autoDeletePrintsFavoriteIds";

fn import_upstream_print_favorites(db: &DatabaseService) -> Result<(), Error> {
    if select_table_names(db, "name = 'favorite_print'")?.is_empty() {
        return Ok(());
    }
    let existing = crate::config::get_json(db, PRINT_FAVORITE_IDS_CONFIG_KEY, Value::Null)?;
    let imported = db.execute(
        "SELECT print_id FROM favorite_print ORDER BY created_at, id",
        &Default::default(),
    )?;
    let mut ids: Vec<String> = Vec::new();
    for value in existing
        .as_array()
        .into_iter()
        .flatten()
        .chain(imported.iter().filter_map(|row| row.first()))
    {
        let Some(id) = value.as_str().map(str::trim).filter(|id| !id.is_empty()) else {
            continue;
        };
        if !ids.iter().any(|seen| seen == id) {
            ids.push(id.to_string());
        }
    }
    crate::config::set_json(db, PRINT_FAVORITE_IDS_CONFIG_KEY, &Value::from(ids))?;
    db.execute_non_query("DROP TABLE favorite_print", &Default::default())?;
    Ok(())
}

pub fn database_maintenance_table_sizes_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, Error> {
    ensure_game_log_tables(db)?;
    ensure_global_store_tables(db)?;

    let user_id = normalize_text(user_id);
    let mut output = MaintenanceTableSizesOutput {
        gps: 0,
        status: 0,
        bio: 0,
        avatar: 0,
        online_offline: 0,
        friend_log_history: 0,
        notification: 0,
        location: count_table(db, "gamelog_location")?,
        join_leave: count_table(db, "gamelog_join_leave")?,
        portal_spawn: count_table(db, "gamelog_portal_spawn")?,
        video_play: count_table(db, "gamelog_video_play")?,
        event: count_table(db, "gamelog_event")?,
        external: count_table(db, "gamelog_external")?,
        resource_load: count_table(db, "gamelog_resource_load")?,
    };
    if !user_id.is_empty() {
        let user_prefix = normalize_user_table_prefix(&user_id)?;
        ensure_user_store_tables(db, &user_prefix)?;
        output.gps = count_table(db, &format!("{user_prefix}_feed_gps"))?;
        output.status = count_table(db, &format!("{user_prefix}_feed_status"))?;
        output.bio = count_table(db, &format!("{user_prefix}_feed_bio"))?;
        output.avatar = count_table(db, &format!("{user_prefix}_feed_avatar"))?;
        output.online_offline = count_table(db, &format!("{user_prefix}_feed_online_offline"))?;
        output.friend_log_history = count_table(db, &format!("{user_prefix}_friend_log_history"))?;
        output.notification = count_table(db, &format!("{user_prefix}_notifications"))?;
    }
    Ok(output)
}

pub(crate) fn count_table(db: &DatabaseService, table_name: &str) -> Result<i64, Error> {
    let table_name = safe_identifier(table_name, "Table name")?;
    Ok(db
        .execute(
            &format!("SELECT COUNT(*) FROM {table_name}"),
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

#[cfg(test)]
mod tests;
