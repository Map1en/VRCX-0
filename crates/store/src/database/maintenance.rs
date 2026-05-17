#![allow(non_snake_case)]
#![allow(unused_imports)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::common::ParamsBuilder;
use crate::domain_support::*;
use crate::game_log::ensure_game_log_tables;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

use super::DatabaseService;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTableContextOutput {
    pub user_id: String,
    pub user_prefix: String,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenGameLogDisplayNameOutput {
    pub id: Value,
    pub display_name: Value,
}

pub fn app__user_tables_ensure(
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

pub fn app__database_maintenance_run(db: &DatabaseService, task: String) -> Result<(), Error> {
    let task = normalize_text(task);
    run_database_maintenance_task(db, &task)
}

fn run_database_maintenance_task(db: &DatabaseService, task: &str) -> Result<(), Error> {
    match task {
        "initGlobalTables" => {
            ensure_game_log_tables(db)?;
            ensure_global_store_tables(db)?;
            add_legacy_indexes(db)?;
            if db
                .execute(
                    "SELECT value FROM configs WHERE key = 'config:vrcx_databaseversion' LIMIT 1",
                    &Default::default(),
                )
                .ok()
                .and_then(|rows| rows.first().and_then(|row| row.first()).cloned())
                .and_then(|value| value_as_string(&value).parse::<i64>().ok())
                .unwrap_or(0)
                >= 17
            {
                add_v17_global_indexes(db)?;
            }
        }
        "vacuum" => {
            db.execute_non_query("VACUUM", &Default::default())?;
        }
        "optimize" => {
            db.execute_non_query("PRAGMA optimize", &Default::default())?;
        }
        "updateTableForGroupNames" => {
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
        "addFriendLogFriendNumber" => {
            for table_name in select_table_names(
                db,
                "name LIKE '%_friend_log_current' OR name LIKE '%_friend_log_history'",
            )? {
                add_column_if_missing(db, &table_name, "friend_number", "INTEGER DEFAULT 0")?;
            }
        }
        "updateTableForAvatarHistory" => {
            for table_name in select_table_names(db, "name LIKE '%_avatar_history'")? {
                add_column_if_missing(db, &table_name, "time", "INTEGER DEFAULT 0")?;
            }
        }
        "addLegacyPerformanceIndexes" => add_legacy_indexes(db)?,
        "addV17GlobalPerformanceIndexes" => add_v17_global_indexes(db)?,
        "addNotificationPerformanceIndexes" => add_notification_indexes(db)?,
        "addV17PerformanceIndexes" => {
            add_v17_global_indexes(db)?;
            add_notification_indexes(db)?;
        }
        "addPerformanceIndexes" => {
            add_legacy_indexes(db)?;
            add_v17_global_indexes(db)?;
            add_notification_indexes(db)?;
        }
        "upgradeDatabaseVersion" => {
            run_database_maintenance_task(db, "updateTableForGroupNames")?;
            run_database_maintenance_task(db, "addFriendLogFriendNumber")?;
            run_database_maintenance_task(db, "updateTableForAvatarHistory")?;
            add_legacy_indexes(db)?;
        }
        "cleanLegendFromFriendLog" => {
            for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
                db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z' AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))"),
                    &Default::default(),
                )?;
            }
        }
        "fixGameLogTraveling" => {
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
        "fixNegativeGPS" => {
            for table_name in select_table_names(db, "name LIKE '%_gps'")? {
                db.execute_non_query(
                    &format!("UPDATE {table_name} SET time = 0 WHERE time < 0"),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenLeaveEntries" => {
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
        "fixBrokenGroupInvites" => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(
                    &format!("DELETE FROM {table_name} WHERE type LIKE '%.%'"),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenNotifications" => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(
                    &format!(
                        "DELETE FROM {table_name} WHERE (created_at is null or created_at = '')"
                    ),
                    &Default::default(),
                )?;
            }
        }
        "fixBrokenGroupChange" => {
            for table_name in select_table_names(db, "name LIKE '%_notifications'")? {
                db.execute_non_query(&format!("DELETE FROM {table_name} WHERE type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'"), &Default::default())?;
            }
        }
        "fixCancelFriendRequestTypo" => {
            for table_name in select_table_names(db, "name LIKE '%_friend_log_history'")? {
                db.execute_non_query(&format!("UPDATE {table_name} SET type = 'CancelFriendRequest' WHERE type = 'CancelFriendRequst'"), &Default::default())?;
            }
        }
        "fixBrokenGameLogDisplayNames" => {
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
        _ => return Err(Error::Custom(format!("Unknown maintenance task: {task}"))),
    }
    Ok(())
}

pub fn app__database_maintenance_table_sizes_get(
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

pub fn app__database_maintenance_max_friend_log_number_get(
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

pub fn app__database_maintenance_broken_leave_entries_get(
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

pub fn app__database_maintenance_broken_game_log_display_names_get(
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
