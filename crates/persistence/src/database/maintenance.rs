#![allow(non_snake_case)]

use std::collections::HashMap;

use chrono::DateTime;
use serde::Serialize;
use serde_json::Value;

use crate::common::{normalize_text, row_i64, row_json, row_string, value_as_i64, ParamsBuilder};
use crate::database::schema::{
    add_column_if_missing, add_legacy_indexes, add_notification_indexes, add_v17_global_indexes,
    backfill_vrcx0_schema_version, drop_column_if_exists, ensure_global_store_tables,
    ensure_user_store_tables, read_vrcx0_schema_version, safe_identifier, select_table_names,
    set_vrcx0_schema_version, table_column_names, VRCX0_SCHEMA_VERSION,
};
use crate::game_log::ensure_game_log_tables;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::DatabaseService;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserTableContextOutput {
    pub user_id: String,
    pub user_prefix: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceTableSizesOutput {
    pub gps: i64,
    pub status: i64,
    pub bio: i64,
    pub avatar: i64,
    pub online_offline: i64,
    pub friend_log_history: i64,
    pub notification: i64,
    pub location: i64,
    pub join_leave: i64,
    pub portal_spawn: i64,
    pub video_play: i64,
    pub event: i64,
    pub external: i64,
    pub resource_load: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrokenGameLogDisplayNameOutput {
    pub id: Value,
    pub display_name: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabaseMaintenanceTask {
    InitGlobalTables,
    Vacuum,
    Optimize,
    UpdateTableForGroupNames,
    AddFriendLogFriendNumber,
    UpdateTableForAvatarHistory,
    AddLegacyPerformanceIndexes,
    AddV17GlobalPerformanceIndexes,
    AddNotificationPerformanceIndexes,
    AddV17PerformanceIndexes,
    AddPerformanceIndexes,
    UpgradeDatabaseVersion,
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
}

impl DatabaseMaintenanceTask {
    pub fn parse(value: &str) -> Result<Self, Error> {
        match normalize_text(value) {
            task if task == "initGlobalTables" => Ok(Self::InitGlobalTables),
            task if task == "vacuum" => Ok(Self::Vacuum),
            task if task == "optimize" => Ok(Self::Optimize),
            task if task == "updateTableForGroupNames" => Ok(Self::UpdateTableForGroupNames),
            task if task == "addFriendLogFriendNumber" => Ok(Self::AddFriendLogFriendNumber),
            task if task == "updateTableForAvatarHistory" => Ok(Self::UpdateTableForAvatarHistory),
            task if task == "addLegacyPerformanceIndexes" => Ok(Self::AddLegacyPerformanceIndexes),
            task if task == "addV17GlobalPerformanceIndexes" => {
                Ok(Self::AddV17GlobalPerformanceIndexes)
            }
            task if task == "addNotificationPerformanceIndexes" => {
                Ok(Self::AddNotificationPerformanceIndexes)
            }
            task if task == "addV17PerformanceIndexes" => Ok(Self::AddV17PerformanceIndexes),
            task if task == "addPerformanceIndexes" => Ok(Self::AddPerformanceIndexes),
            task if task == "upgradeDatabaseVersion" => Ok(Self::UpgradeDatabaseVersion),
            task if task == "cleanLegendFromFriendLog" => Ok(Self::CleanLegendFromFriendLog),
            task if task == "fixGameLogTraveling" => Ok(Self::FixGameLogTraveling),
            task if task == "fixNegativeGPS" => Ok(Self::FixNegativeGPS),
            task if task == "fixBrokenLeaveEntries" => Ok(Self::FixBrokenLeaveEntries),
            task if task == "fixBrokenGroupInvites" => Ok(Self::FixBrokenGroupInvites),
            task if task == "fixBrokenNotifications" => Ok(Self::FixBrokenNotifications),
            task if task == "fixBrokenGroupChange" => Ok(Self::FixBrokenGroupChange),
            task if task == "fixCancelFriendRequestTypo" => Ok(Self::FixCancelFriendRequestTypo),
            task if task == "fixBrokenGameLogDisplayNames" => {
                Ok(Self::FixBrokenGameLogDisplayNames)
            }
            task if task == "repairZeroCopresenceDurations" => {
                Ok(Self::RepairZeroCopresenceDurations)
            }
            task => Err(Error::Custom(format!("Unknown maintenance task: {task}"))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::InitGlobalTables => "initGlobalTables",
            Self::Vacuum => "vacuum",
            Self::Optimize => "optimize",
            Self::UpdateTableForGroupNames => "updateTableForGroupNames",
            Self::AddFriendLogFriendNumber => "addFriendLogFriendNumber",
            Self::UpdateTableForAvatarHistory => "updateTableForAvatarHistory",
            Self::AddLegacyPerformanceIndexes => "addLegacyPerformanceIndexes",
            Self::AddV17GlobalPerformanceIndexes => "addV17GlobalPerformanceIndexes",
            Self::AddNotificationPerformanceIndexes => "addNotificationPerformanceIndexes",
            Self::AddV17PerformanceIndexes => "addV17PerformanceIndexes",
            Self::AddPerformanceIndexes => "addPerformanceIndexes",
            Self::UpgradeDatabaseVersion => "upgradeDatabaseVersion",
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

fn run_database_maintenance_task(
    db: &DatabaseService,
    task: DatabaseMaintenanceTask,
) -> Result<(), Error> {
    match task {
        DatabaseMaintenanceTask::InitGlobalTables => {
            ensure_game_log_tables(db)?;
            ensure_global_store_tables(db)?;
            add_legacy_indexes(db)?;
            backfill_vrcx0_schema_version(db)?;
            if read_vrcx0_schema_version(db)? >= VRCX0_SCHEMA_VERSION {
                add_v17_global_indexes(db)?;
            }
        }
        DatabaseMaintenanceTask::Vacuum => {
            db.execute_non_query("VACUUM", &Default::default())?;
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
        DatabaseMaintenanceTask::AddV17PerformanceIndexes => {
            add_v17_global_indexes(db)?;
            add_notification_indexes(db)?;
        }
        DatabaseMaintenanceTask::AddPerformanceIndexes => {
            add_legacy_indexes(db)?;
            add_v17_global_indexes(db)?;
            add_notification_indexes(db)?;
        }
        DatabaseMaintenanceTask::UpgradeDatabaseVersion => {
            run_database_maintenance_task(db, DatabaseMaintenanceTask::UpdateTableForGroupNames)?;
            run_database_maintenance_task(db, DatabaseMaintenanceTask::AddFriendLogFriendNumber)?;
            run_database_maintenance_task(
                db,
                DatabaseMaintenanceTask::UpdateTableForAvatarHistory,
            )?;
            add_legacy_indexes(db)?;
            set_vrcx0_schema_version(db, VRCX0_SCHEMA_VERSION)?;
        }
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
                "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND location = 'traveling'",
                &Default::default(),
            )?;
            for row in traveling.into_iter().rev() {
                let row_id = row.first().cloned().unwrap_or(Value::Null);
                let created_at = row.get(1).cloned().unwrap_or(Value::Null);
                let display_name = row.get(3).cloned().unwrap_or(Value::Null);
                let join_rows = db.execute(
                    "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerJoined' AND display_name = @display_name AND created_at <= @created_at ORDER BY created_at DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("display_name", display_name)
                        .set("created_at", created_at)
                        .build(),
                )?;
                let Some(location) = join_rows
                    .first()
                    .and_then(|row| row.get(4))
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
                "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'",
                &Default::default(),
            )? {
                let id = row.first().cloned().unwrap_or(Value::Null);
                let display_name = row.get(1).and_then(Value::as_str).unwrap_or_default();
                let new_display_name = display_name
                    .split(" (")
                    .next()
                    .unwrap_or_default()
                    .to_string();
                db.execute_non_query(
                    "UPDATE gamelog_join_leave SET display_name = @new_display_name WHERE id = @id",
                    &ParamsBuilder::new()
                        .set("new_display_name", new_display_name)
                        .set("id", id)
                        .build(),
                )?;
            }
        }
        DatabaseMaintenanceTask::RepairZeroCopresenceDurations => {
            repair_zero_copresence_durations(db)?;
        }
    }
    Ok(())
}

const MAX_COPRESENCE_DURATION_MS: i64 = 24 * 60 * 60 * 1000;
const REPAIR_CHUNK_SIZE: usize = 5000;

fn repair_zero_copresence_durations(db: &DatabaseService) -> Result<(), Error> {
    ensure_game_log_tables(db)?;
    let zero_leaves = db.execute(
        "SELECT id, created_at, location, user_id, display_name FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time = 0 AND location LIKE 'wrld_%'",
        &Default::default(),
    )?;
    for chunk in zero_leaves.chunks(REPAIR_CHUNK_SIZE) {
        db.write_transaction(|tx| {
            for row in chunk {
                let id = row.first().cloned().unwrap_or(Value::Null);
                let leave_at = row_string(row, 1);
                let location = row_string(row, 2);
                let user_id = row_string(row, 3);
                let display_name = row_string(row, 4);
                let join_rows = tx.execute(
                    "SELECT created_at FROM gamelog_join_leave
                     WHERE type = 'OnPlayerJoined' AND location = @location AND created_at <= @created_at
                       AND ((@user_id <> '' AND user_id = @user_id)
                            OR (@user_id = '' AND display_name = @display_name))
                     ORDER BY created_at DESC, id DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("location", location)
                        .set("created_at", leave_at.clone())
                        .set("user_id", user_id)
                        .set("display_name", display_name)
                        .build(),
                )?;
                let Some(join_at) = join_rows
                    .first()
                    .map(|join| row_string(join, 0))
                    .filter(|value| !value.is_empty())
                else {
                    continue;
                };
                let (Some(join_ms), Some(leave_ms)) = (rfc3339_ms(&join_at), rfc3339_ms(&leave_at))
                else {
                    continue;
                };
                let duration = leave_ms - join_ms;
                if duration <= 0 || duration > MAX_COPRESENCE_DURATION_MS {
                    continue;
                }
                tx.execute_non_query(
                    "UPDATE gamelog_join_leave SET time = @time WHERE id = @id",
                    &ParamsBuilder::new()
                        .set("time", duration)
                        .set("id", id)
                        .build(),
                )?;
            }
            Ok(())
        })?;
    }
    Ok(())
}

fn rfc3339_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
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

pub fn database_maintenance_max_friend_log_number_get(
    db: &DatabaseService,
    user_id: String,
) -> Result<i64, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(0);
    }
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    max_friend_log_number(db, &user_prefix)
}

pub fn database_maintenance_broken_leave_entries_get(
    db: &DatabaseService,
) -> Result<Vec<Value>, Error> {
    ensure_game_log_tables(db)?;
    let mut instance_times = HashMap::<String, i64>::new();
    for row in db.execute(
        "SELECT location, time FROM gamelog_location",
        &Default::default(),
    )? {
        let location = row_string(&row, 0);
        let time = row_i64(&row, 1);
        *instance_times.entry(location).or_default() += time;
    }
    let mut bad_entries = Vec::new();
    for row in db.execute("SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0", &Default::default())? {
        let location = row_string(&row, 0);
        let time = row_i64(&row, 1);
        if instance_times
            .get(&location)
            .is_some_and(|instance_time| time > *instance_time)
        {
            bad_entries.push(row_json(&row, 2));
        }
    }
    Ok(bad_entries)
}

pub fn database_maintenance_broken_game_log_display_names_get(
    db: &DatabaseService,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| BrokenGameLogDisplayNameOutput {
            id: row_json(&row, 0),
            display_name: row_json(&row, 1),
        })
        .collect())
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

pub(crate) fn max_friend_log_number(db: &DatabaseService, user_prefix: &str) -> Result<i64, Error> {
    Ok(db
        .execute(
            &format!("SELECT MAX(friend_number) FROM {user_prefix}_friend_log_current"),
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: std::path::PathBuf,
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

    fn insert_join_leave(
        db: &DatabaseService,
        created_at: &str,
        event_type: &str,
        display_name: &str,
        location: &str,
        user_id: &str,
        time: i64,
    ) {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
             VALUES (@created_at, @type, @name, @location, @user_id, @time)",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("type", event_type)
                .set("name", display_name)
                .set("location", location)
                .set("user_id", user_id)
                .set("time", time)
                .build(),
        )
        .unwrap();
    }

    fn leave_time(db: &DatabaseService, user_id: &str) -> i64 {
        db.execute(
            "SELECT time FROM gamelog_join_leave WHERE user_id = @user_id AND type = 'OnPlayerLeft'",
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )
        .unwrap()
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap()
    }

    #[test]
    fn repair_zero_copresence_durations_pairs_leave_with_join() -> Result<(), Error> {
        let dir = TestDir::new("gamelog-repair-durations");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
        ensure_game_log_tables(&db)?;

        // Alice: real 40-minute session whose leave was written as time=0.
        insert_join_leave(
            &db,
            "2026-06-30T16:00:10.000Z",
            "OnPlayerJoined",
            "Alice",
            "wrld_x:1",
            "usr_alice",
            0,
        );
        insert_join_leave(
            &db,
            "2026-06-30T16:40:10.000Z",
            "OnPlayerLeft",
            "Alice",
            "wrld_x:1",
            "usr_alice",
            0,
        );
        // Bob: leave with no matching join stays 0.
        insert_join_leave(
            &db,
            "2026-06-30T16:40:10.000Z",
            "OnPlayerLeft",
            "Bob",
            "wrld_x:1",
            "usr_bob",
            0,
        );
        // Carol: a 'traveling' leave carries no world, so it is not repaired.
        insert_join_leave(
            &db,
            "2026-06-30T16:05:00.000Z",
            "OnPlayerJoined",
            "Carol",
            "wrld_x:1",
            "usr_carol",
            0,
        );
        insert_join_leave(
            &db,
            "2026-06-30T16:20:00.000Z",
            "OnPlayerLeft",
            "Carol",
            "traveling",
            "usr_carol",
            0,
        );

        database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

        assert_eq!(leave_time(&db, "usr_alice"), 2_400_000);
        assert_eq!(leave_time(&db, "usr_bob"), 0);
        assert_eq!(leave_time(&db, "usr_carol"), 0);
        Ok(())
    }
}
